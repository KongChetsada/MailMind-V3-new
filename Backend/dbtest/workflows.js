// ทดสอบ workflow กับฐานข้อมูลจริง โดยใช้ตัวเชื่อมจำลองแทน Gmail / Calendar / AI
// รัน: pnpm test:db   (ต้องมี DATABASE_URL ที่ migrate แล้วใน .env)
// ข้อมูลทดสอบถูกสร้างใต้ผู้ใช้ชั่วคราวและลบทิ้งเมื่อจบ
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const { env } = require('../src/config/env');
const prisma = require('../src/config/prisma');
const { overrideDeps } = require('../src/workflows/deps');
const { createLogger } = require('../src/utils/logger');
const { encryptSecret } = require('../src/utils/encryption');
const { signUserToken } = require('../src/middlewares/auth');
const { AiError } = require('../src/connectors/ai');
const time = require('../src/core/time');

const { syncAccount } = require('../src/workflows/syncAccount');
const { analyzeEmail } = require('../src/workflows/analyzeEmail');
const { generateDraft } = require('../src/workflows/generateDraft');
const { sendDraft, discardDraft } = require('../src/workflows/sendDraft');
const { confirmActionItem, updateActionItem, dismissActionItem } = require('../src/workflows/actionItems');
const { runAnalyzeJob, recoverStale } = require('../src/jobs/analyzeJob');
const { createApp } = require('../src/app');

const TZ = 'Asia/Bangkok';
const RUN = randomUUID().slice(0, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// วันจันทร์ถัดไปที่ห่างจากวันนี้อย่างน้อย 3 วัน เวลา hour:00 ตามเวลาไทย
const nextMonday = (hour, minute = 0) => {
  let day = time.addZonedDays(time.startOfZonedDay(new Date(), TZ), 3, TZ);
  while (time.zonedParts(day, TZ).weekday !== 1) day = time.addZonedDays(day, 1, TZ);
  const p = time.zonedParts(day, TZ);
  return time.zonedToUtc({ year: p.year, month: p.month, day: p.day, hour, minute }, TZ);
};
const iso = (d) => d.toISOString();

// ───────── ตัวเชื่อมจำลอง ─────────
const fake = {
  messages: new Map(), // id -> { meta, text }
  sent: [],
  events: [], // ปฏิทินของผู้ใช้
  created: new Map(), // idempotencyKey -> event
  calendarInserts: 0,
  aiCalls: [],
  failMetaFor: null,
  failSend: false,
  failCalendar: false,
  sendDelayMs: 0,
  aiMode: 'scripted', // scripted | garbage | down
};

const addMessage = (id, { subject, text, labels = ['INBOX', 'UNREAD'], threadId = `t-${id}`, html = '' }) => {
  fake.messages.set(id, {
    meta: {
      providerMessageId: id,
      providerThreadId: threadId,
      fromName: 'ผู้ส่ง ทดสอบ',
      fromAddress: 'sender@example.com',
      subject,
      snippet: text.slice(0, 80),
      receivedAt: new Date(),
      isRead: false,
      labels,
    },
    text,
    html,
  });
};

const mail = {
  provider: 'GOOGLE',
  async listMessageIdsSince() {
    return { ids: [...fake.messages.keys()], truncated: false };
  },
  async getMessageMeta(id) {
    if (fake.failMetaFor === id) throw new Error('network down');
    return fake.messages.get(id).meta;
  },
  async getThread(threadId) {
    return [...fake.messages.values()]
      .filter((m) => m.meta.providerThreadId === threadId)
      .map((m) => ({
        id: m.meta.providerMessageId,
        from: 'ผู้ส่ง ทดสอบ <sender@example.com>',
        subject: m.meta.subject,
        date: m.meta.receivedAt.toISOString(),
        receivedAt: m.meta.receivedAt.toISOString(),
        text: m.text,
        html: m.html,
        isRead: false,
      }));
  },
  async sendReply(payload) {
    if (fake.sendDelayMs) await sleep(fake.sendDelayMs);
    if (fake.failSend) throw new Error('smtp rejected');
    fake.sent.push(payload);
    return { id: `sent-${fake.sent.length}` };
  },
  async markRead() {},
};

const calendar = {
  provider: 'GOOGLE',
  async listEvents() {
    if (fake.failCalendar) throw new Error('calendar api down');
    return [...fake.events, ...fake.created.values()];
  },
  async createEvent(input) {
    await sleep(20);
    if (fake.failCalendar) throw new Error('calendar api down');
    if (fake.created.has(input.idempotencyKey)) {
      return { id: fake.created.get(input.idempotencyKey).id, htmlLink: 'http://cal/x', alreadyExisted: true };
    }
    fake.calendarInserts += 1;
    const event = { id: `ev-${input.idempotencyKey}`, title: input.title, start: iso(new Date(input.start)), end: iso(new Date(input.end)), isAllDay: input.isAllDay, _input: input };
    fake.created.set(input.idempotencyKey, event);
    return { id: event.id, htmlLink: 'http://cal/x', alreadyExisted: false };
  },
};

// AI จำลอง: ตอบตามหัวข้ออีเมลที่อยู่ใน prompt
const scriptedAnalysis = (prompt) => {
  const start = nextMonday(10);
  const end = nextMonday(11, 30);
  if (prompt.includes('นัดประชุมโครงการ')) {
    return {
      category: 'APPOINTMENT', priority: 'NORMAL', summary: 'ขอนัดประชุมโครงการ', needsReply: true, replyIntent: 'ACCEPT',
      actionItems: [{ kind: 'EVENT', title: 'ประชุมโครงการ', start: iso(start), end: iso(end), isTimeSpecified: true, isAllDay: false, location: 'ห้อง 301', evidence: 'เวลา 10:00 - 11:30 น. ห้อง 301' }],
    };
  }
  if (prompt.includes('ส่งรายงานประจำเดือน')) {
    return {
      category: 'TASK_DEADLINE', priority: 'HIGH', summary: 'ต้องส่งรายงาน', needsReply: false, replyIntent: null,
      actionItems: [{ kind: 'DEADLINE', title: 'ส่งรายงานประจำเดือน', start: iso(time.startOfZonedDay(start, TZ)), end: null, isTimeSpecified: false, evidence: 'ข้อความที่ไม่มีในอีเมล' }],
    };
  }
  if (prompt.includes('ขอเอกสารประกอบ')) {
    return { category: 'INFO_REQUEST', priority: 'NORMAL', summary: 'ขอเอกสาร', needsReply: true, replyIntent: 'ANSWER', actionItems: [] };
  }
  if (prompt.includes('นัดคุยแต่ไม่บอกเวลา')) {
    return {
      category: 'APPOINTMENT', priority: 'NORMAL', summary: 'ขอนัดคุย', needsReply: true, replyIntent: 'ACCEPT',
      actionItems: [{ kind: 'EVENT', title: 'นัดคุย', start: null, end: null, isTimeSpecified: false, evidence: null }],
    };
  }
  return { category: 'FYI', priority: 'LOW', summary: 'แจ้งเพื่อทราบ', needsReply: false, replyIntent: null, actionItems: [] };
};

const ai = {
  provider: 'fake',
  model: 'fake-1',
  isLocal: true,
  async complete({ user }) {
    fake.aiCalls.push(user);
    if (fake.aiMode === 'down') throw new AiError('AI_UNREACHABLE', 'เชื่อมต่อ Ollama ไม่ได้');
    if (fake.aiMode === 'garbage') return { text: 'ขออภัย ฉันไม่สามารถช่วยได้', usage: null };
    if (user.includes('"draftMessage"')) {
      return { text: JSON.stringify({ draftMessage: 'เรียนผู้ส่ง\n\nรับทราบครับ\n\nขอแสดงความนับถือ' }), usage: null };
    }
    return { text: JSON.stringify(scriptedAnalysis(user)), usage: null };
  },
};

const silentSink = { log() {}, warn() {}, error() {} };
overrideDeps({
  getMail: () => mail,
  getCalendar: () => calendar,
  getAi: async () => ai,
  logger: createLogger('TEST', {}, { sink: silentSink }),
});

// ───────── ข้อมูลตั้งต้น ─────────
let user;
let account;
let otherUser;
let server;
let baseUrl;

const emailRow = (providerMessageId) =>
  prisma.emailMessage.findUnique({
    where: { mailAccountId_providerMessageId: { mailAccountId: account.id, providerMessageId } },
    include: { actionItems: { orderBy: { createdAt: 'asc' } }, replyDraft: true },
  });

const api = async (path, { method = 'GET', body, token } = {}) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token === null ? {} : { Authorization: `Bearer ${token || signUserToken(user)}` }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

test.before(async () => {
  assert.ok(env.databaseUrl, 'DATABASE_URL is required');
  user = await prisma.user.create({
    data: { email: `dbtest-${RUN}@example.com`, name: 'DB Test', setting: { create: { timezone: TZ, gender: 'MALE', firstName: 'ทดสอบ' } } },
  });
  otherUser = await prisma.user.create({ data: { email: `dbtest-other-${RUN}@example.com`, setting: { create: {} } } });
  account = await prisma.mailAccount.create({
    data: { userId: user.id, provider: 'GOOGLE', providerAccountId: `g-${RUN}`, emailAddress: user.email, refreshToken: encryptSecret('rt') },
  });
  server = createApp().listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  addMessage(`${RUN}-appt`, { subject: 'นัดประชุมโครงการ', text: 'ขอนัดประชุมโครงการ วันจันทร์หน้า เวลา 10:00 - 11:30 น. ห้อง 301' });
  addMessage(`${RUN}-task`, { subject: 'ส่งรายงานประจำเดือน', text: 'กรุณาส่งรายงานประจำเดือนภายในวันจันทร์หน้า' });
  addMessage(`${RUN}-info`, { subject: 'ขอเอกสารประกอบ', text: 'รบกวนขอเอกสารประกอบการประชุมด้วยครับ' });
  addMessage(`${RUN}-fyi`, { subject: 'ประกาศ', text: 'แจ้งปิดปรับปรุงระบบ' });
  addMessage(`${RUN}-promo`, { subject: 'ลดราคา 50%', text: 'โปรโมชันพิเศษ', labels: ['INBOX', 'CATEGORY_PROMOTIONS'] });
});

test.after(async () => {
  server?.close();
  await prisma.user.deleteMany({ where: { id: { in: [user.id, otherUser.id] } } });
  await prisma.$disconnect();
});

// ───────── (A) ซิงก์ ─────────
test('sync: stores new mail once, skips promotions by rule, and advances the cursor', async () => {
  const first = await syncAccount(account.id);
  assert.deepEqual([first.found, first.created, first.skippedByRule], [5, 5, 1]);

  const promo = await emailRow(`${RUN}-promo`);
  assert.deepEqual([promo.analysisStatus, promo.category], ['SKIPPED', 'OTHER']);
  assert.equal((await emailRow(`${RUN}-appt`)).analysisStatus, 'PENDING');

  const second = await syncAccount(account.id);
  assert.equal(second.created, 0);
  assert.equal(await prisma.emailMessage.count({ where: { mailAccountId: account.id } }), 5);
  assert.ok((await prisma.mailAccount.findUnique({ where: { id: account.id } })).syncCursor);
});

test('sync: a failure midway leaves the cursor untouched and a retry creates no duplicates', async () => {
  const before = (await prisma.mailAccount.findUnique({ where: { id: account.id } })).syncCursor;
  addMessage(`${RUN}-late1`, { subject: 'นัดคุยแต่ไม่บอกเวลา', text: 'อยากนัดคุยเรื่องงานสัปดาห์หน้าครับ' });
  addMessage(`${RUN}-late2`, { subject: 'ประกาศ 2', text: 'แจ้งเพื่อทราบ' });
  fake.failMetaFor = `${RUN}-late2`;
  await assert.rejects(() => syncAccount(account.id), /network down/);

  const mid = await prisma.mailAccount.findUnique({ where: { id: account.id } });
  assert.equal(mid.syncCursor.getTime(), before.getTime());
  assert.match(mid.lastSyncError, /network down/);

  fake.failMetaFor = null;
  await syncAccount(account.id);
  assert.equal(await prisma.emailMessage.count({ where: { mailAccountId: account.id } }), 7);
  assert.equal((await prisma.mailAccount.findUnique({ where: { id: account.id } })).lastSyncError, null);
});

// ───────── (B)(C) วิเคราะห์ ─────────
test('analyze: free appointment → classified, real duration kept, availability checked, ACCEPT draft', async () => {
  const email = await emailRow(`${RUN}-appt`);
  const result = await analyzeEmail(email.id);
  assert.deepEqual([result.claimed, result.ok, result.category], [true, true, 'APPOINTMENT']);

  const after = await emailRow(`${RUN}-appt`);
  assert.deepEqual([after.analysisStatus, after.category, after.aiModel], ['DONE', 'APPOINTMENT', 'fake-1']);
  const [item] = after.actionItems;
  assert.equal((item.endAt - item.startAt) / 60000, 90);
  assert.deepEqual([item.availability, item.status, item.missingFields], ['AVAILABLE', 'SUGGESTED', []]);
  assert.deepEqual([after.replyDraft.status, after.replyDraft.intent, after.replyDraft.source], ['PENDING', 'ACCEPT', 'AI']);
});

test('analyze: an already analysed email is not processed again unless forced', async () => {
  const email = await emailRow(`${RUN}-appt`);
  assert.equal((await analyzeEmail(email.id)).claimed, false);
});

test('analyze: two workers racing for one email — only one wins', async () => {
  const email = await emailRow(`${RUN}-info`);
  const results = await Promise.all([analyzeEmail(email.id), analyzeEmail(email.id), analyzeEmail(email.id)]);
  assert.equal(results.filter((r) => r.claimed).length, 1);
  const after = await emailRow(`${RUN}-info`);
  assert.deepEqual([after.category, after.analysisAttempts, after.replyDraft.intent], ['INFO_REQUEST', 1, 'ANSWER']);
});

test('analyze: deadline with unverifiable evidence is kept but flagged; no automatic draft', async () => {
  const email = await emailRow(`${RUN}-task`);
  await analyzeEmail(email.id);
  const after = await emailRow(`${RUN}-task`);
  const [item] = after.actionItems;
  assert.deepEqual([after.category, after.priority, item.kind, item.isAllDay, item.endAt], ['TASK_DEADLINE', 'HIGH', 'DEADLINE', true, null]);
  assert.deepEqual([item.evidence, item.missingFields, item.availability], [null, ['evidence'], 'NOT_CHECKED']);
  assert.equal(after.replyDraft, null);
});

test('analyze: appointment without a time → slots suggested and a PROPOSE_TIME draft listing them', async () => {
  const email = await emailRow(`${RUN}-late1`);
  fake.aiCalls.length = 0;
  await analyzeEmail(email.id);
  const after = await emailRow(`${RUN}-late1`);
  const [item] = after.actionItems;
  assert.deepEqual(item.missingFields, ['start', 'evidence']);
  assert.equal(item.suggestedSlots.length, 3);
  assert.equal(after.replyDraft.intent, 'PROPOSE_TIME');
  const draftPrompt = fake.aiCalls.find((p) => p.includes('"draftMessage"'));
  assert.match(draftPrompt, /PROPOSE OTHER TIMES/);
  assert.match(draftPrompt, new RegExp(time.formatThaiRange(new Date(item.suggestedSlots[0].start), new Date(item.suggestedSlots[0].end), TZ).replace(/[.]/g, '\\.')));
});

test('analyze: unreadable AI output → FAILED with a reason, never silently filed as OTHER', async () => {
  const email = await emailRow(`${RUN}-fyi`);
  fake.aiMode = 'garbage';
  const result = await analyzeEmail(email.id);
  assert.deepEqual([result.claimed, result.ok], [true, false]);
  let after = await emailRow(`${RUN}-fyi`);
  assert.deepEqual([after.analysisStatus, after.category, after.analysisAttempts], ['FAILED', null, 1]);
  assert.match(after.analysisError, /JSON/);

  fake.aiMode = 'down';
  await analyzeEmail(email.id);
  after = await emailRow(`${RUN}-fyi`);
  assert.deepEqual([after.analysisStatus, after.analysisAttempts], ['FAILED', 2]);
  assert.match(after.analysisError, /Ollama/);
  fake.aiMode = 'scripted';
});

test('job: analyses pending and retryable mail, and stops retrying after the attempt limit', async () => {
  const late2 = await emailRow(`${RUN}-late2`);
  await prisma.emailMessage.updateMany({ where: { mailAccountId: account.id, id: { not: late2.id }, analysisStatus: 'FAILED' }, data: { analysisAttempts: env.jobs.analyzeMaxAttempts } });
  const summary = await runAnalyzeJob(undefined, { accountIds: [account.id] });
  assert.equal(summary.status, 'completed');
  assert.equal((await emailRow(`${RUN}-late2`)).analysisStatus, 'DONE');
  const fyi = await emailRow(`${RUN}-fyi`);
  assert.deepEqual([fyi.analysisStatus, fyi.analysisAttempts], ['FAILED', env.jobs.analyzeMaxAttempts]);
  // ผู้ใช้ยังสั่งวิเคราะห์เองได้แม้เกินจำนวนครั้งอัตโนมัติ
  assert.equal((await analyzeEmail(fyi.id, { force: true })).ok, true);
  assert.equal((await emailRow(`${RUN}-fyi`)).category, 'FYI');
});

// ───────── (D1) ส่งร่าง ─────────
test('send: concurrent clicks send exactly one email; later attempts are refused', async () => {
  const { replyDraft } = await emailRow(`${RUN}-appt`);
  fake.sendDelayMs = 60;
  const results = await Promise.allSettled([
    sendDraft(user.id, replyDraft.id, {}),
    sendDraft(user.id, replyDraft.id, {}),
    sendDraft(user.id, replyDraft.id, {}),
  ]);
  fake.sendDelayMs = 0;
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'DRAFT_NOT_SENDABLE'));
  assert.equal(fake.sent.length, 1);

  const after = (await emailRow(`${RUN}-appt`)).replyDraft;
  assert.deepEqual([after.status, after.providerMessageId], ['SENT', 'sent-1']);
  await assert.rejects(() => sendDraft(user.id, replyDraft.id, {}), { code: 'DRAFT_NOT_SENDABLE' });
  await assert.rejects(() => generateDraft(after.emailId, {}), { code: 'DRAFT_LOCKED' });
  assert.equal(fake.sent.length, 1);
});

test('send: sending did not touch the calendar item (independent statuses)', async () => {
  const [item] = (await emailRow(`${RUN}-appt`)).actionItems;
  assert.equal(item.status, 'SUGGESTED');
  assert.equal(fake.calendarInserts, 0);
});

test('send: a failed send is recorded and can be retried with edited text', async () => {
  const { replyDraft } = await emailRow(`${RUN}-info`);
  fake.failSend = true;
  await assert.rejects(() => sendDraft(user.id, replyDraft.id, {}), { code: 'SEND_FAILED' });
  let after = (await emailRow(`${RUN}-info`)).replyDraft;
  assert.deepEqual([after.status, after.errorMessage], ['FAILED', 'smtp rejected']);

  fake.failSend = false;
  await sendDraft(user.id, replyDraft.id, { body: 'ข้อความที่ผู้ใช้แก้เอง' });
  after = (await emailRow(`${RUN}-info`)).replyDraft;
  assert.deepEqual([after.status, after.source, after.body], ['SENT', 'USER', 'ข้อความที่ผู้ใช้แก้เอง']);
  assert.equal(fake.sent.at(-1).body, 'ข้อความที่ผู้ใช้แก้เอง');
});

test('send: another user cannot send, discard, or confirm someone else’s items', async () => {
  const late1 = await emailRow(`${RUN}-late1`);
  await assert.rejects(() => sendDraft(otherUser.id, late1.replyDraft.id, {}), { status: 404 });
  await assert.rejects(() => discardDraft(otherUser.id, late1.replyDraft.id), { status: 404 });
  await assert.rejects(() => confirmActionItem(otherUser.id, late1.actionItems[0].id, {}), { status: 404 });
  await assert.rejects(() => dismissActionItem(otherUser.id, late1.actionItems[0].id), { status: 404 });
});

// ───────── (D2) ลงปฏิทิน ─────────
test('confirm: item without a date is refused; filling it in re-checks availability', async () => {
  const [item] = (await emailRow(`${RUN}-late1`)).actionItems;
  await assert.rejects(() => confirmActionItem(user.id, item.id, {}), { status: 400 });

  const updated = await updateActionItem(user.id, item.id, { startAt: iso(nextMonday(14)), endAt: iso(nextMonday(15)) });
  assert.deepEqual([updated.missingFields, updated.isTimeSpecified, updated.availability, updated.suggestedSlots], [['evidence'], true, 'AVAILABLE', null]);
  await assert.rejects(() => updateActionItem(user.id, item.id, { endAt: iso(nextMonday(13)) }), { status: 400 });
});

test('confirm: a conflict that appeared after analysis blocks creation until the user forces it', async () => {
  const [item] = (await emailRow(`${RUN}-appt`)).actionItems;
  fake.events.push({ id: 'new-meeting', title: 'ประชุมด่วน', start: iso(nextMonday(11)), end: iso(nextMonday(12)), isAllDay: false });

  await assert.rejects(() => confirmActionItem(user.id, item.id, {}), (e) => e.code === 'CALENDAR_CONFLICT' && e.details.conflict.id === 'new-meeting');
  const blocked = await prisma.actionItem.findUnique({ where: { id: item.id } });
  assert.deepEqual([blocked.status, blocked.availability], ['SUGGESTED', 'CONFLICT']);
  assert.equal(fake.calendarInserts, 0);

  const results = await Promise.allSettled([
    confirmActionItem(user.id, item.id, { force: true }),
    confirmActionItem(user.id, item.id, { force: true }),
    confirmActionItem(user.id, item.id, { force: true }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(fake.calendarInserts, 1);

  const created = fake.created.get(item.id);
  assert.equal((new Date(created.end) - new Date(created.start)) / 60000, 90); // ใช้ระยะเวลาจริง ไม่ใช่ 60 นาทีตายตัว
  assert.equal(created._input.attendeeEmail, null);
  const done = await prisma.actionItem.findUnique({ where: { id: item.id } });
  assert.deepEqual([done.status, done.externalEventId], ['CREATED', created.id]);
  await assert.rejects(() => confirmActionItem(user.id, item.id, {}), { code: 'ACTION_NOT_CONFIRMABLE' });
});

test('confirm: calendar failure is recorded, retry succeeds without a duplicate event', async () => {
  const [item] = (await emailRow(`${RUN}-task`)).actionItems;
  fake.failCalendar = true;
  await assert.rejects(() => confirmActionItem(user.id, item.id, {}), { code: 'CALENDAR_FAILED' });
  assert.deepEqual((await prisma.actionItem.findUnique({ where: { id: item.id } })).status, 'FAILED');

  fake.failCalendar = false;
  const before = fake.calendarInserts;
  const done = await confirmActionItem(user.id, item.id, { inviteSender: true });
  assert.equal(done.status, 'CREATED');
  assert.equal(fake.calendarInserts, before + 1);
  const created = fake.created.get(item.id);
  assert.deepEqual([created.isAllDay, created.title, created._input.attendeeEmail], [true, '[กำหนดส่ง] ส่งรายงานประจำเดือน', 'sender@example.com']);
});

test('re-analysis replaces suggestions but keeps what is already on the calendar', async () => {
  const email = await emailRow(`${RUN}-appt`);
  assert.equal((await analyzeEmail(email.id, { force: true })).ok, true);
  const after = await emailRow(`${RUN}-appt`);
  assert.deepEqual(after.actionItems.map((a) => a.status), ['CREATED', 'SUGGESTED']);
  assert.equal(after.actionItems[1].availability, 'CONFLICT'); // ตอนนี้ชนกับกิจกรรมที่เพิ่งลงไปเอง
  assert.equal(after.replyDraft.status, 'SENT'); // ร่างที่ส่งแล้วไม่ถูกเขียนทับ
});

test('recovery: work interrupted by a crash is released with a safe status', async () => {
  const late2 = await emailRow(`${RUN}-late2`);
  const late1 = await emailRow(`${RUN}-late1`);
  const old = new Date(Date.now() - 60 * 60 * 1000);
  await prisma.$executeRaw`UPDATE "EmailMessage" SET "analysisStatus" = 'PROCESSING', "updatedAt" = ${old} WHERE id = ${late2.id}`;
  await prisma.$executeRaw`UPDATE "ReplyDraft" SET status = 'SENDING', "updatedAt" = ${old} WHERE id = ${late1.replyDraft.id}`;
  await prisma.$executeRaw`UPDATE "ActionItem" SET status = 'CREATING', "updatedAt" = ${old} WHERE id = ${late1.actionItems[0].id}`;

  const recovered = await recoverStale();
  assert.ok(recovered.emails >= 1 && recovered.drafts >= 1 && recovered.actions >= 1);
  assert.equal((await emailRow(`${RUN}-late2`)).analysisStatus, 'PENDING');
  const after = await emailRow(`${RUN}-late1`);
  assert.equal(after.replyDraft.status, 'FAILED'); // ไม่ส่งใหม่เอง
  assert.match(after.replyDraft.errorMessage, /Sent/);
  assert.equal(after.actionItems[0].status, 'FAILED');
});

// ───────── HTTP ─────────
test('http: rejects missing tokens and malformed input', async () => {
  assert.equal((await api('/api/emails', { token: null })).status, 401);
  assert.equal((await api('/api/emails', { token: 'not-a-jwt' })).status, 401);
  assert.equal((await api('/api/emails?category=NOPE')).status, 400);
  assert.equal((await api('/api/settings', { method: 'PUT', body: { startTime: '25:00' } })).status, 400);
  assert.equal((await api('/api/settings', { method: 'PUT', body: { timezone: 'Mars/Phobos' } })).status, 400);
  assert.equal((await api('/api/nope')).status, 404);
});

test('http: inbox list, counts, detail, category correction, and stats', async () => {
  const list = await api('/api/emails?limit=3');
  assert.equal(list.status, 200);
  assert.equal(list.json.items.length, 3);
  assert.ok(list.json.nextCursor);
  const page2 = await api(`/api/emails?limit=10&cursor=${list.json.nextCursor}`);
  assert.equal(page2.json.items.length, 4);
  assert.equal(new Set([...list.json.items, ...page2.json.items].map((i) => i.id)).size, 7);

  const appts = await api('/api/emails?category=APPOINTMENT');
  assert.equal(appts.json.items.length, 2);
  assert.equal((await api('/api/emails?filter=has_action')).json.items.length >= 1, true);

  const counts = (await api('/api/emails/counts')).json;
  assert.equal(counts.total, 7);
  assert.equal(counts.categories.APPOINTMENT, 2);
  assert.equal(counts.categories.OTHER, 1);

  const fyi = await emailRow(`${RUN}-fyi`);
  const detail = await api(`/api/emails/${fyi.id}`);
  assert.equal(detail.json.messages.length, 1);
  assert.equal(detail.json.messages[0].isCurrent, true);

  const patched = await api(`/api/emails/${fyi.id}`, { method: 'PATCH', body: { userCategory: 'TASK_DEADLINE' } });
  assert.deepEqual([patched.json.category, patched.json.aiCategory], ['TASK_DEADLINE', 'FYI']);

  const stats = (await api('/api/summary/stats?days=7')).json;
  assert.equal(stats.emails.total, 7);
  assert.equal(stats.classification.corrected, 1);
  assert.equal(stats.drafts.sent, 2);
  assert.equal(stats.drafts.sentAfterEdit, 1);
  assert.equal(stats.actions.created, 2);
  assert.equal(stats.byCategory.TASK_DEADLINE, 2);

  // เลือกกลับเป็นค่าที่ AI ให้ = ไม่นับว่าแก้
  await api(`/api/emails/${fyi.id}`, { method: 'PATCH', body: { userCategory: 'FYI' } });
  assert.equal((await api('/api/summary/stats?days=7')).json.classification.corrected, 0);

  const otherToken = signUserToken(otherUser);
  assert.equal((await api(`/api/emails/${fyi.id}`, { token: otherToken })).status, 404);
  assert.equal((await api('/api/emails', { token: otherToken })).json.items.length, 0);
});

test('http: manual draft, AI settings guard, and API key storage', async () => {
  const fyi = await emailRow(`${RUN}-fyi`);
  const manual = await api(`/api/emails/${fyi.id}/draft`, { method: 'POST', body: { body: 'รับทราบครับ' } });
  assert.deepEqual([manual.status, manual.json.draft.source, manual.json.draft.status], [200, 'USER', 'PENDING']);
  const discarded = await api(`/api/drafts/${manual.json.draft.id}/discard`, { method: 'POST' });
  assert.equal(discarded.json.draft.status, 'DISCARDED');

  const noKey = await api('/api/settings', { method: 'PUT', body: { aiProvider: 'openai', aiModel: 'some-model' } });
  assert.equal(noKey.status, 400);

  const saved = await api('/api/settings/ai/keys/openai', { method: 'PUT', body: { apiKey: 'sk-test-0123456789' } });
  assert.equal(saved.json.providers.find((p) => p.id === 'openai').hasKey, true);
  assert.equal(JSON.stringify(saved.json).includes('sk-test-0123456789'), false);
  const stored = await prisma.aiCredential.findFirst({ where: { userId: user.id } });
  assert.match(stored.encryptedKey, /^enc:v1:/);

  assert.equal((await api('/api/settings', { method: 'PUT', body: { aiProvider: 'openai', aiModel: 'some-model', isAdmin: true } })).status, 200);
  await api('/api/settings/ai/keys/openai', { method: 'DELETE' });
  const final = (await api('/api/settings')).json;
  assert.deepEqual([final.setting.aiProvider, final.setting.aiModel], ['ollama', null]);
});
