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

// ───── เธรด ─────
const { linkToExisting } = require('../src/core/threadLinking');
const { evaluateAvailability } = require('../src/workflows/availability');

const at = (isoText) => new Date(isoText);
const tripDay = { id: 'old-trip', kind: 'EVENT', title: 'ไปเที่ยว', startAt: at('2026-10-14T17:00:00Z'), endAt: null, isAllDay: true };
const meeting = { id: 'old-meet', kind: 'EVENT', title: 'ประชุม', startAt: at('2026-10-20T07:00:00Z'), endAt: at('2026-10-20T08:00:00Z'), isAllDay: false };
const newItem = (fields) => ({ kind: 'EVENT', title: 'ใหม่', endAt: null, isAllDay: false, relatesTo: null, relation: null, ...fields });
const link = (items, existing = [tripDay, meeting]) => linkToExisting({ items, existing, timezone: TZ });

test('thread linking: same-day items are linked by rule even when the model says nothing', () => {
  const [r] = link([newItem({ startAt: at('2026-10-14T19:00:00Z') })]); // 02:00 วันที่ 15 เวลาไทย
  assert.deepEqual([r.relatedActionId, r.relation], ['old-trip', 'DETAIL']);
});

test('thread linking: a reschedule is recognised from the model or from wording in the latest message', () => {
  const moved = newItem({ startAt: at('2026-10-21T08:00:00Z'), endAt: at('2026-10-21T09:00:00Z') });
  const rel = (items, existing, latestText) => linkToExisting({ items, existing, timezone: TZ, latestText }).map((r) => [r.relatedActionId, r.relation]);

  // โมเดลชี้เป้าและบอกว่าเลื่อน
  assert.deepEqual(rel([{ ...moved, relatesTo: 2, relation: 'RESCHEDULE' }], [tripDay, meeting]), [['old-meet', 'RESCHEDULE']]);
  // โมเดลไม่บอกอะไร แต่ข้อความมีคำว่าเลื่อน และมีรายการเดิมรายการเดียว
  assert.deepEqual(rel([moved], [meeting], 'ขอเลื่อนเป็นวันพุธแทนครับ'), [['old-meet', 'RESCHEDULE']]);
  assert.deepEqual(rel([moved], [meeting], 'Could we reschedule to Wednesday?'), [['old-meet', 'RESCHEDULE']]);
  // เปลี่ยนเวลาในวันเดียวกัน = เลื่อน ไม่ใช่รายละเอียดเพิ่ม
  const laterSameDay = newItem({ startAt: at('2026-10-20T09:00:00Z'), endAt: at('2026-10-20T10:00:00Z') });
  assert.deepEqual(rel([laterSameDay], [meeting], 'ขอเปลี่ยนเป็นบ่ายสี่โมงครับ'), [['old-meet', 'RESCHEDULE']]);
  assert.deepEqual(rel([laterSameDay], [meeting], 'เจอกันที่ห้อง 2 นะครับ'), [['old-meet', 'DETAIL']]);

  // มีรายการเดิมหลายรายการและไม่รู้ว่าเลื่อนตัวไหน → ไม่เดา
  assert.deepEqual(rel([moved], [tripDay, meeting], 'ขอเลื่อนเป็นวันพุธแทนครับ'), [[null, null]]);
  // ไม่มีคำว่าเลื่อน และคนละวัน → เป็นนัดใหม่
  assert.deepEqual(rel([moved], [meeting], 'แล้วเจอกันอีกรอบวันพุธนะครับ'), [[null, null]]);
  // โมเดลอ้างลำดับที่ไม่มีอยู่ หรือชี้ข้ามชนิด → ไม่เชื่อ
  assert.deepEqual(rel([{ ...moved, relatesTo: 9, relation: 'RESCHEDULE' }], [tripDay, meeting]), [[null, null]]);
  assert.deepEqual(rel([{ ...moved, kind: 'DEADLINE', relatesTo: 2, relation: 'RESCHEDULE' }], [tripDay, meeting]), [[null, null]]);
  // โมเดลบอกว่าเป็นรายละเอียดของรายการคนละวัน → ไม่เชื่อ
  assert.deepEqual(rel([{ ...moved, relatesTo: 1, relation: 'DETAIL' }], [tripDay, meeting]), [[null, null]]);
  // รายการทั้งวัน (ทริป) + เวลานัดพบในวันเดียวกัน ยังเป็นรายละเอียดเพิ่ม แม้ข้อความมีคำว่าเลื่อน
  const meetPoint = newItem({ startAt: at('2026-10-14T19:00:00Z') });
  assert.deepEqual(rel([meetPoint], [tripDay, meeting], 'เลื่อนเวลาออกเดินทางเป็นตีสองนะ'), [['old-trip', 'DETAIL']]);
});

test('thread linking: an item that repeats an existing one exactly is dropped', () => {
  const repeat = newItem({ startAt: meeting.startAt, endAt: meeting.endAt });
  assert.equal(link([repeat]).length, 0);
  assert.equal(link([{ ...repeat, relatesTo: 2, relation: 'RESCHEDULE' }]).length, 0);
  assert.equal(link([repeat], []).length, 1); // ไม่มีรายการเดิม = ไม่มีอะไรให้ซ้ำ
});

test('availability: linked items skip working-hours rules and ignore their own original event', async () => {
  const calendar = { listEvents: async () => [{ id: 'ev-original', title: 'ประชุม', start: '2026-08-24T10:00:00+07:00', end: '2026-08-24T11:00:00+07:00' }] };
  const base = { kind: 'EVENT', isAllDay: false, isTimeSpecified: true };
  const night = { ...base, startAt: at('2026-08-23T19:00:00Z'), endAt: at('2026-08-23T20:00:00Z') }; // 02:00 เวลาไทย
  const overlap = { ...base, startAt: at('2026-08-24T03:30:00Z'), endAt: at('2026-08-24T04:30:00Z') };
  const run = (items) => evaluateAvailability({ items, mode: 'SUGGEST', calendar, settings, now: NOW });

  const [unlinked, linked] = await run([night, { ...night, relatedActionId: 'x' }]);
  assert.equal(unlinked.availability, 'OUT_OF_WORKING_HOURS');
  assert.ok(unlinked.suggestedSlots.length > 0);
  assert.deepEqual([linked.availability, linked.suggestedSlots], ['AVAILABLE', null]);

  const [clash, self] = await run([{ ...overlap, relatedActionId: 'x' }, { ...overlap, relatedActionId: 'x', ignoreEventId: 'ev-original' }]);
  assert.deepEqual([clash.availability, clash.suggestedSlots], ['CONFLICT', null]);
  assert.equal(self.availability, 'AVAILABLE');
});

test('validate: an item the model left untitled takes the email subject instead of being dropped', () => {
  const untitled = { ...baseItem, title: '' };
  const r = validateAnalysis({ category: 'APPOINTMENT', actionItems: [untitled, { ...baseItem, title: null, start: '2026-08-25T10:00:00+07:00', end: '2026-08-25T11:00:00+07:00' }] }, { ...ctx, fallbackTitle: 'Re: RE: นัดประชุมทีม' });
  assert.deepEqual(r.actionItems.map((i) => i.title), ['นัดประชุมทีม', 'นัดประชุมทีม']);
  assert.equal(validateAnalysis({ category: 'APPOINTMENT', actionItems: [untitled] }, ctx).actionItems[0].title, 'รายการจากอีเมล');
});

test('validate: a stated clock time wins over an "all day" flag', () => {
  const r = validateAnalysis(
    {
      category: 'APPOINTMENT',
      actionItems: [
        { ...baseItem, title: 'ตีสอง', start: '2026-08-24T02:00:00+07:00', end: null, isAllDay: true, isTimeSpecified: true },
        { ...baseItem, title: 'ทั้งวันจริง', start: '2026-08-25T00:00:00+07:00', end: null, isAllDay: true, isTimeSpecified: false },
      ],
    },
    ctx
  );
  assert.deepEqual([r.actionItems[0].isAllDay, r.actionItems[0].isTimeSpecified, r.actionItems[0].missingFields], [false, true, ['end']]);
  assert.deepEqual([r.actionItems[1].isAllDay, r.actionItems[1].isTimeSpecified], [true, false]);
});

// ───── หลายวัน และข้อความที่บอกแค่เวลา ─────
const { findDateRange } = require('../src/core/analysis/dateRange');
const { hasDateCue } = require('../src/core/threadLinking');

test('date range: finds multi-day ranges in Thai and English wording', () => {
  const opt = { timezone: TZ, referenceYear: 2026 };
  const days = (text) => {
    const r = findDateRange(text, opt);
    return r && [r.start.toISOString(), r.end.toISOString()];
  };
  const oct15to17 = ['2026-10-14T17:00:00.000Z', '2026-10-16T17:00:00.000Z'];
  assert.deepEqual(days('วันที่ 15/10/2569 - 17/10/2569 ไปเที่ยวภูกระดึงกันไหม'), oct15to17);
  assert.deepEqual(days('15-17 ตุลาคม 2569'), oct15to17);
  assert.deepEqual(days('15 ต.ค. ถึง 17 ต.ค. 69'), oct15to17);
  assert.deepEqual(days('15-17 Oct 2026'), oct15to17);
  assert.deepEqual(days('15-17 ตุลาคม'), oct15to17); // ไม่ระบุปี = ปีอ้างอิง
  assert.deepEqual(days('30/12 - 2/1/2570'), ['2026-12-29T17:00:00.000Z', '2027-01-01T17:00:00.000Z']); // ข้ามปี
  for (const text of ['15/10/2569', 'เวลา 10:00 - 11:00 น.', 'ห้อง 3-4', '17/10/2569 - 15/10/2569', '99/99/2569 - 1/1/2570']) {
    assert.equal(days(text), null, text);
  }
});

test('validate: a date range becomes one all-day multi-day item; midnight is not a real time', () => {
  const text = 'วันที่ 15/10/2569 - 17/10/2569 ไปเที่ยวภูกระดึงกันไหม';
  const opts = { plainText: text, timezone: TZ, now: at('2026-10-13T10:00:00Z') };
  const one = (item) => validateAnalysis({ category: 'APPOINTMENT', actionItems: [item] }, opts).actionItems[0];
  const first = { kind: 'EVENT', title: 'ไปเที่ยว', start: '2026-10-15T00:00:00+07:00', end: null, evidence: text };

  // สิ่งที่โมเดลจริงตอบ: วันแรก 00:00 และติดธงว่าระบุเวลา
  const fixed = one({ ...first, isAllDay: false, isTimeSpecified: true });
  assert.deepEqual(
    [fixed.isAllDay, fixed.isTimeSpecified, fixed.startAt.toISOString(), fixed.endAt.toISOString(), fixed.missingFields],
    [true, false, '2026-10-14T17:00:00.000Z', '2026-10-16T17:00:00.000Z', []]
  );
  // โมเดลให้วันสิ้นสุดมาเอง
  const given = one({ ...first, end: '2026-10-17T00:00:00+07:00', isAllDay: false, isTimeSpecified: false, evidence: null });
  assert.deepEqual([given.isAllDay, given.endAt.toISOString()], [true, '2026-10-16T17:00:00.000Z']);
  // วันเดียวไม่มีเวลา: ไม่กลายเป็น 00:00-01:00 แต่ให้ผู้ใช้เติมเวลา
  const single = validateAnalysis(
    { category: 'APPOINTMENT', actionItems: [{ ...first, isAllDay: false, isTimeSpecified: true, evidence: null }] },
    { ...opts, plainText: 'วันที่ 15/10/2569 ไปเที่ยวภูกระดึงกันไหม' }
  ).actionItems[0];
  assert.deepEqual([single.isAllDay, single.isTimeSpecified, single.endAt, single.missingFields], [false, false, null, ['time', 'evidence']]);
  // มีเวลาจริง: ไม่ถูกแปลงเป็นทั้งวัน แม้ข้อความมีช่วงวันที่
  const timed = one({ ...first, start: '2026-10-15T09:00:00+07:00', end: '2026-10-15T16:00:00+07:00', isAllDay: false, isTimeSpecified: true });
  assert.deepEqual([timed.isAllDay, timed.isTimeSpecified], [false, true]);
});

test('thread linking: a time-only reply moves to the first day of the existing event', () => {
  const trip3 = { id: 'trip3', kind: 'EVENT', title: 'ภูกระดึง', startAt: at('2026-10-14T17:00:00Z'), endAt: at('2026-10-16T17:00:00Z'), isAllDay: true };
  const received = at('2026-10-13T14:05:00Z'); // 13 ต.ค. 21:05 เวลาไทย
  const fiveToday = newItem({ startAt: at('2026-10-12T22:00:00Z'), endAt: at('2026-10-12T23:00:00Z'), isTimeSpecified: true, missingFields: ['end'] }); // 13 ต.ค. 05:00
  const run = (items, existing, latestText) => linkToExisting({ items, existing, timezone: TZ, latestText, referenceDate: received });

  const [moved] = run([fiveToday], [trip3], 'นัดรวมตัว 05.00 ที่หน้ามหาลัยขอนแก่น นะ เตรียมของมาให้พร้อม');
  assert.deepEqual(
    [moved.startAt.toISOString(), moved.endAt.toISOString(), moved.relatedActionId, moved.relation, moved.missingFields],
    ['2026-10-14T22:00:00.000Z', '2026-10-14T23:00:00.000Z', 'trip3', 'DETAIL', ['end', 'date']]
  );

  // ข้อความบอกวันเอง → เชื่อวันที่ที่สกัดมา ไม่ย้าย
  for (const text of ['วันนี้นัดรวมตัว 05.00 นะ', 'นัดรวมตัววันที่ 13 เวลา 05.00', 'พรุ่งนี้เจอกัน 05.00', 'see you today at 5']) {
    const [kept] = run([fiveToday], [trip3], text);
    assert.deepEqual([kept.startAt.toISOString(), kept.relatedActionId], ['2026-10-12T22:00:00.000Z', null], text);
  }
  // ไม่มีรายการเดิม หรือเป็นรายการทั้งวัน/ไม่มีเวลา → ไม่ย้าย
  assert.equal(run([fiveToday], [], 'นัดรวมตัว 05.00')[0].startAt.toISOString(), '2026-10-12T22:00:00.000Z');
  // มีกิจกรรมเดิมอยู่ในวันนี้อยู่แล้ว → เป็นรายละเอียดของวันนี้ ไม่ย้าย
  const todayEvent = { id: 'today', kind: 'EVENT', title: 'งานวันนี้', startAt: at('2026-10-12T17:00:00Z'), endAt: null, isAllDay: true };
  assert.deepEqual(run([fiveToday], [todayEvent, trip3], 'นัดรวมตัว 05.00').map((r) => [r.relatedActionId, r.startAt.toISOString()]), [['today', '2026-10-12T22:00:00.000Z']]);
  // หลายรายการเดิม: เลือกกิจกรรมที่จะถึงก่อน
  const later = { id: 'later', kind: 'EVENT', title: 'อีกงาน', startAt: at('2026-10-24T17:00:00Z'), endAt: null, isAllDay: true };
  assert.equal(run([fiveToday], [later, trip3], 'นัดรวมตัว 05.00')[0].relatedActionId, 'trip3');
});

test('thread linking: any day inside a multi-day event links as a detail', () => {
  const trip3 = { id: 'trip3', kind: 'EVENT', title: 'ภูกระดึง', startAt: at('2026-10-14T17:00:00Z'), endAt: at('2026-10-16T17:00:00Z'), isAllDay: true };
  const rel = (iso) => linkToExisting({ items: [newItem({ startAt: at(iso), isTimeSpecified: true })], existing: [trip3], timezone: TZ, latestText: 'วันที่ 16 ขึ้นเขา 06.00' })[0].relation;
  assert.equal(rel('2026-10-15T23:00:00Z'), 'DETAIL'); // 16 ต.ค. 06:00 = วันที่สองของทริป
  assert.equal(rel('2026-10-17T02:00:00Z'), 'DETAIL'); // 17 ต.ค. = วันสุดท้าย
  assert.equal(rel('2026-10-18T02:00:00Z'), null); // หลังทริปจบ
  assert.equal(hasDateCue('นัดรวมตัว 05.00 ที่หน้ามหาลัยขอนแก่น นะ เตรียมของมาให้พร้อม'), false);
  assert.equal(hasDateCue('เจอกัน 15/10 ตีห้า'), true);
});

test('validate: the range is found in the email body when the model quoted only part of it', () => {
  const text = 'ไปเที่ยวภูกระดึงกันไหม วันที่ 15/10/2569 - 17/10/2569';
  const opts = { plainText: text, timezone: TZ, now: at('2026-10-13T10:00:00Z') };
  const item = { kind: 'EVENT', title: 'ไปเที่ยว', start: '2026-10-15T00:00:00+07:00', end: null, isAllDay: false, isTimeSpecified: false, evidence: 'ไปเที่ยวภูกระดึงกันไหม' };
  const r = validateAnalysis({ category: 'APPOINTMENT', actionItems: [item] }, opts).actionItems[0];
  assert.deepEqual([r.isAllDay, r.endAt.toISOString()], [true, '2026-10-16T17:00:00.000Z']);
  // ช่วงวันที่ในเนื้ออีเมลที่ไม่ได้เริ่มวันเดียวกับรายการ ไม่ถูกนำมาใช้
  const other = validateAnalysis({ category: 'APPOINTMENT', actionItems: [{ ...item, start: '2026-10-20T00:00:00+07:00' }] }, opts).actionItems[0];
  assert.deepEqual([other.isAllDay, other.endAt], [false, null]);
});

// ───── หลายวันที่มีเวลา (เกิดทุกวันในช่วงเวลาเดิม) ─────
const { occurrencesOf, calendarDaysBetween } = require('../src/core/occurrences');
const { dailyRecurrence } = require('../src/connectors/calendar/google');

test('validate: several days with daily hours become one item repeated each day', () => {
  const text = 'นัดลงพื้นที่เก็บข้อมูล วันที่ 21-22 ตุลาคม 2569 เวลา 09.00 - 15.00 ทั้ง 2 วัน';
  const opts = { plainText: text, timezone: TZ, now: at('2026-10-13T10:00:00Z') };
  const one = (item) => validateAnalysis({ category: 'APPOINTMENT', actionItems: [{ kind: 'EVENT', title: 'ลงพื้นที่', isAllDay: false, isTimeSpecified: true, evidence: 'เวลา 09.00 - 15.00 ทั้ง 2 วัน', ...item }] }, opts).actionItems[0];

  // สิ่งที่โมเดลจริงตอบ: วันแรก 09:00 ถึงวันสุดท้าย 15:00
  const spanning = one({ start: '2026-10-21T09:00:00+07:00', end: '2026-10-22T15:00:00+07:00' });
  assert.deepEqual(
    [spanning.startAt.toISOString(), spanning.endAt.toISOString(), spanning.repeatDays, spanning.isAllDay],
    ['2026-10-21T02:00:00.000Z', '2026-10-21T08:00:00.000Z', 2, false]
  );
  // โมเดลให้แค่วันแรก แต่ข้อความมีช่วงวันที่
  const firstOnly = one({ start: '2026-10-21T09:00:00+07:00', end: '2026-10-21T15:00:00+07:00' });
  assert.deepEqual([firstOnly.repeatDays, firstOnly.endAt.toISOString()], [2, '2026-10-21T08:00:00.000Z']);
  // ข้ามคืน (เวลาจบก่อนเวลาเริ่ม) ยังเป็นกิจกรรมเดียวต่อเนื่อง
  const overnight = validateAnalysis(
    { category: 'BOOKING_TRAVEL', actionItems: [{ kind: 'EVENT', title: 'รถทัวร์', start: '2026-10-21T22:00:00+07:00', end: '2026-10-22T05:00:00+07:00', isTimeSpecified: true }] },
    { ...opts, plainText: 'ออกเดินทาง 22.00 ถึง 05.00' }
  ).actionItems[0];
  assert.deepEqual([overnight.repeatDays, overnight.endAt.toISOString()], [1, '2026-10-21T22:00:00.000Z']);
  // วันเดียวตามปกติ
  assert.equal(validateAnalysis({ category: 'APPOINTMENT', actionItems: [baseItem] }, ctx).actionItems[0].repeatDays, 1);
});

test('occurrences: one slot per day at the same clock time; recurrence rule only when needed', () => {
  const item = { startAt: at('2026-10-21T02:00:00Z'), endAt: at('2026-10-21T08:00:00Z'), repeatDays: 3, isAllDay: false };
  assert.deepEqual(
    occurrencesOf(item, TZ).map((o) => [o.start.toISOString(), o.end.toISOString()]),
    [
      ['2026-10-21T02:00:00.000Z', '2026-10-21T08:00:00.000Z'],
      ['2026-10-22T02:00:00.000Z', '2026-10-22T08:00:00.000Z'],
      ['2026-10-23T02:00:00.000Z', '2026-10-23T08:00:00.000Z'],
    ]
  );
  assert.equal(occurrencesOf({ ...item, repeatDays: 1 }, TZ).length, 1);
  assert.equal(occurrencesOf({ ...item, isAllDay: true }, TZ).length, 1); // ทั้งวันหลายวันใช้วันสิ้นสุด ไม่ใช้การซ้ำ
  // ช่วงเปลี่ยนเวลาออมแสง: เวลาบนนาฬิกาคงเดิม
  const london = occurrencesOf({ startAt: at('2026-10-24T08:00:00Z'), endAt: at('2026-10-24T09:00:00Z'), repeatDays: 2 }, 'Europe/London');
  assert.equal(london[1].start.toISOString(), '2026-10-25T09:00:00.000Z');
  assert.equal(calendarDaysBetween(at('2026-10-20T18:00:00Z'), at('2026-10-22T08:00:00Z'), TZ), 1); // 21 ต.ค. 01:00 → 22 ต.ค. 15:00 เวลาไทย
  assert.deepEqual(dailyRecurrence(2, false), ['RRULE:FREQ=DAILY;COUNT=2']);
  assert.deepEqual([dailyRecurrence(1, false), dailyRecurrence(3, true)], [[], []]);
});

test('availability: every day of a multi-day item is checked', async () => {
  const day2Meeting = { id: 'd2', title: 'ประชุมวันที่สอง', start: '2026-08-25T10:00:00+07:00', end: '2026-08-25T11:00:00+07:00' };
  const item = { kind: 'EVENT', isAllDay: false, isTimeSpecified: true, startAt: at('2026-08-24T02:00:00Z'), endAt: at('2026-08-24T08:00:00Z'), repeatDays: 2 }; // 09:00–15:00
  const run = (events, it = item) => evaluateAvailability({ items: [it], mode: 'SUGGEST', calendar: { listEvents: async () => events }, settings, now: NOW });

  assert.equal((await run([]))[0].availability, 'AVAILABLE'); // อยู่ในเวลาทำงานทั้งสองวัน (ไม่ถูกมองเป็นกิจกรรมยาว 30 ชั่วโมง)
  const [clash] = await run([day2Meeting]);
  assert.deepEqual([clash.availability, clash.suggestedSlots], ['CONFLICT', null]);
  assert.match(clash.availabilityReason, /ประชุมวันที่สอง/);
  // วันที่สองตรงกับวันหยุด
  const [weekend] = await run([], { ...item, startAt: at('2026-08-28T02:00:00Z'), endAt: at('2026-08-28T08:00:00Z') }); // ศุกร์–เสาร์
  assert.equal(weekend.availability, 'OUT_OF_WORK_DAYS');
  // ทุกครั้งของกิจกรรมเดิมที่เกิดซ้ำไม่นับว่าชนกับตัวเอง
  const own = { ...day2Meeting, id: 'master_1', recurringEventId: 'master' };
  assert.equal((await run([own], { ...item, relatedActionId: 'x', ignoreEventId: 'master' }))[0].availability, 'AVAILABLE');
});

test('thread linking: a detail on any day of a repeated item links to it', () => {
  const fieldwork = { id: 'fw', kind: 'EVENT', title: 'ลงพื้นที่', startAt: at('2026-10-21T02:00:00Z'), endAt: at('2026-10-21T08:00:00Z'), isAllDay: false, repeatDays: 2 };
  const rel = (iso) => linkToExisting({ items: [newItem({ startAt: at(iso), isTimeSpecified: true })], existing: [fieldwork], timezone: TZ, latestText: 'วันที่ 22 เจอกัน 08.00' })[0].relation;
  assert.equal(rel('2026-10-22T01:00:00Z'), 'DETAIL'); // วันที่สอง
  assert.equal(rel('2026-10-23T01:00:00Z'), null); // หลังจบ
});

// ───── notifications ─────
const { escapeHtml, pickNotifiableItems, buildAppointmentNotification } = require('../src/core/notifications');

test('notifications: only pending appointment events that are not over are picked', () => {
  const ev = (over) => ({ kind: 'EVENT', status: 'SUGGESTED', title: 'ประชุม', startAt: new Date('2026-08-24T03:00:00Z'), endAt: new Date('2026-08-24T04:00:00Z'), isTimeSpecified: true, ...over });
  const pick = (items, category = 'APPOINTMENT') => pickNotifiableItems({ category, items, now: NOW, timezone: TZ });
  assert.equal(pick([ev()]).length, 1);
  assert.equal(pick([ev()], 'EVENT_INVITATION').length, 0); // ประเภทอื่นไม่แจ้ง
  assert.equal(pick([ev({ kind: 'DEADLINE' })]).length, 0);
  assert.equal(pick([ev({ status: 'CREATED' })]).length, 0); // ลงปฏิทินแล้ว
  assert.equal(pick([ev({ startAt: new Date('2026-08-10T03:00:00Z'), endAt: new Date('2026-08-10T04:00:00Z') })]).length, 0); // ผ่านไปแล้ว
  assert.equal(pick([ev({ startAt: null, endAt: null })]).length, 1); // ยังไม่มีวันที่ ผู้ใช้ต้องเข้าไปเติม
  // กิจกรรมหลายวันที่วันแรกผ่านไปแล้ว แต่วันสุดท้ายยังไม่ถึง
  assert.equal(pick([ev({ startAt: new Date('2026-08-19T02:00:00Z'), endAt: new Date('2026-08-19T08:00:00Z'), repeatDays: 3 })]).length, 1);
});

test('notifications: content from the email is escaped and reschedules get their own subject', () => {
  const item = { kind: 'EVENT', status: 'SUGGESTED', title: '<script>x</script>', startAt: new Date('2026-08-24T03:00:00Z'), endAt: new Date('2026-08-24T04:00:00Z'), isTimeSpecified: true, repeatDays: 2, availability: 'CONFLICT', availabilityReason: 'ชนกับ "ประชุมทีม"' };
  const email = { fromName: 'A <b>B</b>', fromAddress: 'a@x.com', subject: 'นัด <img src=x onerror=alert(1)>' };
  const n = buildAppointmentNotification({ email, items: [item], timezone: TZ, inboxUrl: 'http://localhost:3000/inbox?email=e1', hasDraft: true });
  assert.match(n.subject, /นัดหมายใหม่/);
  assert.ok(!n.html.includes('<script>') && !n.html.includes('<img') && !n.html.includes('<b>B'));
  assert.ok(n.html.includes('&lt;script&gt;'));
  assert.match(n.html, /วันจันทร์ที่ 24 สิงหาคม 2569 เวลา 10:00 - 11:00 น\. · ทุกวัน รวม 2 วัน/);
  assert.match(n.html, /ชนกับ &quot;ประชุมทีม&quot;/);
  assert.match(n.html, /href="http:\/\/localhost:3000\/inbox\?email=e1"/);
  assert.match(n.html, /ร่างการตอบกลับ/);
  const r = buildAppointmentNotification({ email, items: [{ ...item, relation: 'RESCHEDULE' }], timezone: TZ, inboxUrl: 'u', hasDraft: false });
  assert.match(r.subject, /ขอเลื่อนนัด/);
  assert.equal(escapeHtml(`a&'"`), 'a&amp;&#39;&quot;');
});

// ───── inline images ─────
const { toStandardBase64, replaceCidImages } = require('../src/utils/emailText');

test('inline images: cid references become data URIs, others stay untouched', () => {
  assert.equal(toStandardBase64('ab-_cd'), 'ab+/cd==');
  assert.equal(toStandardBase64('abcd'), 'abcd');
  const html = '<p><img src="cid:logo@x"> <img src=\'CID:logo@x\'> <img src="cid:missing"> <img src="cid:logo@xyz"></p>';
  const out = replaceCidImages(html, [
    { cid: 'logo@x', mimeType: 'image/png', data: 'iVBO-_' },
    { cid: 'nodata', mimeType: 'image/png', data: null },
  ]);
  assert.equal((out.match(/data:image\/png;base64,iVBO\+\/==/g) || []).length, 2); // ไม่สนตัวพิมพ์เล็กใหญ่ของ cid:
  assert.ok(out.includes('src="cid:missing"')); // ไม่มีข้อมูล → คงเดิม (หน้าเว็บตัด src ทิ้งเอง)
  assert.ok(out.includes('src="cid:logo@xyz"')); // cid ที่ขึ้นต้นเหมือนกันไม่ถูกแทนผิดตัว
});
