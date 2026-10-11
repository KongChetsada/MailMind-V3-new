// คำนวณวันเวลาตาม timezone ของผู้ใช้ โดยไม่ขึ้นกับ timezone ของเครื่องเซิร์ฟเวอร์

const DEFAULT_TZ = 'Asia/Bangkok';
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatterCache = new Map();

const isValidTimeZone = (tz) => {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** รับค่าจากการตั้งค่า (รวมรูปแบบเก่า เช่น "asia-bangkok") แล้วคืนชื่อ IANA ที่ใช้ได้เสมอ */
const normalizeTimeZone = (value) => {
  if (isValidTimeZone(value)) return value;
  const legacy = { 'asia-bangkok': 'Asia/Bangkok', 'asia-tokyo': 'Asia/Tokyo', 'europe-london': 'Europe/London' };
  return legacy[String(value || '').toLowerCase()] || DEFAULT_TZ;
};

const getFormatter = (tz) => {
  if (!formatterCache.has(tz)) {
    formatterCache.set(
      tz,
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        weekday: 'short',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      })
    );
  }
  return formatterCache.get(tz);
};

/** ส่วนประกอบของเวลา ณ timezone ที่กำหนด */
const zonedParts = (date, tz) => {
  const out = {};
  for (const part of getFormatter(tz).formatToParts(date)) {
    if (part.type === 'weekday') out.weekday = WEEKDAY_INDEX[part.value];
    else if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return out; // { year, month(1-12), day, hour, minute, second, weekday(0=อาทิตย์) }
};

const tzOffsetMinutes = (date, tz) => {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
};

/** แปลงเวลาท้องถิ่นของ timezone เป็น Date (UTC) */
const zonedToUtc = ({ year, month, day, hour = 0, minute = 0, second = 0 }, tz) => {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = guess - tzOffsetMinutes(new Date(guess), tz) * 60000;
  // คำนวณซ้ำหนึ่งรอบเผื่อช่วงเปลี่ยนเวลาออมแสง
  return new Date(guess - tzOffsetMinutes(new Date(first), tz) * 60000);
};

const startOfZonedDay = (date, tz) => {
  const p = zonedParts(date, tz);
  return zonedToUtc({ year: p.year, month: p.month, day: p.day }, tz);
};

/** เลื่อนวันตามปฏิทินของ timezone (คงเวลา 00:00 ของวันนั้น) */
const addZonedDays = (dayStart, days, tz) => {
  const p = zonedParts(dayStart, tz);
  return zonedToUtc({ year: p.year, month: p.month, day: p.day + days }, tz);
};

/** "+07:00" */
const offsetString = (tz, date = new Date()) => {
  const minutes = tzOffsetMinutes(date, tz);
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
};

const THAI_DAYS = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const pad = (n) => String(n).padStart(2, '0');

/** "วันจันทร์ที่ 24 สิงหาคม 2569" */
const formatThaiDate = (date, tz) => {
  const p = zonedParts(date, tz);
  return `${THAI_DAYS[p.weekday]}ที่ ${p.day} ${THAI_MONTHS[p.month - 1]} ${p.year + 543}`;
};

/** "วันจันทร์ที่ 24 สิงหาคม 2569 เวลา 10:00 - 11:00 น." */
const formatThaiRange = (start, end, tz) => {
  const s = zonedParts(start, tz);
  const base = `${formatThaiDate(start, tz)} เวลา ${pad(s.hour)}:${pad(s.minute)}`;
  if (!end) return `${base} น.`;
  const e = zonedParts(end, tz);
  return `${base} - ${pad(e.hour)}:${pad(e.minute)} น.`;
};

module.exports = {
  DEFAULT_TZ,
  THAI_DAYS,
  isValidTimeZone,
  normalizeTimeZone,
  zonedParts,
  tzOffsetMinutes,
  zonedToUtc,
  startOfZonedDay,
  addZonedDays,
  offsetString,
  formatThaiDate,
  formatThaiRange,
};
