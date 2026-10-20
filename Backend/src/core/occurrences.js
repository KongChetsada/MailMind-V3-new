// กิจกรรมที่เกิดซ้ำทุกวันในช่วงเวลาเดิม (เช่น อบรม 21–22 ต.ค. เวลา 09:00–15:00 ทั้งสองวัน)
// เก็บเป็นช่วงเวลาของวันแรก (startAt–endAt) + repeatDays = จำนวนวันติดกัน
const { zonedParts, zonedToUtc } = require('./time');

const MAX_REPEAT_DAYS = 31;

const repeatCount = (item) => {
  const n = Number(item?.repeatDays) || 1;
  return item?.isAllDay || !item?.startAt || !item?.endAt ? 1 : Math.min(Math.max(n, 1), MAX_REPEAT_DAYS);
};

/** เลื่อนเวลาไป n วันตามปฏิทินของ timezone โดยคงเวลาบนนาฬิกาไว้ */
const shiftDays = (date, days, tz) => {
  if (days === 0) return date;
  const p = zonedParts(date, tz);
  return zonedToUtc({ year: p.year, month: p.month, day: p.day + days, hour: p.hour, minute: p.minute, second: p.second }, tz);
};

/** ทุกครั้งที่กิจกรรมเกิดขึ้น: [{ start, end }] */
const occurrencesOf = (item, tz) =>
  Array.from({ length: repeatCount(item) }, (_unused, i) => ({
    start: shiftDays(item.startAt, i, tz),
    end: item.endAt ? shiftDays(item.endAt, i, tz) : null,
  }));

/** เวลาเริ่มของวันสุดท้ายที่กิจกรรมเกิด */
const lastOccurrenceStart = (item, tz) => shiftDays(item.startAt, repeatCount(item) - 1, tz);

/** จำนวนวันตามปฏิทินระหว่างสองเวลา (ไม่สนเวลาบนนาฬิกา) */
const calendarDaysBetween = (from, to, tz) => {
  const a = zonedParts(from, tz);
  const b = zonedParts(to, tz);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000);
};

module.exports = { MAX_REPEAT_DAYS, repeatCount, shiftDays, occurrencesOf, lastOccurrenceStart, calendarDaysBetween };
