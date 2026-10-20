// ผูกรายการที่สกัดจากอีเมลฉบับใหม่ เข้ากับรายการเดิมในเธรดเดียวกัน
// ใช้กฎเป็นหลัก — โมเดลขนาดเล็กมักไม่กรอกความสัมพันธ์มาให้ จึงไม่พึ่งคำตอบของ AI
//
// existing      : รายการเดิมในเธรด [{ id, kind, title, startAt, endAt, isAllDay, status }]
//                 เรียงตามลำดับที่ส่งให้ AI เห็น (AI อ้างด้วยลำดับ 1, 2, 3, ...)
// items         : รายการใหม่จาก validateAnalysis พร้อม relatesTo (ลำดับ) และ relation ที่ AI เสนอ
// latestText    : เนื้อความของข้อความล่าสุดในเธรด (ไม่รวมข้อความที่อ้างถึงฉบับก่อน)
// referenceDate : วันที่ได้รับอีเมลฉบับนี้
//
// ผลลัพธ์ต่อรายการ:
//   RESCHEDULE — ข้อความล่าสุดขอเปลี่ยนวันเวลา (AI ระบุ หรือพบคำว่าเลื่อน/เปลี่ยนในข้อความ)
//                และวันเวลาใหม่ต่างจากรายการเดิมจริง
//   DETAIL     — วันของรายการใหม่อยู่ในช่วงวันของรายการเดิมชนิดเดียวกัน
//   ไม่ผูก      — กรณีอื่นทั้งหมด
// รายการที่วันเวลาตรงกับรายการเดิมทุกประการถือว่าซ้ำ และถูกตัดออก
//
// ข้อความที่บอกแค่เวลา (เช่น "นัดรวมตัว 05.00") โดยไม่บอกวัน: โมเดลมักใส่วันที่ได้รับอีเมลมาให้
// ถ้าข้อความล่าสุดไม่มีคำบอกวันเลย ระบบย้ายรายการไปวันแรกของกิจกรรมเดิมในเธรด และติดธง 'date' ให้ผู้ใช้ตรวจ
const { zonedParts, zonedToUtc } = require('./time');
const { lastOccurrenceStart, repeatCount } = require('./occurrences');

// คำที่บอกว่าผู้ส่งขอเปลี่ยนวันเวลา — เพิ่มคำได้ที่นี่
const RESCHEDULE_CUES = [
  /เลื่อน/,
  /เปลี่ยน(เป็น|ไป|วัน|เวลา|กำหนด)/,
  /ย้าย(เป็น|ไป|วัน|เวลา)/,
  /ขยับ(เป็น|ไป|วัน|เวลา)/,
  /\bre-?schedul/i,
  /\bpostpone/i,
  /\bpush(ed)? (back|to)\b/i,
  /\bmove(d)? (it |the \w+ )?to\b/i,
];

// คำหรือรูปแบบที่บอกว่าข้อความระบุ "วัน" ไว้เอง — เพิ่มได้ที่นี่
const DATE_CUES = [
  /\d{1,2}\s*\/\s*\d{1,2}/, // 15/10 (ไม่รับจุด เพราะ "05.00" คือเวลา)
  /\d{1,2}\.\d{1,2}\.\d{2,4}/, // 15.10.2569
  /วันที่\s*\d/,
  /\d{1,2}\s*(ม\.ค|ก\.พ|มี\.ค|เม\.ย|พ\.ค|มิ\.ย|ก\.ค|ส\.ค|ก\.ย|ต\.ค|พ\.ย|ธ\.ค)/,
  /(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)/,
  /วัน(นี้|พรุ่ง|มะรืน|จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์)/,
  /(พรุ่งนี้|มะรืน|คืนนี้|เย็นนี้|เช้านี้|บ่ายนี้|สัปดาห์หน้า|อาทิตย์หน้า|เดือนหน้า)/,
  /\b(today|tonight|tomorrow|next week|mon(day)?|tue(sday)?|wed(nesday)?|thu(rsday)?|fri(day)?|sat(urday)?|sun(day)?)\b/i,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i,
  /\b\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
];

const hasRescheduleCue = (text) => RESCHEDULE_CUES.some((cue) => cue.test(String(text || '')));
const hasDateCue = (text) => DATE_CUES.some((cue) => cue.test(String(text || '')));

/** เลขวันเรียงลำดับได้ (yyyymmdd) ตาม timezone */
const dayNumber = (date, tz) => {
  const p = zonedParts(date, tz);
  return p.year * 10000 + p.month * 100 + p.day;
};

const sameMoment = (a, b) => (a?.getTime?.() ?? null) === (b?.getTime?.() ?? null);

const isDuplicate = (item, old) =>
  item.kind === old.kind &&
  Boolean(item.startAt) &&
  sameMoment(item.startAt, old.startAt) &&
  sameMoment(item.endAt, old.endAt) &&
  Boolean(item.isAllDay) === Boolean(old.isAllDay) &&
  repeatCount(item) === repeatCount(old);

/** วันนั้นอยู่ในช่วงวันของรายการเดิมหรือไม่ (รายการหลายวันครอบคลุมทุกวันในช่วง) */
const coversDay = (old, day, tz) => {
  const first = dayNumber(old.startAt, tz);
  const last = repeatCount(old) > 1 ? dayNumber(lastOccurrenceStart(old, tz), tz) : old.endAt ? dayNumber(old.endAt, tz) : first;
  return day >= first && day <= Math.max(first, last);
};

/** ย้ายรายการไปอยู่วันเดียวกับ target โดยคงเวลาเดิมไว้ */
const moveToDayOf = (item, target, tz) => {
  const day = zonedParts(target.startAt, tz);
  const clock = zonedParts(item.startAt, tz);
  const startAt = zonedToUtc({ year: day.year, month: day.month, day: day.day, hour: clock.hour, minute: clock.minute }, tz);
  const shift = startAt.getTime() - item.startAt.getTime();
  return {
    ...item,
    startAt,
    endAt: item.endAt ? new Date(item.endAt.getTime() + shift) : null,
    missingFields: [...new Set([...(item.missingFields || []), 'date'])],
  };
};

const linkToExisting = ({ items, existing, timezone, latestText = '', referenceDate = null }) => {
  const unlinked = (item) => ({ ...item, relatedActionId: null, relation: null });
  if (!existing?.length) return items.map(unlinked);

  const rescheduleCue = hasRescheduleCue(latestText);
  const dateStated = hasDateCue(latestText);
  const today = referenceDate ? dayNumber(referenceDate, timezone) : null;
  const linked = [];

  for (let item of items) {
    if (existing.some((old) => isDuplicate(item, old))) continue; // อีเมลแค่กล่าวซ้ำ
    if (!item.startAt) {
      linked.push(unlinked(item));
      continue;
    }

    const candidates = existing.filter((old) => old.kind === item.kind && old.startAt);
    const suggested = Number.isInteger(item.relatesTo) ? existing[item.relatesTo - 1] : null;
    const validSuggestion = suggested && candidates.includes(suggested) ? suggested : null;

    // 0) บอกแค่เวลา ไม่บอกวัน: วันที่ที่โมเดลใส่มาคือวันรับอีเมล → ใช้วันของกิจกรรมเดิมแทน
    const timeOnly =
      !dateStated && !rescheduleCue && today !== null && item.isTimeSpecified && !item.isAllDay && dayNumber(item.startAt, timezone) === today;
    if (timeOnly && !candidates.some((old) => coversDay(old, today, timezone))) {
      const upcoming = candidates
        .filter((old) => dayNumber(old.startAt, timezone) >= today)
        .sort((a, b) => a.startAt - b.startAt);
      const target = validSuggestion || (candidates.length === 1 ? candidates[0] : upcoming[0]);
      if (target) item = moveToDayOf(item, target, timezone);
    }

    const day = dayNumber(item.startAt, timezone);
    const sameDay = candidates.filter((old) => coversDay(old, day, timezone));
    const moved = (old) => !sameMoment(item.startAt, old.startAt);

    // 1) เลื่อนนัด: AI ชี้เป้าและบอกว่าเลื่อน หรือข้อความมีคำว่าเลื่อน/เปลี่ยน
    //    เป้าหมาย: ตัวที่ AI ชี้ → รายการที่มีเวลาในวันเดียวกัน → รายการเดียวที่มีอยู่ (ถ้ามีหลายรายการและไม่รู้ว่าตัวไหน ไม่เดา)
    if ((item.relation === 'RESCHEDULE' && validSuggestion) || rescheduleCue) {
      const target =
        validSuggestion ||
        sameDay.find((old) => !old.isAllDay) ||
        (sameDay.length === 0 && candidates.length === 1 ? candidates[0] : null);
      if (target && moved(target)) {
        linked.push({ ...item, relatedActionId: target.id, relation: 'RESCHEDULE' });
        continue;
      }
    }

    // 2) รายละเอียดเพิ่ม: วันของรายการใหม่อยู่ในช่วงวันของรายการเดิมชนิดเดียวกัน
    const detailTarget = validSuggestion && sameDay.includes(validSuggestion) ? validSuggestion : sameDay[0];
    if (detailTarget) {
      linked.push({ ...item, relatedActionId: detailTarget.id, relation: 'DETAIL' });
      continue;
    }

    linked.push(unlinked(item));
  }
  return linked;
};

module.exports = { linkToExisting, isDuplicate, hasRescheduleCue, hasDateCue };
