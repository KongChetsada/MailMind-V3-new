// ตัวเชื่อมจำลองสำหรับโหมดสาธิต (DEMO_MODE=true)
// ใช้อีเมลตัวอย่างจาก scripts/samples/emails.json แทน Gmail และเก็บปฏิทินในหน่วยความจำ
// ไม่มีการเรียก Google และไม่มีอีเมลถูกส่งออกจริง — ส่วน AI ยังเป็นของจริงตามที่ตั้งค่า
const fs = require('fs');
const path = require('path');
const { parseAddress } = require('../../utils/emailText');
const { eventIdFromKey, toEventTimes } = require('../calendar/google');

const DEMO_ACCOUNT_PREFIX = 'demo:';
const isDemoAccount = (account) => String(account?.providerAccountId || '').startsWith(DEMO_ACCOUNT_PREFIX);

const samples = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../scripts/samples/emails.json'), 'utf8'));
const startedAt = Date.now();
const receivedAt = (index) => new Date(startedAt - (index + 1) * 37 * 60 * 1000);
// ตัวอย่างที่มี threadId เดียวกันอยู่ในเธรดเดียวกัน (ฉบับที่อยู่ก่อนในไฟล์คือฉบับที่ใหม่กว่า)
const threadIdOf = (sample) => `thread-${sample.threadId || sample.id}`;

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
      providerThreadId: threadIdOf(sample),
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
    const received = samples
      .map((sample, index) => ({ sample, at: receivedAt(index).toISOString() }))
      .filter(({ sample }) => threadIdOf(sample) === threadId)
      .map(({ sample, at }) => ({
        id: sample.id,
        from: sample.from,
        subject: sample.subject,
        date: at,
        receivedAt: at,
        text: sample.text || '',
        html: sample.html || '',
        isRead: true,
      }));
    if (received.length === 0) return [];
    const sent = state.sent
      .filter((x) => x.threadId === threadId)
      .map((x) => ({ id: x.id, from: 'ฉัน (โหมดสาธิต)', subject: `Re: ${received[0].subject}`, date: x.at, receivedAt: x.at, text: x.body, html: '', isRead: true }));
    return [...received, ...sent].sort((m1, m2) => m1.receivedAt.localeCompare(m2.receivedAt));
  },
  async sendReply({ threadId, body }) {
    const id = `demo-sent-${state.sent.length + 1}`;
    state.sent.push({ id, threadId, body, at: new Date().toISOString() });
    return { id };
  },
  async markRead() {},
};

// เก็บเวลาในรูปแบบเดียวกับที่ Google Calendar ส่งกลับ: กิจกรรมทั้งวันเป็นวันที่ล้วนและวันสิ้นสุดแบบไม่รวม
const storedTimes = ({ start, end, isAllDay, timezone }) => {
  const t = toEventTimes({ start, end, isAllDay, timezone: timezone || 'Asia/Bangkok' });
  return isAllDay ? { start: t.start.date, end: t.end.date } : { start: t.start.dateTime, end: t.end.dateTime };
};
const asDate = (value) => new Date(String(value).length === 10 ? `${value}T00:00:00+07:00` : value);

const demoCalendar = {
  provider: 'GOOGLE',
  async listEvents({ timeMin, timeMax }) {
    const min = new Date(timeMin);
    const max = new Date(timeMax);
    return [...state.events.values()]
      .flatMap((e) =>
        Array.from({ length: e.isAllDay ? 1 : e.repeatDays || 1 }, (_unused, i) =>
          i === 0 && !(e.repeatDays > 1)
            ? e
            : {
                ...e,
                id: `${e.id}_${i}`,
                recurringEventId: e.id,
                start: new Date(new Date(e.start).getTime() + i * 86400000).toISOString(),
                end: new Date(new Date(e.end).getTime() + i * 86400000).toISOString(),
              }
        )
      )
      .filter((e) => asDate(e.end) > min && asDate(e.start) < max);
  },
  async updateEvent({ eventId, start, end, isAllDay, location, timezone, repeatDays = 1 }) {
    const event = state.events.get(eventId);
    if (!event) throw new Error('ไม่พบกิจกรรมในปฏิทินสาธิต (ปฏิทินสาธิตถูกล้างเมื่อเริ่มเซิร์ฟเวอร์ใหม่)');
    Object.assign(event, {
      ...storedTimes({ start, end, isAllDay, timezone }),
      isAllDay: Boolean(isAllDay),
      repeatDays,
      ...(location ? { location } : {}),
    });
    return { id: eventId, htmlLink: '' };
  },
  async createEvent({ idempotencyKey, title, start, end, isAllDay, location, timezone, repeatDays = 1 }) {
    const id = eventIdFromKey(idempotencyKey);
    const alreadyExisted = state.events.has(id);
    if (!alreadyExisted) {
      state.events.set(id, {
        id,
        title,
        ...storedTimes({ start, end, isAllDay, timezone }),
        isAllDay: Boolean(isAllDay),
        repeatDays,
        location: location || '',
        htmlLink: '',
      });
    }
    return { id, htmlLink: '', alreadyExisted };
  },
};

module.exports = { DEMO_ACCOUNT_PREFIX, isDemoAccount, demoMail, demoCalendar };
