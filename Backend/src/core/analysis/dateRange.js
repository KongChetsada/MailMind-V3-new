// หาช่วงวันที่ (หลายวัน) ในข้อความด้วยกฎ — ใช้เสริมเมื่อโมเดลสกัดมาแค่วันแรก
// รองรับ:  15/10/2569 - 17/10/2569 · 15-17 ตุลาคม 2569 · 15 ต.ค. - 17 ต.ค. 69 · 15-17 Oct 2026
const { zonedToUtc } = require('../time');

const MONTHS = [
  ['มกราคม', 'ม.ค.', 'january', 'jan'],
  ['กุมภาพันธ์', 'ก.พ.', 'february', 'feb'],
  ['มีนาคม', 'มี.ค.', 'march', 'mar'],
  ['เมษายน', 'เม.ย.', 'april', 'apr'],
  ['พฤษภาคม', 'พ.ค.', 'may'],
  ['มิถุนายน', 'มิ.ย.', 'june', 'jun'],
  ['กรกฎาคม', 'ก.ค.', 'july', 'jul'],
  ['สิงหาคม', 'ส.ค.', 'august', 'aug'],
  ['กันยายน', 'ก.ย.', 'september', 'sept', 'sep'],
  ['ตุลาคม', 'ต.ค.', 'october', 'oct'],
  ['พฤศจิกายน', 'พ.ย.', 'november', 'nov'],
  ['ธันวาคม', 'ธ.ค.', 'december', 'dec'],
];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MONTH_NAMES = MONTHS.flat().sort((a, b) => b.length - a.length);
const MONTH = `(${MONTH_NAMES.map(escape).join('|')})`;
const SEP = '\\s*(?:-|–|—|ถึง|จนถึง|to)\\s*';
const YEAR = '(\\d{4}|\\d{2})';

const monthNumber = (name) => MONTHS.findIndex((names) => names.includes(String(name).toLowerCase())) + 1;

/** ปีจากข้อความ: พ.ศ. → ค.ศ., สองหลัก → เดาศตวรรษ, ไม่ระบุ → ปีอ้างอิง */
const toYear = (text, fallbackYear) => {
  if (!text) return fallbackYear;
  let y = Number(text);
  if (text.length === 2) y += y >= 43 ? 2500 : 2000; // 69 → 2569, 26 → 2026
  return y >= 2400 ? y - 543 : y;
};

const PATTERNS = [
  // 15/10/2569 - 17/10/2569
  {
    re: new RegExp(`(\\d{1,2})[/.](\\d{1,2})(?:[/.]${YEAR})?${SEP}(\\d{1,2})[/.](\\d{1,2})(?:[/.]${YEAR})?`, 'i'),
    read: (m, y) => ({ d1: +m[1], m1: +m[2], y1: toYear(m[3] || m[6], y), d2: +m[4], m2: +m[5], y2: toYear(m[6] || m[3], y) }),
  },
  // 15 ตุลาคม 2569 - 17 ตุลาคม 2569
  {
    re: new RegExp(`(\\d{1,2})\\s*${MONTH}\\s*${YEAR}?${SEP}(\\d{1,2})\\s*${MONTH}\\s*${YEAR}?`, 'i'),
    read: (m, y) => ({ d1: +m[1], m1: monthNumber(m[2]), y1: toYear(m[3] || m[6], y), d2: +m[4], m2: monthNumber(m[5]), y2: toYear(m[6] || m[3], y) }),
  },
  // 15-17 ตุลาคม 2569
  {
    re: new RegExp(`(\\d{1,2})${SEP}(\\d{1,2})\\s*${MONTH}\\s*${YEAR}?`, 'i'),
    read: (m, y) => ({ d1: +m[1], m1: monthNumber(m[3]), y1: toYear(m[4], y), d2: +m[2], m2: monthNumber(m[3]), y2: toYear(m[4], y) }),
  },
];

const validDay = (d, m) => m >= 1 && m <= 12 && d >= 1 && d <= 31;

/**
 * คืน { start, end } เป็นเวลา 00:00 ของวันแรกและวันสุดท้าย (ตาม timezone) หรือ null
 * นับเฉพาะช่วงที่วันสุดท้ายอยู่หลังวันแรก และยาวไม่เกิน 60 วัน
 */
const findDateRange = (text, { timezone, referenceYear }) => {
  const source = String(text || '').toLowerCase();
  for (const { re, read } of PATTERNS) {
    const match = re.exec(source);
    if (!match) continue;
    const r = read(match, referenceYear);
    if (!validDay(r.d1, r.m1) || !validDay(r.d2, r.m2)) continue;
    // ช่วงข้ามปีที่เขียนปีไว้ครั้งเดียว (30/12 - 2/1/2570): วันแรกอยู่ปีก่อนหน้า
    if (r.y1 === r.y2 && r.m1 > r.m2) r.y1 -= 1;
    const start = zonedToUtc({ year: r.y1, month: r.m1, day: r.d1 }, timezone);
    const end = zonedToUtc({ year: r.y2, month: r.m2, day: r.d2 }, timezone);
    const days = (end - start) / 86400000;
    if (days >= 1 && days <= 60) return { start, end };
  }
  return null;
};

module.exports = { findDateRange };
