// ตรวจและปรับผลลัพธ์จาก AI ด้วยโค้ด ก่อนบันทึกลงฐานข้อมูล
const { analysisSchema } = require('./schema');
const { findDateRange } = require('./dateRange');
const { normalizeTimeZone, zonedToUtc, zonedParts } = require('../time');
const { MAX_REPEAT_DAYS, calendarDaysBetween } = require('../occurrences');

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

  // โมเดลบางครั้งติดธง "ทั้งวัน" ทั้งที่ระบุเวลาชัดเจน (เช่น 02:00) — เวลาที่ระบุมีน้ำหนักกว่า
  if (startAt && isAllDay && isTimeSpecified) {
    const p = zonedParts(startAt, ctx.timezone);
    if (p.hour !== 0 || p.minute !== 0) isAllDay = false;
  }

  const atMidnight = (date) => {
    const p = zonedParts(date, ctx.timezone);
    return p.hour === 0 && p.minute === 0;
  };

  // เวลา 00:00 ที่โมเดลติดธงว่า "ระบุเวลา" คือวันที่ที่ไม่มีเวลาจริง (โมเดลเติม 00:00 ให้เอง)
  if (startAt && isTimeSpecified && atMidnight(startAt) && (!endAt || atMidnight(endAt))) isTimeSpecified = false;

  // ช่วงหลายวัน: โมเดลมักสกัดมาแค่วันแรก — หาช่วงวันที่จากข้อความอ้างอิงด้วยกฎ (เฉพาะรายการที่ไม่มีเวลา)
  if (item.kind === 'EVENT' && startAt && !isTimeSpecified) {
    const evidenceOk = item.evidence && isEvidenceInText(item.evidence, ctx.plainText);
    const referenceYear = zonedParts(startAt, ctx.timezone).year;
    // หาในข้อความอ้างอิงก่อน ถ้าโมเดลคัดมาไม่ครบช่วง จึงหาในเนื้ออีเมล (ใช้ได้เมื่อวันแรกตรงกับที่สกัดมาเท่านั้น)
    const range =
      (evidenceOk && findDateRange(item.evidence, { timezone: ctx.timezone, referenceYear })) ||
      findDateRange(ctx.plainText, { timezone: ctx.timezone, referenceYear });
    const sameFirstDay = range && Math.abs(range.start - startAt) < 86400000;
    if (sameFirstDay) {
      startAt = range.start;
      endAt = range.end;
      isAllDay = true;
    } else if (endAt && endAt - startAt >= 86400000) {
      isAllDay = true; // โมเดลให้วันสิ้นสุดมาเองและห่างกันเกินหนึ่งวัน
    }
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

  // หลายวันที่มีเวลา: "21–22 ต.ค. เวลา 09:00–15:00 ทั้งสองวัน" = เกิดทุกวันในช่วงเวลาเดิม ไม่ใช่กิจกรรมเดียวยาว 30 ชั่วโมง
  let repeatDays = 1;
  if (item.kind === 'EVENT' && startAt && endAt && isTimeSpecified && !isAllDay) {
    const days = calendarDaysBetween(startAt, endAt, ctx.timezone);
    const s = zonedParts(startAt, ctx.timezone);
    const e = zonedParts(endAt, ctx.timezone);
    const endsLaterInDay = e.hour * 60 + e.minute > s.hour * 60 + s.minute;
    if (days >= 1 && days < MAX_REPEAT_DAYS && endsLaterInDay) {
      // โมเดลให้ "วันแรก 09:00 ถึงวันสุดท้าย 15:00" → ช่วงเวลาของวันแรก + จำนวนวัน
      // (เวลาจบก่อนเวลาเริ่ม เช่น 22:00 ถึง 02:00 ของวันถัดไป คือกิจกรรมข้ามคืน ไม่ใช่รายวัน)
      repeatDays = days + 1;
      endAt = zonedToUtc({ year: s.year, month: s.month, day: s.day, hour: e.hour, minute: e.minute }, ctx.timezone);
    } else if (days === 0) {
      // โมเดลให้แค่วันแรก แต่ข้อความมีช่วงวันที่ที่เริ่มวันเดียวกัน
      const referenceYear = s.year;
      const evidenceOk = item.evidence && isEvidenceInText(item.evidence, ctx.plainText);
      const range =
        (evidenceOk && findDateRange(item.evidence, { timezone: ctx.timezone, referenceYear })) ||
        findDateRange(ctx.plainText, { timezone: ctx.timezone, referenceYear });
      if (range && calendarDaysBetween(range.start, startAt, ctx.timezone) === 0) {
        repeatDays = Math.min(calendarDaysBetween(range.start, range.end, ctx.timezone) + 1, MAX_REPEAT_DAYS);
      }
    }
  }

  let evidence = item.evidence;
  if (!evidence || !isEvidenceInText(evidence, ctx.plainText)) {
    evidence = null;
    missingFields.push('evidence');
  }

  return {
    kind: item.kind,
    title: (item.title || ctx.fallbackTitle || 'รายการจากอีเมล').slice(0, 200),
    startAt,
    endAt,
    isAllDay: Boolean(isAllDay),
    isTimeSpecified: Boolean(isTimeSpecified),
    repeatDays,
    location: item.location ? item.location.slice(0, 300) : null,
    evidence: evidence ? evidence.slice(0, 500) : null,
    missingFields,
    relatesTo: item.relatesTo,
    relation: item.relation,
  };
};

/**
 * ตรวจผลลัพธ์ดิบจาก AI
 * @param raw        object ที่แกะจาก JSON แล้ว
 * @param plainText  เนื้ออีเมลที่ส่งให้ AI (ใช้ตรวจหลักฐาน)
 * @param fallbackTitle  หัวข้ออีเมล ใช้เป็นชื่อรายการเมื่อ AI เว้นว่าง
 * @throws AnalysisValidationError เมื่อโครงสร้างหลักใช้ไม่ได้
 */
const validateAnalysis = (raw, { plainText = '', timezone, now = new Date(), fallbackTitle = '' } = {}) => {
  if (!raw || typeof raw !== 'object') {
    throw new AnalysisValidationError('ผลลัพธ์จาก AI ไม่ใช่ JSON ที่อ่านได้');
  }
  const parsed = analysisSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new AnalysisValidationError(`ผลลัพธ์จาก AI ไม่ตรงโครงสร้าง (${issues[0]})`, issues);
  }

  // ชื่อสำรองเมื่อโมเดลไม่ตั้งชื่อรายการ: หัวข้ออีเมลที่ตัด Re:/Fwd: ออก
  const cleanSubject = String(fallbackTitle || '').replace(/^((re|fwd?|ตอบกลับ|ส่งต่อ)\s*:\s*)+/i, '').trim();
  const ctx = { plainText, timezone: normalizeTimeZone(timezone), now, fallbackTitle: cleanSubject };
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
