const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'test-secret';

const time = require('../src/core/time');
const { checkAvailability, findAvailableSlots } = require('../src/core/scheduler');
const { parseJsonFromLlm, extractDraftMessage } = require('../src/core/analysis/parse');
const { validateAnalysis, parseAiDate, AnalysisValidationError } = require('../src/core/analysis/validate');
const { htmlToText, formatThreadForAi, parseAddress, stripQuotedText } = require('../src/utils/emailText');
const { encryptSecret, decryptSecret } = require('../src/utils/encryption');
const { CATEGORY_CODES, getCategoryPolicy, effectiveCategory } = require('../src/core/categories');
const { buildAnalysisPrompt, buildDraftPrompt } = require('../src/core/analysis/prompts');
const { buildReplyProfile } = require('../src/core/profile');
const { eventIdFromKey } = require('../src/connectors/calendar/google');

const TZ = 'Asia/Bangkok';
const settings = { startTime: '09:00', endTime: '17:00', workDays: ['mon', 'tue', 'wed', 'thu', 'fri'], timezone: TZ };
const NOW = new Date('2026-08-20T03:00:00Z'); // พฤหัสบดี 10:00 น. เวลาไทย

// ───── time ─────
test('time: zoned parts and conversion do not depend on the server timezone', () => {
  const d = new Date('2026-08-23T18:30:00Z'); // จันทร์ 01:30 เวลาไทย
  const p = time.zonedParts(d, TZ);
  assert.deepEqual([p.year, p.month, p.day, p.hour, p.minute, p.weekday], [2026, 8, 24, 1, 30, 1]);
  assert.equal(time.zonedToUtc({ year: 2026, month: 8, day: 24, hour: 10 }, TZ).toISOString(), '2026-08-24T03:00:00.000Z');
  assert.equal(time.offsetString(TZ), '+07:00');
  assert.equal(time.startOfZonedDay(d, TZ).toISOString(), '2026-08-23T17:00:00.000Z');
});

test('time: handles daylight saving zones and legacy setting values', () => {
  assert.equal(time.zonedToUtc({ year: 2026, month: 7, day: 1, hour: 9 }, 'Europe/London').toISOString(), '2026-07-01T08:00:00.000Z');
  assert.equal(time.zonedToUtc({ year: 2026, month: 1, day: 1, hour: 9 }, 'Europe/London').toISOString(), '2026-01-01T09:00:00.000Z');
  assert.equal(time.normalizeTimeZone('asia-bangkok'), 'Asia/Bangkok');
  assert.equal(time.normalizeTimeZone('not-a-zone'), 'Asia/Bangkok');
  assert.equal(
    time.formatThaiRange(new Date('2026-08-24T03:00:00Z'), new Date('2026-08-24T04:00:00Z'), TZ),
    'วันจันทร์ที่ 24 สิงหาคม 2569 เวลา 10:00 - 11:00 น.'
  );
});

// ───── scheduler ─────
const slot = (startIso, minutes = 60) => {
  const start = new Date(startIso);
  return { start, end: new Date(start.getTime() + minutes * 60000) };
};

test('scheduler: accepts a free slot inside working hours', () => {
  const r = checkAvailability({ ...slot('2026-08-24T10:00:00+07:00'), events: [], settings });
  assert.equal(r.availability, 'AVAILABLE');
});

test('scheduler: reports the conflicting event', () => {
  const events = [{ id: 'ev1', title: 'ประชุมทีม', start: '2026-08-24T10:30:00+07:00', end: '2026-08-24T11:30:00+07:00' }];
  const r = checkAvailability({ ...slot('2026-08-24T10:00:00+07:00'), events, settings });
  assert.equal(r.availability, 'CONFLICT');
  assert.equal(r.conflict.id, 'ev1');
});

test('scheduler: back-to-back events and all-day events are not conflicts', () => {
  const events = [
    { id: 'a', title: 'ก่อนหน้า', start: '2026-08-24T09:00:00+07:00', end: '2026-08-24T10:00:00+07:00' },
    { id: 'b', title: 'วันหยุด', start: '2026-08-24', end: '2026-08-25', isAllDay: true },
  ];
  assert.equal(checkAvailability({ ...slot('2026-08-24T10:00:00+07:00'), events, settings }).availability, 'AVAILABLE');
});

test('scheduler: work days and working hours use the user timezone', () => {
  assert.equal(checkAvailability({ ...slot('2026-08-22T10:00:00+07:00'), events: [], settings }).availability, 'OUT_OF_WORK_DAYS');
  // จันทร์ 06:00 เวลาไทย = อาทิตย์ 23:00 UTC — ต้องถูกตัดสินว่านอกเวลางาน ไม่ใช่วันหยุด
  assert.equal(checkAvailability({ ...slot('2026-08-24T06:00:00+07:00'), events: [], settings }).availability, 'OUT_OF_WORKING_HOURS');
  assert.equal(checkAvailability({ ...slot('2026-08-24T16:30:00+07:00'), events: [], settings }).availability, 'OUT_OF_WORKING_HOURS');
});

test('scheduler: WARN mode only checks conflicts', () => {
  const r = checkAvailability({ ...slot('2026-08-22T20:00:00+07:00'), events: [], settings, mode: 'WARN' });
  assert.equal(r.availability, 'AVAILABLE');
});

test('scheduler: suggested slots are free, in working hours, and in the future', () => {
  const events = [{ id: 'x', title: 'busy', start: '2026-08-21T09:00:00+07:00', end: '2026-08-21T12:00:00+07:00' }];
  const slots = findAvailableSlots({ from: new Date('2026-08-21T09:00:00+07:00'), durationMinutes: 60, events, settings, now: NOW });
  assert.equal(slots.length, 3);
  assert.equal(slots[0].start.toISOString(), '2026-08-21T05:00:00.000Z'); // ศุกร์ 12:00 เวลาไทย
  for (const s of slots) {
    assert.equal(checkAvailability({ start: s.start, end: s.end, events, settings }).availability, 'AVAILABLE');
    assert.ok(s.start > NOW);
  }
});

test('scheduler: skips weekends when suggesting', () => {
  const slots = findAvailableSlots({ from: new Date('2026-08-22T09:00:00+07:00'), events: [], settings, now: NOW, maxSlots: 1 });
  assert.equal(time.zonedParts(slots[0].start, TZ).weekday, 1);
});

// ───── parse ─────
test('parse: reads plain, fenced, and reasoning-wrapped JSON', () => {
  assert.deepEqual(parseJsonFromLlm('{"a":1}'), { value: { a: 1 }, strategy: 'direct' });
  assert.equal(parseJsonFromLlm('```json\n{"a":1}\n```').value.a, 1);
  assert.equal(parseJsonFromLlm('<think>hmm {x}</think>\nHere: {"a":2} done').value.a, 2);
  assert.equal(parseJsonFromLlm('{"a":"line1\nline2"}').strategy, 'repaired');
  assert.deepEqual(parseJsonFromLlm('no json here'), { value: null, strategy: 'failed' });
  assert.deepEqual(parseJsonFromLlm(''), { value: null, strategy: 'failed' });
});

test('parse: extracts the draft message even from broken output', () => {
  assert.equal(extractDraftMessage('{"draftMessage":"เรียนคุณ ก\\nขอบคุณครับ"}').draft, 'เรียนคุณ ก\nขอบคุณครับ');
  assert.equal(
    extractDraftMessage('{"draftMessage": {"body":"สวัสดี","signature":"ขอแสดงความนับถือ"}}').draft,
    'สวัสดี\n\nขอแสดงความนับถือ'
  );
  assert.equal(extractDraftMessage('{"actionType":"X", "draftMessage": "ข้อความ "ที่" พัง').draft.startsWith('ข้อความ'), true);
  assert.equal(extractDraftMessage('nothing').draft, '');
});

// ───── validate ─────
const ctx = { timezone: TZ, now: NOW, plainText: 'ขอเชิญประชุมวันจันทร์ที่ 24 สิงหาคม 2569 เวลา 10:00 - 11:00 น. ห้อง 301' };
const baseItem = {
  kind: 'EVENT',
  title: 'ประชุม',
  start: '2026-08-24T10:00:00+07:00',
  end: '2026-08-24T11:00:00+07:00',
  isTimeSpecified: true,
  evidence: 'วันจันทร์ที่ 24 สิงหาคม 2569 เวลา 10:00 - 11:00 น.',
};

test('validate: accepts a well-formed result', () => {
  const r = validateAnalysis(
    { category: 'appointment', priority: 'HIGH', summary: 'นัดประชุม', needsReply: 'true', actionItems: [baseItem] },
    ctx
  );
  assert.equal(r.category, 'APPOINTMENT');
  assert.equal(r.needsReply, true);
  assert.equal(r.actionItems[0].startAt.toISOString(), '2026-08-24T03:00:00.000Z');
  assert.deepEqual(r.actionItems[0].missingFields, []);
});

test('validate: rejects unknown category and non-object input', () => {
  assert.throws(() => validateAnalysis({ category: 'MEETING' }, ctx), AnalysisValidationError);
  assert.throws(() => validateAnalysis(null, ctx), AnalysisValidationError);
  assert.throws(() => validateAnalysis({}, ctx), AnalysisValidationError);
});

test('validate: secondary fields fall back to defaults; malformed items are dropped', () => {
  const r = validateAnalysis(
    { category: 'FYI', priority: 'URGENT', actionItems: [{ kind: 'PARTY', title: 'x' }, { title: 'no kind' }, baseItem] },
    ctx
  );
  assert.equal(r.priority, 'NORMAL');
  assert.equal(r.summary, '');
  assert.equal(r.actionItems.length, 1);
  assert.equal(validateAnalysis({ category: 'OTHER', actionItems: 'none' }, ctx).actionItems.length, 0);
});

test('validate: converts Buddhist-era years and interprets missing offsets in the user timezone', () => {
  assert.equal(parseAiDate('2569-08-24T10:00:00+07:00', ctx).toISOString(), '2026-08-24T03:00:00.000Z');
  assert.equal(parseAiDate('2026-08-24T10:00:00', ctx).toISOString(), '2026-08-24T03:00:00.000Z');
  assert.equal(parseAiDate('2026-08-24', ctx).toISOString(), '2026-08-23T17:00:00.000Z');
  assert.equal(parseAiDate('2026-08-24T03:00:00Z', ctx).toISOString(), '2026-08-24T03:00:00.000Z');
  assert.equal(parseAiDate('1999-01-01T10:00:00+07:00', ctx), null);
  assert.equal(parseAiDate('next monday', ctx), null);
});

test('validate: flags what the user must fill in instead of guessing', () => {
  const r = validateAnalysis(
    {
      category: 'APPOINTMENT',
      actionItems: [
        { ...baseItem, title: 'ไม่มีเวลา', start: '2026-08-25T00:00:00+07:00', end: null, isTimeSpecified: false },
        { ...baseItem, title: 'ไม่มีวัน', start: null },
        { ...baseItem, title: 'ไม่มีเวลาจบ', start: '2026-08-26T13:00:00+07:00', end: null },
        { ...baseItem, title: 'จบก่อนเริ่ม', start: '2026-08-27T13:00:00+07:00', end: '2026-08-27T12:00:00+07:00' },
      ],
    },
    ctx
  );
  const [noTime, noDate, noEnd, badEnd] = r.actionItems;
  assert.deepEqual([noTime.missingFields, noTime.endAt], [['time'], null]);
  assert.deepEqual([noDate.missingFields, noDate.startAt], [['start'], null]);
  assert.deepEqual(noEnd.missingFields, ['end']);
  assert.equal(noEnd.endAt - noEnd.startAt, 60 * 60000);
  assert.deepEqual(badEnd.missingFields, ['end']);
});

test('validate: evidence that is not in the email is removed and flagged', () => {
  const r = validateAnalysis(
    {
      category: 'APPOINTMENT',
      actionItems: [
        { ...baseItem, evidence: 'วันจันทร์ที่ 24  สิงหาคม 2569, เวลา 10:00-11:00 น.' }, // ต่างแค่ช่องว่างและวรรคตอน
        {
          ...baseItem,
          title: 'อีกงาน',
          start: '2026-08-28T10:00:00+07:00',
          end: '2026-08-28T11:00:00+07:00',
          evidence: 'พบกันวันศุกร์หน้าตอนสิบโมง',
        },
      ],
    },
    ctx
  );
  assert.ok(r.actionItems[0].evidence);
  assert.deepEqual(r.actionItems[0].missingFields, []);
  assert.equal(r.actionItems[1].evidence, null);
  assert.deepEqual(r.actionItems[1].missingFields, ['evidence']);
});

test('validate: deadlines have no end; date-only deadlines are all-day; duplicates are removed', () => {
  const deadline = {
    kind: 'DEADLINE',
    title: 'ส่งรายงาน',
    start: '2026-08-31T00:00:00+07:00',
    end: '2026-08-31T17:00:00+07:00',
    isTimeSpecified: false,
    evidence: null,
  };
  const r = validateAnalysis({ category: 'TASK_DEADLINE', actionItems: [deadline, deadline, baseItem, baseItem] }, ctx);
  assert.equal(r.actionItems.length, 2);
  assert.equal(r.actionItems[0].endAt, null);
  assert.equal(r.actionItems[0].isAllDay, true);
});

// ───── email text ─────
test('emailText: converts HTML-only emails to readable text', () => {
  const html =
    '<html><head><style>p{color:red}</style></head><body><p>ยืนยันการจอง&nbsp;เที่ยวบิน TG102</p>' +
    '<table><tr><td>ออกเดินทาง</td><td>20 ต.ค. 2569 08:30</td></tr></table><ul><li>ที่นั่ง 12A</li></ul>' +
    '<script>x()</script>&amp; &#3586;</body></html>';
  const text = htmlToText(html);
  assert.match(text, /ยืนยันการจอง เที่ยวบิน TG102/);
  assert.match(text, /ออกเดินทาง 20 ต\.ค\. 2569 08:30/);
  assert.match(text, /- ที่นั่ง 12A/);
  assert.doesNotMatch(text, /color:red|x\(\)|<|&amp;/);
  assert.match(text, /& ข/);
});

test('emailText: thread formatting marks the latest message and falls back to HTML', () => {
  const { formattedThread, plainText } = formatThreadForAi([
    { from: 'a@x.com', subject: 'นัด', date: 'd1', text: 'ขอนัดวันที่ 17' },
    { from: 'b@x.com', subject: 'Re: นัด', date: 'd2', text: '', html: '<p>ขอเลื่อนเป็นวันที่ 24</p>' },
  ]);
  assert.match(formattedThread, /MESSAGE 2 of 2 - LATEST MESSAGE/);
  assert.match(formattedThread, /ขอเลื่อนเป็นวันที่ 24/);
  assert.match(plainText, /ขอนัดวันที่ 17/);
  assert.deepEqual(formatThreadForAi([]), { formattedThread: '', plainText: '' });
});

test('emailText: strips quoted replies but keeps divider lines in the body', () => {
  assert.equal(stripQuotedText('ตกลงครับ\n\nOn Mon, Aug 17 someone wrote:\n> เดิม'), 'ตกลงครับ');
  assert.match(stripQuotedText('รายละเอียด\n--------------------\nเที่ยวบิน TG102'), /TG102/);
  assert.deepEqual(parseAddress('"สมชาย ใจดี" <somchai@example.com>'), { name: 'สมชาย ใจดี', address: 'somchai@example.com' });
  assert.deepEqual(parseAddress('plain@example.com'), { name: null, address: 'plain@example.com' });
});

// ───── อื่น ๆ ─────
test('encryption: round-trips, never returns plaintext, fails closed', () => {
  const stored = encryptSecret('refresh-token-value');
  assert.match(stored, /^enc:v1:/);
  assert.doesNotMatch(stored, /refresh-token-value/);
  assert.equal(decryptSecret(stored), 'refresh-token-value');
  assert.equal(decryptSecret('plaintext-token'), null);
  assert.equal(decryptSecret(`${stored.slice(0, -4)}ffff`), null);
  assert.equal(encryptSecret(''), null);
});

test('categories: every category has a complete policy', () => {
  assert.equal(CATEGORY_CODES.length, 7);
  for (const code of CATEGORY_CODES) {
    const p = getCategoryPolicy(code);
    assert.ok(p.label && p.description && p.defaultIntent);
    assert.ok(['SUGGEST', 'WARN', 'NONE'].includes(p.calendarMode));
  }
  assert.equal(effectiveCategory({ category: 'FYI', userCategory: 'APPOINTMENT' }), 'APPOINTMENT');
  assert.equal(effectiveCategory({ category: 'FYI', userCategory: null }), 'FYI');
});

test('prompts: include date context, all categories, and the user profile', () => {
  const p = buildAnalysisPrompt({ formattedThread: 'BODY', now: NOW, timezone: TZ });
  for (const code of CATEGORY_CODES) assert.match(p, new RegExp(code));
  assert.match(p, /2026-08-20/);
  assert.match(p, /\+07:00/);
  const profile = buildReplyProfile({ gender: 'FEMALE', firstName: 'สมหญิง', lastName: 'ใจดี', position: 'เจ้าหน้าที่ธุรการ', tone: 'formal' });
  assert.equal(profile.pronoun, 'ดิฉัน');
  const d = buildDraftPrompt({
    intent: 'PROPOSE_TIME',
    profile,
    formattedThread: 'BODY',
    context: { reason: 'ชนกับประชุม', slotTexts: ['วันอังคาร 10:00'] },
  });
  assert.match(d, /วันอังคาร 10:00/);
  assert.match(d, /สมหญิง ใจดี\nเจ้าหน้าที่ธุรการ/);
});

test('calendar: event ids are stable per key and use allowed characters', () => {
  assert.equal(eventIdFromKey('abc'), eventIdFromKey('abc'));
  assert.notEqual(eventIdFromKey('abc'), eventIdFromKey('abd'));
  assert.match(eventIdFromKey('cmXYZ123'), /^[a-v0-9]{5,1024}$/);
});
