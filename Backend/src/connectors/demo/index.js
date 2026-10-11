// ตัวเชื่อมจำลองสำหรับโหมดสาธิต (DEMO_MODE=true)
// ใช้อีเมลตัวอย่างจาก scripts/samples/emails.json แทน Gmail และเก็บปฏิทินในหน่วยความจำ
// ไม่มีการเรียก Google และไม่มีอีเมลถูกส่งออกจริง — ส่วน AI ยังเป็นของจริงตามที่ตั้งค่า
const fs = require('fs');
const path = require('path');
const { parseAddress } = require('../../utils/emailText');
const { eventIdFromKey } = require('../calendar/google');

const DEMO_ACCOUNT_PREFIX = 'demo:';
const isDemoAccount = (account) => String(account?.providerAccountId || '').startsWith(DEMO_ACCOUNT_PREFIX);

const samples = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../scripts/samples/emails.json'), 'utf8'));
const startedAt = Date.now();
const receivedAt = (index) => new Date(startedAt - (index + 1) * 37 * 60 * 1000);

const state = { sent: [], events: new Map() };

const demoMail = {
  provider: 'GOOGLE',
  async listMessageIdsSince() {
    return { ids: samples.map((s) => s.id), truncated: false };
  },
  async getMessageMeta(id) {
    const index = samples.findIndex((s) => s.id === id);
    const sample = samples[index];
    const from = parseAddress(sample.from);
    return {
      providerMessageId: sample.id,
      providerThreadId: `thread-${sample.id}`,
      fromName: from.name,
      fromAddress: from.address,
      subject: sample.subject,
      snippet: (sample.text || sample.subject).slice(0, 120),
      receivedAt: receivedAt(index),
      isRead: false,
      labels: ['INBOX', 'UNREAD'],
    };
  },
  async getThread(threadId) {
    const index = samples.findIndex((s) => `thread-${s.id}` === threadId);
    if (index === -1) return [];
    const sample = samples[index];
    const sentReplies = state.sent.filter((s) => s.threadId === threadId);
    return [
      {
        id: sample.id,
        from: sample.from,
        subject: sample.subject,
        date: receivedAt(index).toISOString(),
        receivedAt: receivedAt(index).toISOString(),
        text: sample.text || '',
        html: sample.html || '',
        isRead: true,
      },
      ...sentReplies.map((s) => ({
        id: s.id,
        from: 'ฉัน (โหมดสาธิต)',
        subject: `Re: ${sample.subject}`,
        date: s.at,
        receivedAt: s.at,
        text: s.body,
        html: '',
        isRead: true,
      })),
    ];
  },
  async sendReply({ threadId, body }) {
    const id = `demo-sent-${state.sent.length + 1}`;
    state.sent.push({ id, threadId, body, at: new Date().toISOString() });
    return { id };
  },
  async markRead() {},
};

const demoCalendar = {
  provider: 'GOOGLE',
  async listEvents({ timeMin, timeMax }) {
    const min = new Date(timeMin);
    const max = new Date(timeMax);
    return [...state.events.values()].filter((e) => new Date(e.end) > min && new Date(e.start) < max);
  },
  async createEvent({ idempotencyKey, title, start, end, isAllDay, location }) {
    const id = eventIdFromKey(idempotencyKey);
    const alreadyExisted = state.events.has(id);
    if (!alreadyExisted) {
      state.events.set(id, {
        id,
        title,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        isAllDay: Boolean(isAllDay),
        location: location || '',
        htmlLink: '',
      });
    }
    return { id, htmlLink: '', alreadyExisted };
  },
};

module.exports = { DEMO_ACCOUNT_PREFIX, isDemoAccount, demoMail, demoCalendar };
