// ช่วงเวลาของกิจกรรมสำหรับหน้าปฏิทิน: กิจกรรมหลายวันต้องแสดงในทุกวันที่ครอบคลุม ไม่ใช่แค่วันเริ่ม

export interface DaySpan {
  /** เวลาเริ่ม (รวม) */
  start: Date;
  /** เวลาสิ้นสุด (ไม่รวม) */
  end: Date;
  isAllDay: boolean;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

/** "2026-10-19" → เที่ยงคืนของวันนั้นตามเวลาเครื่อง (new Date("2026-10-19") จะได้เที่ยงคืน UTC ซึ่งเลื่อนวันได้) */
const localDate = (value: string) => {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const nextDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

/**
 * แปลงกิจกรรมเป็นช่วงเวลา
 * - กิจกรรมทั้งวันจาก Google มาเป็นวันที่ล้วน และวันสิ้นสุดเป็นแบบ "ไม่รวม" (19–20 ต.ค. = start 19, end 21)
 * - กิจกรรมทั้งวันจากระบบเรา (รายการที่รอยืนยัน) มาเป็นเวลา และวันสิ้นสุดเป็นแบบ "รวม" (end = วันสุดท้าย)
 */
export const toSpan = (input: { start: string | null; end: string | null; isAllDay: boolean }): DaySpan | null => {
  if (!input.start) return null;

  if (input.isAllDay) {
    if (DATE_ONLY.test(input.start)) {
      const start = localDate(input.start);
      const end = input.end && DATE_ONLY.test(input.end) ? localDate(input.end) : nextDay(start);
      return { start, end: end > start ? end : nextDay(start), isAllDay: true };
    }
    const start = startOfDay(new Date(input.start));
    const last = input.end ? startOfDay(new Date(input.end)) : start;
    return { start, end: nextDay(last >= start ? last : start), isAllDay: true };
  }

  const start = new Date(input.start);
  const end = input.end ? new Date(input.end) : start;
  return { start, end: end > start ? end : new Date(start.getTime() + 1), isAllDay: false };
};

/** กิจกรรมครอบคลุมวันนั้นหรือไม่ */
export const coversDay = (span: DaySpan | null, day: Date) => {
  if (!span) return false;
  const dayStart = startOfDay(day);
  return span.start < nextDay(dayStart) && span.end > dayStart;
};

/** จำนวนวันที่กิจกรรมครอบคลุม */
export const spanDays = (span: DaySpan) =>
  Math.max(1, Math.round((startOfDay(new Date(span.end.getTime() - 1)).getTime() - startOfDay(span.start).getTime()) / DAY_MS) + 1);

const shortDate = (d: Date) => d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
const clock = (d: Date) => d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false });

/** ข้อความช่วงเวลา เช่น "ทั้งวัน", "19 ต.ค. – 20 ต.ค. (ทั้งวัน)", "14:00 – 15:00 น.", "19 ต.ค. 22:00 – 20 ต.ค. 02:00 น." */
export const formatSpan = (span: DaySpan) => {
  const last = new Date(span.end.getTime() - 1);
  const multiDay = spanDays(span) > 1;
  if (span.isAllDay) return multiDay ? `${shortDate(span.start)} – ${shortDate(last)} (ทั้งวัน)` : "ทั้งวัน";
  return multiDay
    ? `${shortDate(span.start)} ${clock(span.start)} – ${shortDate(span.end)} ${clock(span.end)} น.`
    : `${clock(span.start)} – ${clock(span.end)} น.`;
};

/** ช่วงเวลาทั้งหมดของรายการที่เกิดทุกวันในช่วงเวลาเดิม (repeatDays วันติดกัน) */
export const toSpans = (input: { start: string | null; end: string | null; isAllDay: boolean; repeatDays?: number }): DaySpan[] => {
  const first = toSpan(input);
  if (!first) return [];
  const days = first.isAllDay ? 1 : Math.max(1, input.repeatDays || 1);
  const shift = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
  return Array.from({ length: days }, (_unused, i) => ({ ...first, start: shift(first.start, i), end: shift(first.end, i) }));
};
