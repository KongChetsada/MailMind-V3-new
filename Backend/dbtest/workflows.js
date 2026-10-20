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
  notifications: [], // อีเมลแจ้งเตือนนัดหมายที่ส่งถึงผู้ใช้
  failNotify: false,
  events: [], // ปฏิทินของผู้ใช้
  created: new Map(), // idempotencyKey -> event
  calendarInserts: 0,
  calendarUpdates: [],
  // การเปลี่ยนแปลงฝั่งผู้ให้บริการที่รอให้ระบบมาอ่าน (null = cursor หมดอายุ)
  historyId: 100,
  pendingChanges: { removedIds: [], restoredIds: [], readIds: [], unreadIds: [] },
  historyExpired: false,
  trashIds: [],
  changeCalls: 0,
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
  // เหมือน Gmail: before: เป็นวินาที ใหม่สุดก่อน
  async listMessageIdsBefore({ before, maxMessages }) {
    const limit = Math.floor(before.getTime() / 1000) * 1000;
    const ids = [...fake.messages.values()]
      .filter((m) => m.meta.receivedAt.getTime() < limit)
      .sort((a, b) => b.meta.receivedAt - a.meta.receivedAt)
      .map((m) => m.meta.providerMessageId);
    return { ids: ids.slice(0, maxMessages) };
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
        attachments: (m.attachments || []).map(({ partId, filename, mimeType, data }) => ({ partId, filename, mimeType, size: data.length })),
      }));
  },
  async getAttachment(messageId, partId) {
    const m = fake.messages.get(messageId);
    const file = m?.attachments?.find((a) => a.partId === partId);
    return file ? { threadId: m.meta.providerThreadId, filename: file.filename, mimeType: file.mimeType, data: file.data } : null;
  },
  async sendReply(payload) {
    if (fake.sendDelayMs) await sleep(fake.sendDelayMs);
    if (fake.failSend) throw new Error('smtp rejected');
    fake.sent.push(payload);
    return { id: `sent-${fake.sent.length}` };
  },
  async sendNotification(payload) {
    if (fake.failNotify) throw new Error("quota exceeded");
    fake.notifications.push(payload);
    return { id: `notify-${fake.notifications.length}` };
  },
  async markRead() {},
  async getChangeCursor() {
    return String(fake.historyId);
  },
  async getChanges({ cursor }) {
    fake.changeCalls += 1;
    if (fake.historyExpired) {
      fake.historyExpired = false;
      return { cursor: null, removedIds: [], restoredIds: [], readIds: [], unreadIds: [], expired: true };
    }
    assert.equal(cursor, String(fake.historyId)); // ระบบต้องส่งตำแหน่งล่าสุดที่เก็บไว้กลับมา
    const changes = fake.pendingChanges;
    fake.pendingChanges = { removedIds: [], restoredIds: [], readIds: [], unreadIds: [] };
    fake.historyId += 1;
    return { cursor: String(fake.historyId), ...changes, expired: false };
  },
  async listRemovedIds() {
    return fake.trashIds;
  },
};

const calendar = {
  provider: 'GOOGLE',
  async listEvents() {
    if (fake.failCalendar) throw new Error('calendar api down');
    const expanded = [...fake.created.values()].flatMap((e) =>
      Array.from({ length: e.isAllDay ? 1 : e._input.repeatDays || 1 }, (_unused, i) =>
        i === 0 && !(e._input.repeatDays > 1)
          ? e
          : { ...e, id: `${e.id}_${i}`, recurringEventId: e.id, start: iso(new Date(new Date(e.start).getTime() + i * 86400000)), end: iso(new Date(new Date(e.end).getTime() + i * 86400000)) }
      )
    );
    return [...fake.events, ...expanded];
  },
  async updateEvent(input) {
    if (fake.failCalendar) throw new Error('calendar api down');
    fake.calendarUpdates.push(input);
    const event = [...fake.created.values()].find((e) => e.id === input.eventId);
    if (event) Object.assign(event, { start: iso(new Date(input.start)), end: iso(new Date(input.end)), isAllDay: input.isAllDay, _input: { ...event._input, repeatDays: input.repeatDays } });
    return { id: input.eventId, htmlLink: 'http://cal/x' };
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
const dayAfterMonday = (days, hour) => new Date(nextMonday(hour).getTime() + days * 24 * 60 * 60 * 1000);

const todayParts = () => {
  const p = time.zonedParts(new Date(), TZ);
  return { year: p.year, month: p.month, day: p.day };
};
// ช่วงสามวันที่เริ่มอีก 20 วันข้างหน้า พร้อมข้อความแบบ dd/mm/พ.ศ. - dd/mm/พ.ศ.
const tripRange = () => {
  const start = time.addZonedDays(time.startOfZonedDay(new Date(), TZ), 20, TZ);
  const end = time.addZonedDays(start, 2, TZ);
  const fmt = (d) => {
    const p = time.zonedParts(d, TZ);
    return `${p.day}/${p.month}/${p.year + 543}`;
  };
  return { start, end, text: `วันที่ ${fmt(start)} - ${fmt(end)} ไปเที่ยวภูหลายวันกันไหม` };
};

// วันจันทร์ถัดไปอีกสามสัปดาห์ + n วัน เวลา hour:00 (วันทำงาน ไม่ชนกับ test อื่น)
const fieldDay = (offsetDays, hour) => new Date(nextMonday(hour).getTime() + (21 + offsetDays) * 24 * 60 * 60 * 1000);

const scriptedThreadAnalysis = (prompt) => {
  const appointment = (item) => ({ category: 'APPOINTMENT', priority: 'NORMAL', summary: 'เธรดทดสอบ', needsReply: false, replyIntent: null, actionItems: [item] });
  const event = (fields) => ({ kind: 'EVENT', isAllDay: false, isTimeSpecified: true, end: null, evidence: null, ...fields });
  // ลงพื้นที่สองวัน เวลา 09:00–15:00: โมเดลให้วันแรก 09:00 ถึงวันสุดท้าย 15:00 (เหมือนที่โมเดลจริงทำ)
  if (prompt.includes('ลงพื้นที่เก็บข้อมูลสองวัน')) return appointment(event({ title: 'นัดลงพื้นที่เก็บข้อมูล', start: iso(fieldDay(0, 9)), end: iso(fieldDay(1, 15)), evidence: 'เวลา 09.00 - 15.00 ทั้ง 2 วัน' }));
  // ทริปสามวัน: โมเดลสกัดมาแค่วันแรกพร้อมเวลา 00:00 (เหมือนที่โมเดลจริงทำ)
  if (prompt.includes('เตรียมของมาให้พร้อม')) return appointment(event({ title: 'นัดรวมตัว', start: iso(time.zonedToUtc({ ...todayParts(), hour: 5 }, TZ)), location: 'หน้ามหาลัย' }));
  if (prompt.includes('ไปเที่ยวภูหลายวัน')) return appointment(event({ title: 'ไปเที่ยวภูหลายวัน', start: iso(tripRange().start), evidence: tripRange().text }));
  // ทริป: ฉบับตอบกลับบอกเวลานัดพบในวันเดียวกัน (AI ไม่ได้บอกว่าเกี่ยวข้อง — ต้องผูกด้วยกฎ)
  if (prompt.includes('เจอกันที่หอตีสอง')) return appointment(event({ title: 'ออกเดินทาง - นัดเจอที่หอ', start: iso(dayAfterMonday(7, 2)), location: 'หอ' }));
  if (prompt.includes('ไปเที่ยวภูทดสอบ')) return appointment(event({ title: 'ไปเที่ยวภูทดสอบ', start: iso(time.startOfZonedDay(dayAfterMonday(7, 10), TZ)), isAllDay: true, isTimeSpecified: false }));
  // เลื่อนนัด: AI ไม่ได้บอกความสัมพันธ์ (โมเดลเล็กมักไม่บอก) — ต้องผูกด้วยคำว่า "เลื่อน" ในข้อความล่าสุด
  if (prompt.includes('ขอเลื่อนเป็นวันพุธบ่ายสาม')) return appointment(event({ title: 'ประชุมงบประมาณ', start: iso(dayAfterMonday(9, 15)), end: iso(dayAfterMonday(9, 16)) }));
  // ยืนยันซ้ำ: เวลาเดิมทุกประการ
  if (prompt.includes('ยืนยันตามเวลาเดิมนะครับ')) return appointment(event({ title: 'ประชุมงบประมาณ (ยืนยัน)', start: iso(dayAfterMonday(8, 14)), end: iso(dayAfterMonday(8, 15)) }));
  if (prompt.includes('นัดประชุมงบประมาณ')) return appointment(event({ title: 'ประชุมงบประมาณ', start: iso(dayAfterMonday(8, 14)), end: iso(dayAfterMonday(8, 15)) }));
  return null;
};

const scriptedAnalysis = (prompt) => {
  const threadResult = scriptedThreadAnalysis(prompt);
  if (threadResult) return threadResult;
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
    // ปิดวิเคราะห์อัตโนมัติ: ถ้ามีเซิร์ฟเวอร์จริงรันอยู่บนฐานข้อมูลเดียวกัน งานของเซิร์ฟเวอร์นั้นจะไม่มาแย่งอีเมลทดสอบไปวิเคราะห์
    data: { email: `dbtest-${RUN}@example.com`, name: 'DB Test', setting: { create: { timezone: TZ, gender: 'MALE', firstName: 'ทดสอบ', isAutoAnalyzeActive: false } } },
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

// ───────── เธรด: ผูกรายการใหม่กับรายการเดิม ─────────
const addThreadMessage = async (id, threadId, subject, text) => {
  addMessage(id, { subject, text, threadId });
  await sleep(5); // ให้เวลารับของแต่ละฉบับต่างกัน
  await syncAccount(account.id);
  const row = await emailRow(id);
  await analyzeEmail(row.id);
  return emailRow(id);
};

test('thread: a same-day detail is linked by rule, checked for conflicts only, and can be added as its own event', async () => {
  const first = await addThreadMessage(`${RUN}-trip1`, `t-${RUN}-trip`, 'ไปเที่ยวภูทดสอบ', 'ชวนไปเที่ยวภูทดสอบวันจันทร์ถัดไป ทั้งวัน');
  const [trip] = first.actionItems;
  assert.deepEqual([trip.isAllDay, trip.relatedActionId], [true, null]);
  await confirmActionItem(user.id, trip.id, {});

  fake.aiCalls.length = 0;
  const reply = await addThreadMessage(`${RUN}-trip2`, `t-${RUN}-trip`, 'Re: ไปเที่ยวภูทดสอบ', 'เจอกันที่หอตีสอง เดี๋ยวไปรับ');
  assert.match(fake.aiCalls[0], /ITEMS ALREADY RECORDED[\s\S]*#1 EVENT "ไปเที่ยวภูทดสอบ"/);

  const [detail] = reply.actionItems;
  assert.deepEqual([detail.relatedActionId, detail.relation, detail.title], [trip.id, 'DETAIL', 'ออกเดินทาง - นัดเจอที่หอ']);
  // ตีสองอยู่นอกเวลาทำงาน แต่รายการที่ผูกแล้วตรวจแค่การชน และไม่เสนอเวลาอื่น
  assert.deepEqual([detail.availability, detail.suggestedSlots], ['AVAILABLE', null]);

  const inserts = fake.calendarInserts;
  const done = await confirmActionItem(user.id, detail.id, { mode: 'CREATE' });
  assert.deepEqual([done.status, done.relatedAction.id], ['CREATED', trip.id]);
  assert.equal(fake.calendarInserts, inserts + 1);
  assert.equal(fake.calendarUpdates.length, 0);
  const tripAfter = await prisma.actionItem.findUnique({ where: { id: trip.id } });
  assert.deepEqual([tripAfter.status, tripAfter.isAllDay], ['CREATED', true]); // กิจกรรมเดิมไม่ถูกแตะ
});

test('thread: an explicit reschedule updates the original event instead of creating a second one', async () => {
  const first = await addThreadMessage(`${RUN}-bud1`, `t-${RUN}-bud`, 'นัดประชุมงบประมาณ', 'ขอนัดประชุมงบประมาณวันอังคารบ่ายสอง');
  const [meeting] = first.actionItems;
  await confirmActionItem(user.id, meeting.id, {});
  const eventId = (await prisma.actionItem.findUnique({ where: { id: meeting.id } })).externalEventId;

  // ฉบับยืนยันเวลาเดิม: ไม่เกิดรายการซ้ำ
  const same = await addThreadMessage(`${RUN}-bud2`, `t-${RUN}-bud`, 'Re: นัดประชุมงบประมาณ', 'ยืนยันตามเวลาเดิมนะครับ');
  assert.equal(same.actionItems.length, 0);

  const reply = await addThreadMessage(`${RUN}-bud3`, `t-${RUN}-bud`, 'Re: นัดประชุมงบประมาณ', 'ขอเลื่อนเป็นวันพุธบ่ายสาม');
  const [moved] = reply.actionItems;
  assert.deepEqual([moved.relatedActionId, moved.relation], [meeting.id, 'RESCHEDULE']);

  const inserts = fake.calendarInserts;
  const results = await Promise.allSettled([
    confirmActionItem(user.id, moved.id, { mode: 'UPDATE_RELATED' }),
    confirmActionItem(user.id, moved.id, { mode: 'UPDATE_RELATED' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(fake.calendarInserts, inserts); // ไม่มีกิจกรรมใหม่
  assert.equal(fake.calendarUpdates.length, 1);
  assert.deepEqual([fake.calendarUpdates[0].eventId, iso(new Date(fake.calendarUpdates[0].start))], [eventId, iso(moved.startAt)]);

  const after = await prisma.actionItem.findMany({ where: { id: { in: [meeting.id, moved.id] } } });
  const original = after.find((a) => a.id === meeting.id);
  const merged = after.find((a) => a.id === moved.id);
  assert.deepEqual([original.status, iso(original.startAt), original.title], ['CREATED', iso(moved.startAt), 'ประชุมงบประมาณ']);
  assert.equal(merged.status, 'MERGED');
  await assert.rejects(() => confirmActionItem(user.id, moved.id, { mode: 'CREATE' }), { code: 'ACTION_NOT_CONFIRMABLE' });

  const detail = await api(`/api/emails/${reply.id}`);
  assert.deepEqual([detail.json.actionItems[0].status, detail.json.actionItems[0].related.title, detail.json.createdActions], ['MERGED', 'ประชุมงบประมาณ', 1]);
});

test('thread: updating a related item that is not on the calendar yet changes only the stored suggestion', async () => {
  const first = await addThreadMessage(`${RUN}-bud4`, `t-${RUN}-bud-b`, 'นัดประชุมงบประมาณ', 'ขอนัดประชุมงบประมาณวันอังคารบ่ายสอง (รอบสอง)');
  const [pending] = first.actionItems; // ยังไม่ยืนยัน
  const reply = await addThreadMessage(`${RUN}-bud5`, `t-${RUN}-bud-b`, 'Re: นัดประชุมงบประมาณ', 'ขอเลื่อนเป็นวันพุธบ่ายสาม');
  const [moved] = reply.actionItems;
  assert.equal(moved.relation, 'RESCHEDULE');

  const updates = fake.calendarUpdates.length;
  await confirmActionItem(user.id, moved.id, { mode: 'UPDATE_RELATED', force: true });
  assert.equal(fake.calendarUpdates.length, updates); // ไม่มีอะไรในปฏิทินให้แก้
  const original = await prisma.actionItem.findUnique({ where: { id: pending.id } });
  assert.deepEqual([original.status, iso(original.startAt)], ['SUGGESTED', iso(moved.startAt)]);

  await assert.rejects(() => confirmActionItem(user.id, pending.id, { mode: 'UPDATE_RELATED' }), { status: 400 }); // ไม่ได้ผูกกับรายการใด
});

test('thread: the job analyses earlier messages of a thread first, so a newer reply can link to them', async () => {
  addMessage(`${RUN}-trip3`, { subject: 'ไปเที่ยวภูทดสอบ', text: 'ชวนไปเที่ยวภูทดสอบวันจันทร์ถัดไป ทั้งวัน (รอบสาม)', threadId: `t-${RUN}-trip-c` });
  await sleep(5);
  addMessage(`${RUN}-trip4`, { subject: 'Re: ไปเที่ยวภูทดสอบ', text: 'เจอกันที่หอตีสอง เดี๋ยวไปรับ', threadId: `t-${RUN}-trip-c` });
  await syncAccount(account.id);

  await runAnalyzeJob(undefined, { accountIds: [account.id] }); // หยิบฉบับใหม่สุดก่อน
  const original = await emailRow(`${RUN}-trip3`);
  const reply = await emailRow(`${RUN}-trip4`);
  assert.deepEqual([original.analysisStatus, reply.analysisStatus], ['DONE', 'DONE']);
  assert.ok(original.analyzedAt <= reply.analyzedAt);
  assert.deepEqual([reply.actionItems[0].relatedActionId, reply.actionItems[0].relation], [original.actionItems[0].id, 'DETAIL']);
});

test('thread: a multi-day trip is stored as one all-day range, and a later time-only reply lands on its first day', async () => {
  const range = tripRange();
  const first = await addThreadMessage(`${RUN}-multi1`, `t-${RUN}-multi`, 'นัดไปเที่ยวภูหลายวัน', range.text);
  const [trip] = first.actionItems;
  assert.deepEqual([trip.isAllDay, trip.isTimeSpecified, iso(trip.startAt), iso(trip.endAt)], [true, false, iso(range.start), iso(range.end)]);

  const done = await confirmActionItem(user.id, trip.id, {});
  const created = fake.created.get(trip.id);
  assert.deepEqual([done.status, created.isAllDay, created.start, created.end], ['CREATED', true, iso(range.start), iso(range.end)]);

  // ฉบับตอบกลับบอกแค่ "05.00" — โมเดลใส่วันนี้มา ระบบต้องย้ายไปวันแรกของทริปและผูกเป็นรายละเอียดเพิ่ม
  const reply = await addThreadMessage(`${RUN}-multi2`, `t-${RUN}-multi`, 'Re: นัดไปเที่ยวภูหลายวัน', 'นัดรวมตัว 05.00 ที่หน้ามหาลัย นะ เตรียมของมาให้พร้อม');
  const [meet] = reply.actionItems;
  const expectedStart = new Date(range.start.getTime() + 5 * 60 * 60 * 1000);
  assert.deepEqual([iso(meet.startAt), meet.relatedActionId, meet.relation], [iso(expectedStart), trip.id, 'DETAIL']);
  assert.ok(meet.missingFields.includes('date')); // ติดธงให้ผู้ใช้ตรวจวัน
  assert.equal(meet.availability, 'AVAILABLE'); // ทริปทั้งวันของตัวเองไม่นับว่าชน
});

// ───────── ตามการลบฝั่งผู้ให้บริการ ─────────
test('provider changes: mail deleted or trashed outside the app disappears from the inbox but keeps its history', async () => {
  const appt = await emailRow(`${RUN}-appt`); // ตอบแล้วและลงปฏิทินแล้ว
  const fyi = await emailRow(`${RUN}-fyi`);
  const before = (await api('/api/emails/counts')).json.total;
  const statsBefore = (await api('/api/summary/stats?days=7')).json;

  // รอบแรกหลังเปิดใช้ (บัญชีที่ยังไม่มีตำแหน่ง): ตั้งจุดเริ่ม แล้วตรวจย้อนหลังจากถังขยะ
  await prisma.mailAccount.update({ where: { id: account.id }, data: { changeCursor: null } });
  fake.trashIds = [fyi.providerMessageId, 'unknown-message'];
  const calls = fake.changeCalls;
  const first = await syncAccount(account.id);
  assert.deepEqual([first.removed, fake.changeCalls], [1, calls]); // ยังไม่มี cursor จึงไม่ได้ถาม history
  assert.equal((await prisma.mailAccount.findUnique({ where: { id: account.id } })).changeCursor, String(fake.historyId));

  // รอบถัดไป: หนึ่งคำขอ ได้ทั้งรายการที่ถูกลบและสถานะอ่านแล้ว
  const late2 = await emailRow(`${RUN}-late2`);
  fake.pendingChanges = { removedIds: [appt.providerMessageId], restoredIds: [], readIds: [late2.providerMessageId], unreadIds: [] };
  const second = await syncAccount(account.id);
  assert.deepEqual([second.removed, second.readChanged, fake.changeCalls], [1, 1, calls + 1]);
  assert.equal((await emailRow(`${RUN}-late2`)).isRead, true);

  const list = (await api('/api/emails?limit=100')).json.items.map((e) => e.id);
  assert.equal(list.includes(appt.id) || list.includes(fyi.id), false);
  assert.equal((await api('/api/emails/counts')).json.total, before - 2);
  assert.equal((await api('/api/emails?category=APPOINTMENT&limit=100')).json.items.some((e) => e.id === appt.id), false);

  // ประวัติยังอยู่: ร่างที่ส่งแล้ว รายการที่ลงปฏิทินแล้ว และสถิติ
  const kept = await emailRow(`${RUN}-appt`);
  assert.ok(kept.removedAt);
  assert.equal(kept.replyDraft.status, 'SENT');
  const statsAfter = (await api('/api/summary/stats?days=7')).json;
  assert.deepEqual([statsAfter.emails.total, statsAfter.drafts.sent, statsAfter.actions.created], [statsBefore.emails.total, statsBefore.drafts.sent, statsBefore.actions.created]);
  const detail = (await api(`/api/emails/${appt.id}`)).json;
  assert.match(detail.threadError, /ถูกลบ/);
});

test('provider changes: a removed email is not analysed, a restored one comes back, and an expired cursor falls back safely', async () => {
  addMessage(`${RUN}-gone`, { subject: 'ประกาศ 9', text: 'แจ้งเพื่อทราบ' });
  await syncAccount(account.id);
  const gone = await emailRow(`${RUN}-gone`);
  fake.pendingChanges.removedIds = [gone.providerMessageId];
  await syncAccount(account.id);
  await runAnalyzeJob(undefined, { accountIds: [account.id] });
  assert.equal((await emailRow(`${RUN}-gone`)).analysisStatus, 'PENDING'); // ถูกซ่อนอยู่ จึงไม่เสีย AI

  // กู้คืนจากถังขยะ: กลับมาในรายการและถูกวิเคราะห์ตามปกติ
  fake.pendingChanges.restoredIds = [gone.providerMessageId];
  const restored = await syncAccount(account.id);
  assert.equal(restored.restored, 1);
  assert.equal((await emailRow(`${RUN}-gone`)).removedAt, null);
  await runAnalyzeJob(undefined, { accountIds: [account.id] });
  assert.equal((await emailRow(`${RUN}-gone`)).analysisStatus, 'DONE');

  // cursor หมดอายุ: ตั้งจุดเริ่มใหม่และใช้ถังขยะแทน ไม่ทำให้ซิงก์ล้ม
  fake.historyExpired = true;
  fake.historyId = 500;
  fake.trashIds = [gone.providerMessageId];
  const fallback = await syncAccount(account.id);
  assert.deepEqual([fallback.status, fallback.removed], ['completed', 1]);
  assert.equal((await prisma.mailAccount.findUnique({ where: { id: account.id } })).changeCursor, '500');

  // อ่านการเปลี่ยนแปลงไม่ได้: อีเมลใหม่ยังเข้า และตำแหน่งเดิมคงไว้
  addMessage(`${RUN}-new-after`, { subject: 'ประกาศ 10', text: 'แจ้งเพื่อทราบ' });
  const original = mail.getChanges;
  mail.getChanges = async () => { throw new Error('history api down'); };
  const partial = await syncAccount(account.id);
  mail.getChanges = original;
  assert.deepEqual([partial.status, partial.created, partial.removed], ['completed', 1, 0]);
  assert.equal((await prisma.mailAccount.findUnique({ where: { id: account.id } })).changeCursor, '500');
});

test('multi-day with hours: stored as a daily repeat, every day checked, and saved as one recurring event', async () => {
  const email = await addThreadMessage(`${RUN}-field`, `t-${RUN}-field`, 'นัดลงพื้นที่เก็บข้อมูลสองวัน', 'นัดลงพื้นที่เก็บข้อมูลสองวัน เวลา 09.00 - 15.00 ทั้ง 2 วัน');
  const [item] = email.actionItems;
  assert.deepEqual([iso(item.startAt), iso(item.endAt), item.repeatDays, item.availability], [iso(fieldDay(0, 9)), iso(fieldDay(0, 15)), 2, 'AVAILABLE']);

  // มีนัดอื่นโผล่มาในวันที่สอง → ตรวจซ้ำตอนยืนยันแล้วพบ
  fake.events.push({ id: 'day2', title: 'นัดวันที่สอง', start: iso(fieldDay(1, 10)), end: iso(fieldDay(1, 11)), isAllDay: false });
  await assert.rejects(() => confirmActionItem(user.id, item.id, {}), (e) => e.code === 'CALENDAR_CONFLICT' && e.details.conflict.id === 'day2');
  fake.events.pop();

  const inserts = fake.calendarInserts;
  const done = await confirmActionItem(user.id, item.id, {});
  const created = fake.created.get(item.id);
  assert.equal(done.status, 'CREATED');
  assert.equal(fake.calendarInserts, inserts + 1); // กิจกรรมเดียวที่เกิดซ้ำ ไม่ใช่สองกิจกรรม
  assert.deepEqual([created._input.repeatDays, created.start, created.end], [2, iso(fieldDay(0, 9)), iso(fieldDay(0, 15))]);

  // หน้าปฏิทินได้ทั้งสองวัน
  const days = (await api('/api/calendar')).json.items.filter((e) => e.title === 'นัดลงพื้นที่เก็บข้อมูล').map((e) => e.start);
  assert.deepEqual(days, [iso(fieldDay(0, 9)), iso(fieldDay(1, 9))]);
});

test('multi-day: a one-day item can be extended to several days by the user, and invalid combinations are refused', async () => {
  const late1 = await emailRow(`${RUN}-late1`);
  const [item] = late1.actionItems; // รายการวันเดียวที่มีเวลา
  const start = fieldDay(7, 13);
  const end = fieldDay(7, 16);
  const put = (body) => api(`/api/actions/${item.id}`, { method: 'PUT', body });

  const daily = await put({ startAt: iso(start), endAt: iso(end), repeatDays: 3, isAllDay: false });
  assert.deepEqual([daily.status, daily.json.action.repeatDays, daily.json.action.endAt], [200, 3, iso(end)]);
  // ต่อเนื่องข้ามวัน: วันสิ้นสุดอยู่คนละวัน และไม่ซ้ำ
  const continuous = await put({ startAt: iso(start), endAt: iso(fieldDay(8, 16)), repeatDays: 1 });
  assert.deepEqual([continuous.status, continuous.json.action.repeatDays], [200, 1]);
  // ซ้ำรายวันแต่ช่วงเวลายาวเกินหนึ่งวัน หรือจำนวนวันเกินกำหนด → ปฏิเสธ
  assert.equal((await put({ startAt: iso(start), endAt: iso(fieldDay(8, 16)), repeatDays: 2 })).status, 400);
  assert.equal((await put({ repeatDays: 60 })).status, 400);
  // เปลี่ยนเป็นทั้งวันหลายวัน: ไม่ใช้การซ้ำ
  const allDay = await put({ isAllDay: true, startAt: iso(fieldDay(7, 0)), endAt: iso(fieldDay(9, 0)), repeatDays: 3 });
  assert.deepEqual([allDay.json.action.isAllDay, allDay.json.action.repeatDays], [true, 1]);
});

// ───────── แจ้งเตือนนัดหมายทางอีเมล ─────────
const notificationsFor = (emailId) => fake.notifications.filter((n) => n.html.includes(`?email=${emailId}`));

test('notify: a new appointment is emailed to the user once, with a link to the email', async () => {
  addMessage(`${RUN}-notify`, { subject: 'นัดประชุมโครงการ (แจ้งเตือน)', text: 'ขอนัดประชุมโครงการ วันจันทร์หน้า เวลา 10:00 - 11:30 น. ห้อง 301' });
  // ฉบับย้อนหลังที่ได้รับก่อนเชื่อมบัญชี (ดึงมาตอนเชื่อมครั้งแรก) ไม่แจ้ง
  addMessage(`${RUN}-notify-old`, { subject: 'นัดประชุมโครงการ (เก่า)', text: 'ขอนัดประชุมโครงการ วันจันทร์หน้า เวลา 10:00 - 11:30 น.' });
  fake.messages.get(`${RUN}-notify-old`).meta.receivedAt = new Date(account.createdAt.getTime() - 86400000);
  await syncAccount(account.id);

  const row = await emailRow(`${RUN}-notify`);
  assert.equal((await analyzeEmail(row.id)).ok, true);
  const sent = notificationsFor(row.id);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, account.emailAddress);
  assert.match(sent[0].subject, /นัดหมายใหม่/);
  assert.match(sent[0].html, /ร่างการตอบกลับ/); // ร่างตอบอัตโนมัติเสร็จก่อนแจ้ง
  assert.ok((await emailRow(`${RUN}-notify`)).notifiedAt);

  // วิเคราะห์ใหม่ไม่แจ้งซ้ำ
  await analyzeEmail(row.id, { force: true });
  assert.equal(notificationsFor(row.id).length, 1);

  const old = await emailRow(`${RUN}-notify-old`);
  assert.equal((await analyzeEmail(old.id)).ok, true);
  assert.deepEqual([notificationsFor(old.id).length, (await emailRow(`${RUN}-notify-old`)).notifiedAt], [0, null]);
});

test('notify: respects the setting, and a failed send keeps the analysis and allows a retry', async () => {
  addMessage(`${RUN}-notify-off`, { subject: 'นัดประชุมโครงการ (ปิดแจ้งเตือน)', text: 'ขอนัดประชุมโครงการ วันจันทร์หน้า เวลา 10:00 - 11:30 น.' });
  addMessage(`${RUN}-notify-fail`, { subject: 'นัดประชุมโครงการ (ส่งไม่ผ่าน)', text: 'ขอนัดประชุมโครงการ วันจันทร์หน้า เวลา 10:00 - 11:30 น.' });
  await syncAccount(account.id);

  await prisma.userSetting.update({ where: { userId: user.id }, data: { notifyNewAppointments: false } });
  const off = await emailRow(`${RUN}-notify-off`);
  await analyzeEmail(off.id);
  assert.equal(notificationsFor(off.id).length, 0);
  await prisma.userSetting.update({ where: { userId: user.id }, data: { notifyNewAppointments: true } });

  const failing = await emailRow(`${RUN}-notify-fail`);
  fake.failNotify = true;
  const result = await analyzeEmail(failing.id);
  fake.failNotify = false;
  const afterFail = await emailRow(`${RUN}-notify-fail`);
  assert.deepEqual([result.ok, afterFail.analysisStatus, afterFail.notifiedAt, notificationsFor(failing.id).length], [true, 'DONE', null, 0]);
  await analyzeEmail(failing.id, { force: true });
  assert.equal(notificationsFor(failing.id).length, 1);

  // เมลที่ไม่ใช่นัดหมายไม่แจ้ง
  assert.equal(notificationsFor((await emailRow(`${RUN}-fyi`)).id).length, 0);
});

// ───────── ดึงอีเมลย้อนหลัง ─────────
const { backfillChunk } = require('../src/workflows/backfillAccount');
const { startBackfill, stopBackfill } = require('../src/jobs/backfillJob');

test('backfill: fetches all older inbox mail in chunks as MANUAL, without duplicates, and the job leaves it alone', async () => {
  overrideDeps({ backfillPauseMs: 0 });
  const oldest = (await prisma.emailMessage.findFirst({ where: { mailAccountId: account.id }, orderBy: { receivedAt: 'asc' } })).receivedAt;
  // เมลเก่า 450 ฉบับ (ย้อนไปทีละชั่วโมง) + โปรโมชัน 1 ฉบับ — มากกว่าหนึ่งช่วง (200)
  for (let i = 1; i <= 450; i += 1) {
    addMessage(`${RUN}-old-${i}`, { subject: `เมลเก่า ${i}`, text: 'ขอนัดประชุมโครงการ วันจันทร์หน้า เวลา 10:00 - 11:30 น.' });
    fake.messages.get(`${RUN}-old-${i}`).meta.receivedAt = new Date(oldest.getTime() - i * 3600 * 1000);
  }
  addMessage(`${RUN}-old-promo`, { subject: 'โปรเก่า', text: 'ลดราคา', labels: ['INBOX', 'CATEGORY_PROMOTIONS'] });
  fake.messages.get(`${RUN}-old-promo`).meta.receivedAt = new Date(oldest.getTime() - 10 * 60 * 1000);

  // ช่วงแรกช่วงเดียว แล้วหยุด (เหมือนผู้ใช้กดหยุด) — ทำต่อจากตำแหน่งเดิมได้
  const first = await backfillChunk(account.id);
  assert.deepEqual([first.done, first.created], [false, 200]);
  const paused = await prisma.mailAccount.findUnique({ where: { id: account.id } });
  assert.equal(paused.backfillCursor.getTime(), first.cursor.getTime());

  const listed = await api('/api/accounts');
  assert.deepEqual([listed.json.items[0].backfill.status, listed.json.items[0].backfill.count], ['paused', 200]);

  // ทำต่อจนจบผ่าน job
  const result = await startBackfill(account.id, { wait: true });
  assert.deepEqual([result.status, result.created], ['done', 251]);
  const done = await prisma.mailAccount.findUnique({ where: { id: account.id } });
  assert.ok(done.backfillDoneAt);
  assert.equal(done.backfillCount, 451);
  assert.equal(done.backfillCursor.getTime(), oldest.getTime() - 450 * 3600 * 1000);

  const rows = await prisma.emailMessage.findMany({ where: { mailAccountId: account.id, providerMessageId: { startsWith: `${RUN}-old-` } } });
  assert.equal(rows.length, 451);
  assert.equal(rows.filter((r) => r.analysisStatus === 'MANUAL').length, 450);
  assert.equal(rows.find((r) => r.providerMessageId === `${RUN}-old-promo`).analysisStatus, 'SKIPPED');

  // ดึงซ้ำไม่สร้างแถวซ้ำ
  await prisma.mailAccount.update({ where: { id: account.id }, data: { backfillCursor: oldest, backfillDoneAt: null } });
  await startBackfill(account.id, { wait: true });
  assert.equal(await prisma.emailMessage.count({ where: { mailAccountId: account.id, providerMessageId: { startsWith: `${RUN}-old-` } } }), 451);

  // งานวิเคราะห์อัตโนมัติไม่หยิบอีเมลย้อนหลัง
  await prisma.userSetting.update({ where: { userId: user.id }, data: { isAutoAnalyzeActive: true } });
  const callsBefore = fake.aiCalls.length;
  await runAnalyzeJob(undefined, { accountIds: [account.id] });
  await prisma.userSetting.update({ where: { userId: user.id }, data: { isAutoAnalyzeActive: false } });
  const stillManual = await emailRow(`${RUN}-old-1`);
  assert.equal(stillManual.analysisStatus, 'MANUAL');
  assert.ok(!fake.aiCalls.slice(callsBefore).some((p) => p.includes('เมลเก่า')));

  // กดวิเคราะห์เองได้ และไม่ส่งแจ้งเตือน (ได้รับก่อนเชื่อมบัญชี)
  const http = await api(`/api/emails/${stillManual.id}/analyze`, { method: 'POST' });
  assert.equal(http.status, 200);
  assert.equal(http.json.analysisStatus, 'DONE');
  assert.equal(fake.notifications.filter((n) => n.html.includes(`?email=${stillManual.id}`)).length, 0);
});

test('backfill: http start/stop is limited to the owner and reports progress', async () => {
  const other = await api(`/api/accounts/${account.id}/backfill`, { method: 'POST', token: signUserToken(otherUser) });
  assert.equal(other.status, 404);
  const otherStop = await api(`/api/accounts/${account.id}/backfill/stop`, { method: 'POST', token: signUserToken(otherUser) });
  assert.equal(otherStop.status, 404);

  const started = await api(`/api/accounts/${account.id}/backfill`, { method: 'POST' });
  assert.equal(started.status, 202);
  assert.ok(['running', 'done'].includes(started.json.account.backfill.status));
  const stopped = await api(`/api/accounts/${account.id}/backfill/stop`, { method: 'POST' });
  assert.equal(stopped.status, 200);
  // รอให้งานเบื้องหลังที่อาจยังวิ่งอยู่จบ ก่อนลบข้อมูลทดสอบ
  for (let i = 0; i < 50 && require('../src/jobs/backfillJob').isBackfillRunning(account.id); i += 1) await sleep(50);
  await stopBackfill(account.id);
});

// ───────── ไฟล์แนบ ─────────
test('attachments: listed in the detail, served to the owner only, and unsafe types are downloaded not rendered', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  addMessage(`${RUN}-att`, { subject: 'ทดสอบส่งรูป', text: 'ทดสอบส่งรูป' });
  fake.messages.get(`${RUN}-att`).attachments = [
    { partId: '1', filename: '51639_0.jpg', mimeType: 'image/jpeg', data: jpeg },
    { partId: '2', filename: 'รายงาน.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF-1.4') },
    { partId: '3', filename: 'logo.svg', mimeType: 'image/svg+xml', data: Buffer.from('<svg onload="alert(1)"/>') },
  ];
  await syncAccount(account.id);
  const row = await emailRow(`${RUN}-att`);

  const detail = await api(`/api/emails/${row.id}`);
  assert.deepEqual(
    detail.json.messages[0].attachments.map((a) => [a.partId, a.filename, a.size]),
    [['1', '51639_0.jpg', 8], ['2', 'รายงาน.pdf', 8], ['3', 'logo.svg', 24]]
  );

  const raw = (path, token = signUserToken(user)) => fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const base = `/api/emails/${row.id}/attachments/${RUN}-att`;

  const image = await raw(`${base}/1`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.match(image.headers.get('content-disposition'), /^inline;/);
  assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), jpeg);

  const pdf = await raw(`${base}/2`);
  assert.equal(pdf.headers.get('content-type'), 'application/octet-stream');
  assert.match(pdf.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''%E0%B8%A3/);

  const svg = await raw(`${base}/3`);
  assert.equal(svg.headers.get('content-type'), 'application/octet-stream'); // SVG มีสคริปต์ได้ ไม่แสดงตรง ๆ
  assert.match(svg.headers.get('content-disposition'), /^attachment;/);

  assert.equal((await raw(`${base}/1`, signUserToken(otherUser))).status, 404); // อีเมลของคนอื่น
  assert.equal((await raw(`/api/emails/${row.id}/attachments/${RUN}-appt/1`)).status, 404); // ข้อความจากเธรดอื่น
  assert.equal((await raw(`${base}/9`)).status, 404);
  assert.equal((await raw(`${base}/abc`)).status, 400);
});

// ───────── template ตอบกลับ (RAG) ─────────
const { tokenize } = require('../src/core/templates/retrieval');
const { DEFAULT_TEMPLATES } = require('../src/core/templates/defaults');

// embedding จำลอง: ถุงคำที่ hash ลง 64 มิติ (คำเหมือนกัน → เวกเตอร์ใกล้กัน)
const fakeEmbedding = { model: 'fake-embed', down: false, calls: 0 };
const hashVector = (text) => {
  const v = new Array(64).fill(0);
  for (const w of tokenize(text)) {
    let h = 0;
    for (const ch of w) h = (h * 31 + ch.codePointAt(0)) % 64;
    v[h] += 1;
  }
  return v;
};
overrideDeps({
  embeddingModel: () => fakeEmbedding.model,
  embed: async (texts) => {
    fakeEmbedding.calls += 1;
    return fakeEmbedding.down ? null : texts.map(hashVector);
  },
});

test('templates: the sample set is created once, drafts use the closest template, and the choice is recorded', async () => {
  const first = await api('/api/templates');
  assert.equal(first.status, 200);
  assert.equal(first.json.items.length, DEFAULT_TEMPLATES.length);
  assert.equal((await api('/api/templates')).json.items.length, DEFAULT_TEMPLATES.length); // ไม่สร้างซ้ำ

  addMessage(`${RUN}-tpl`, { subject: 'ขอเลื่อนนัดประชุมโครงการ', text: 'ขอนัดประชุมโครงการ วันจันทร์หน้า เวลา 10:00 - 11:30 น. ห้อง 301 ขอเลื่อนจากเดิม' });
  await syncAccount(account.id);
  const row = await emailRow(`${RUN}-tpl`);
  await analyzeEmail(row.id);

  const callsBefore = fake.aiCalls.length;
  const draft = await generateDraft(row.id, { intent: 'ACCEPT' });
  const prompt = fake.aiCalls.slice(callsBefore).find((p) => p.includes('"draftMessage"'));
  const chosen = await prisma.replyTemplate.findUnique({ where: { id: draft.templateId } });
  assert.ok(chosen, 'draft records the template it was based on');
  assert.deepEqual([chosen.category, chosen.intent], ['APPOINTMENT', 'ACCEPT']);
  assert.match(prompt, /REFERENCE TEMPLATE/);
  assert.ok(prompt.includes(chosen.body.split('\n')[2].slice(0, 20)), 'template body is in the prompt');
  assert.equal(chosen.embeddingModel, 'fake-embed'); // คำนวณ embedding ให้ตอนค้นหา

  const detail = await api(`/api/emails/${row.id}`);
  assert.deepEqual(detail.json.draft.template, { id: chosen.id, name: chosen.name });

  const preview = await api('/api/templates/preview', { method: 'POST', body: { emailId: row.id, intent: 'ACCEPT' } });
  assert.deepEqual([preview.json.intent, preview.json.match.template.id, preview.json.match.method], ['ACCEPT', chosen.id, 'embedding']);
});

test('templates: falls back to keywords without embeddings, edits reset the vector, and no match means a plain draft', async () => {
  const row = await emailRow(`${RUN}-tpl`);

  fakeEmbedding.down = true;
  const keyword = await api('/api/templates/preview', { method: 'POST', body: { emailId: row.id, intent: 'DECLINE' } });
  assert.equal(keyword.json.match.method, 'keyword');
  assert.equal(keyword.json.match.template.intent, 'DECLINE');
  fakeEmbedding.down = false;

  // แก้เนื้อหา → embedding เดิมถูกล้าง
  const list = (await api('/api/templates')).json.items;
  const accept = list.filter((t) => t.category === 'APPOINTMENT' && t.intent === 'ACCEPT');
  const edited = await api(`/api/templates/${accept[0].id}`, { method: 'PUT', body: { body: 'เรียน [ชื่อผู้ส่ง]\n\nยินดีครับ พบกัน [วันเวลา]' } });
  assert.deepEqual([edited.status, edited.json.template.hasEmbedding], [200, false]);
  // แก้แค่เนื้อหา ประเภทและเจตนาต้องคงเดิม
  assert.deepEqual([edited.json.template.category, edited.json.template.intent, edited.json.template.name], ['APPOINTMENT', 'ACCEPT', accept[0].name]);

  // ปิดทุก template ของกรณีนี้ → ร่างแบบเดิม
  for (const t of accept) await api(`/api/templates/${t.id}`, { method: 'PUT', body: { isActive: false } });
  const callsBefore = fake.aiCalls.length;
  const plain = await generateDraft(row.id, { intent: 'ACCEPT' });
  assert.equal(plain.templateId, null);
  assert.doesNotMatch(fake.aiCalls.slice(callsBefore).find((p) => p.includes('"draftMessage"')), /REFERENCE TEMPLATE/);

  // ของคนอื่นแก้/ลบไม่ได้
  const otherToken = signUserToken(otherUser);
  assert.equal((await api(`/api/templates/${accept[0].id}`, { method: 'PUT', token: otherToken, body: { isActive: true } })).status, 404);
  assert.equal((await api(`/api/templates/${accept[0].id}`, { method: 'DELETE', token: otherToken })).status, 404);
  assert.equal((await api('/api/templates', { method: 'POST', body: { name: '', body: 'x' } })).status, 400);

  // ลบหมดแล้วไม่สร้างชุดตัวอย่างคืน
  for (const t of (await api('/api/templates')).json.items) await api(`/api/templates/${t.id}`, { method: 'DELETE' });
  assert.equal((await api('/api/templates')).json.items.length, 0);
  assert.equal((await generateDraft(row.id, { intent: 'ACCEPT' })).templateId, null);
});
