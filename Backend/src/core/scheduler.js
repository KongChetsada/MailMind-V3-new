// ตัวตรวจตารางแบบกฎ (deterministic) — LLM ไม่มีส่วนตัดสินว่าว่างหรือไม่
// ฟังก์ชันในไฟล์นี้ไม่เรียกบริการภายนอก: รับกิจกรรมในปฏิทินเป็นข้อมูลเข้า
//
// รูปแบบกิจกรรม: { id, title, start: Date|ISO, end: Date|ISO, isAllDay }
// กิจกรรมทั้งวัน (isAllDay) ไม่นับว่าชน เพราะส่วนใหญ่เป็นวันหยุดหรือการแจ้งเตือน

const { normalizeTimeZone, zonedParts, zonedToUtc, startOfZonedDay, addZonedDays, THAI_DAYS } = require('./time');

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DEFAULT_WORK_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];

const parseTimeToMinutes = (timeStr, fallback) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || '').trim());
  if (!match) return fallback;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 24 * 60 ? minutes : fallback;
};

/** แปลงการตั้งค่าผู้ใช้เป็นค่าที่ใช้คำนวณ พร้อมค่าเริ่มต้นเมื่อข้อมูลไม่ครบ */
const resolveWorkingHours = (settings) => {
  const days = (settings?.workDays?.length ? settings.workDays : DEFAULT_WORK_DAYS)
    .map((d) => DAY_KEYS.indexOf(String(d).toLowerCase()))
    .filter((d) => d >= 0);
  const startMin = parseTimeToMinutes(settings?.startTime, 9 * 60);
  const endMin = parseTimeToMinutes(settings?.endTime, 17 * 60);
  return {
    timezone: normalizeTimeZone(settings?.timezone),
    workDays: days.length ? days : [1, 2, 3, 4, 5],
    startMin,
    endMin: endMin > startMin ? endMin : 17 * 60,
    startLabel: settings?.startTime || '09:00',
    endLabel: settings?.endTime || '17:00',
  };
};

const toBusyIntervals = (events) =>
  (events || [])
    .filter((e) => !e.isAllDay)
    .map((e) => ({ id: e.id, title: e.title, start: new Date(e.start), end: new Date(e.end) }))
    .filter((e) => !isNaN(e.start) && !isNaN(e.end) && e.end > e.start);

const findConflict = (start, end, busy) => busy.find((e) => start < e.end && end > e.start) || null;

/**
 * ตรวจว่าช่วงเวลาที่ขอใช้ได้หรือไม่
 * mode 'SUGGEST' ตรวจวันทำงาน เวลาทำงาน และการชน · mode 'WARN' ตรวจเฉพาะการชน
 * คืน { availability, reason, conflict }
 */
const checkAvailability = ({ start, end, events, settings, mode = 'SUGGEST' }) => {
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s) || isNaN(e) || e <= s) {
    return { availability: 'NOT_CHECKED', reason: 'วันเวลาไม่ครบหรือไม่ถูกต้อง', conflict: null };
  }

  const wh = resolveWorkingHours(settings);

  if (mode === 'SUGGEST') {
    const sp = zonedParts(s, wh.timezone);
    if (!wh.workDays.includes(sp.weekday)) {
      return {
        availability: 'OUT_OF_WORK_DAYS',
        reason: `ตรงกับ${THAI_DAYS[sp.weekday]} ซึ่งไม่ใช่วันทำงาน`,
        conflict: null,
      };
    }
    const startMin = sp.hour * 60 + sp.minute;
    const endMin = startMin + Math.round((e - s) / 60000);
    if (startMin < wh.startMin || endMin > wh.endMin) {
      return {
        availability: 'OUT_OF_WORKING_HOURS',
        reason: `อยู่นอกเวลาทำงาน (${wh.startLabel} - ${wh.endLabel} น.)`,
        conflict: null,
      };
    }
  }

  const hit = findConflict(s, e, toBusyIntervals(events));
  if (hit) {
    return {
      availability: 'CONFLICT',
      reason: `ชนกับกิจกรรม “${hit.title || 'ไม่มีชื่อ'}” ในปฏิทิน`,
      conflict: { id: hit.id, title: hit.title || null, start: hit.start.toISOString(), end: hit.end.toISOString() },
    };
  }

  return { availability: 'AVAILABLE', reason: 'ไม่มีกิจกรรมซ้อนทับ', conflict: null };
};

/**
 * หาช่วงเวลาว่างในเวลาทำงาน เริ่มจากวันที่กำหนด ทีละชั่วโมง
 * คืน [{ start: Date, end: Date }]
 */
const findAvailableSlots = ({
  from,
  durationMinutes = 60,
  events,
  settings,
  now = new Date(),
  maxSlots = 3,
  searchDays = 14,
  minLeadMinutes = 120,
}) => {
  const wh = resolveWorkingHours(settings);
  const duration = durationMinutes > 0 ? durationMinutes : 60;
  const busy = toBusyIntervals(events);
  const base = from && new Date(from) > now ? new Date(from) : now;
  const earliest = now.getTime() + minLeadMinutes * 60000;
  const firstDay = startOfZonedDay(base, wh.timezone);
  const slots = [];

  for (let offset = 0; offset < searchDays && slots.length < maxSlots; offset++) {
    const day = addZonedDays(firstDay, offset, wh.timezone);
    const dp = zonedParts(day, wh.timezone);
    if (!wh.workDays.includes(dp.weekday)) continue;

    for (let m = wh.startMin; m + duration <= wh.endMin && slots.length < maxSlots; m += 60) {
      const start = zonedToUtc(
        { year: dp.year, month: dp.month, day: dp.day, hour: Math.floor(m / 60), minute: m % 60 },
        wh.timezone
      );
      const end = new Date(start.getTime() + duration * 60000);
      if (start.getTime() <= earliest) continue;
      if (!findConflict(start, end, busy)) slots.push({ start, end });
    }
  }
  return slots;
};

module.exports = { checkAvailability, findAvailableSlots, resolveWorkingHours, parseTimeToMinutes };
