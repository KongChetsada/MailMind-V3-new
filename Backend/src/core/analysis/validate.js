// ตรวจและปรับผลลัพธ์จาก AI ด้วยโค้ด ก่อนบันทึกลงฐานข้อมูล
const { analysisSchema } = require('./schema');
const { normalizeTimeZone, zonedToUtc, zonedParts } = require('../time');

const MAX_ACTION_ITEMS = 5;
const DEFAULT_EVENT_MINUTES = 60;

class AnalysisValidationError extends Error {
  constructor(message, issues) {
    super(message);
    this.name = 'AnalysisValidationError';
    this.issues = issues;
  }
}

const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

/**
 * แปลงสตริงวันเวลาจาก AI เป็น Date
 * - ไม่มี offset → ตีความตาม timezone ของผู้ใช้
 * - ปี พ.ศ. ที่หลุดมา (เช่น 2569) → แปลงเป็น ค.ศ.
 * - ปีอยู่นอกช่วงที่สมเหตุสมผล → null
 */
const parseAiDate = (value, { timezone, now }) => {
  if (!value || typeof value !== 'string') return null;
  let text = value.trim();
  const m = LOCAL_ISO.exec(text);
  if (!m) return null;

  let year = Number(m[1]);
  if (year >= 2400 && year <= 2700) {
    year -= 543;
    text = `${year}${text.slice(4)}`;
  }

  let date;
  if (HAS_OFFSET.test(text) && m[4] !== undefined) {
    date = new Date(text);
  } else {
    date = zonedToUtc(
      { year, month: Number(m[2]), day: Number(m[3]), hour: Number(m[4] || 0), minute: Number(m[5] || 0), second: Number(m[6] || 0) },
      timezone
    );
  }
  if (isNaN(date)) return null;

  const currentYear = zonedParts(now, timezone).year;
  const y = zonedParts(date, timezone).year;
  return y >= currentYear - 1 && y <= currentYear + 3 ? date : null;
};

const squash = (s) => String(s || '').toLowerCase().replace(/[\s"'“”‘’.,:;()\-–—/]+/g, '');

/** หลักฐานถือว่ายืนยันได้เมื่อข้อความที่ AI อ้างพบในเนื้ออีเมลจริง (ไม่สนช่องว่างและเครื่องหมายวรรคตอน) */
const isEvidenceInText = (evidence, plainText) => {
  const needle = squash(evidence);
  return needle.length >= 6 && squash(plainText).includes(needle);
};

const normalizeItem = (item, ctx) => {
  const missingFields = [];
  let startAt = parseAiDate(item.start, ctx);
  let endAt = parseAiDate(item.end, ctx);
  let { isAllDay, isTimeSpecified } = item;

  if (!startAt) {
    missingFields.push('start');
    endAt = null;
    isTimeSpecified = false;
  }

  if (item.kind === 'DEADLINE') {
    endAt = null;
    if (startAt && !isTimeSpecified) isAllDay = true;
  } else if (startAt) {
    if (isAllDay) {
      isTimeSpecified = false;
      if (endAt && endAt <= startAt) endAt = null;
    } else if (!isTimeSpecified) {
      missingFields.push('time');
      endAt = null;
    } else if (!endAt || endAt <= startAt) {
      endAt = new Date(startAt.getTime() + DEFAULT_EVENT_MINUTES * 60000);
      missingFields.push('end');
    }
  }

  let evidence = item.evidence;
  if (!evidence || !isEvidenceInText(evidence, ctx.plainText)) {
    evidence = null;
    missingFields.push('evidence');
  }

  return {
    kind: item.kind,
    title: item.title.slice(0, 200),
    startAt,
    endAt,
    isAllDay: Boolean(isAllDay),
    isTimeSpecified: Boolean(isTimeSpecified),
    location: item.location ? item.location.slice(0, 300) : null,
    evidence: evidence ? evidence.slice(0, 500) : null,
    missingFields,
  };
};

/**
 * ตรวจผลลัพธ์ดิบจาก AI
 * @param raw        object ที่แกะจาก JSON แล้ว
 * @param plainText  เนื้ออีเมลที่ส่งให้ AI (ใช้ตรวจหลักฐาน)
 * @throws AnalysisValidationError เมื่อโครงสร้างหลักใช้ไม่ได้
 */
const validateAnalysis = (raw, { plainText = '', timezone, now = new Date() } = {}) => {
  if (!raw || typeof raw !== 'object') {
    throw new AnalysisValidationError('ผลลัพธ์จาก AI ไม่ใช่ JSON ที่อ่านได้');
  }
  const parsed = analysisSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new AnalysisValidationError(`ผลลัพธ์จาก AI ไม่ตรงโครงสร้าง (${issues[0]})`, issues);
  }

  const ctx = { plainText, timezone: normalizeTimeZone(timezone), now };
  const seen = new Set();
  const actionItems = [];
  for (const item of parsed.data.actionItems) {
    const normalized = normalizeItem(item, ctx);
    const key = `${normalized.kind}|${normalized.startAt?.toISOString() || ''}|${squash(normalized.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    actionItems.push(normalized);
    if (actionItems.length >= MAX_ACTION_ITEMS) break;
  }

  return {
    category: parsed.data.category,
    priority: parsed.data.priority,
    summary: parsed.data.summary.slice(0, 1000),
    needsReply: parsed.data.needsReply,
    replyIntent: parsed.data.replyIntent,
    actionItems,
  };
};

module.exports = { validateAnalysis, parseAiDate, isEvidenceInText, AnalysisValidationError };
