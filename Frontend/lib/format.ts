// จัดรูปแบบวันเวลาเป็นภาษาไทย (ตาม timezone ของเบราว์เซอร์)

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const time = (d: Date) => d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false });
const longDate = (d: Date) => d.toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** เวลาในรายการอีเมล: วันนี้แสดงเวลา วันอื่นแสดงวันที่ */
export const formatListTime = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return time(d);
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "2-digit" } : {}) });
};

export const formatDateTime = (iso: string | null) => (iso ? `${longDate(new Date(iso))} ${time(new Date(iso))} น.` : "");

/** ช่วงเวลาของรายการลงปฏิทิน */
export const formatWhen = (item: { startAt: string | null; endAt: string | null; isAllDay: boolean; isTimeSpecified: boolean }) => {
  if (!item.startAt) return "ยังไม่ระบุวันที่";
  const start = new Date(item.startAt);
  if (item.isAllDay || !item.isTimeSpecified) {
    const end = item.endAt ? new Date(item.endAt) : null;
    const range = end && !sameDay(start, end) ? ` – ${longDate(end)}` : "";
    return `${longDate(start)}${range}${item.isAllDay ? " (ทั้งวัน)" : ""}`;
  }
  if (!item.endAt) return `${longDate(start)} ${time(start)} น.`;
  const end = new Date(item.endAt);
  return sameDay(start, end)
    ? `${longDate(start)} ${time(start)} – ${time(end)} น.`
    : `${longDate(start)} ${time(start)} น. – ${longDate(end)} ${time(end)} น.`;
};

export const formatSlot = (slot: { start: string; end: string }) =>
  `${longDate(new Date(slot.start))} ${time(new Date(slot.start))} – ${time(new Date(slot.end))} น.`;

export const formatDuration = (minutes: number | null) => {
  if (minutes === null) return "–";
  if (minutes < 60) return `${minutes} นาที`;
  if (minutes < 48 * 60) return `${(minutes / 60).toFixed(1)} ชม.`;
  return `${(minutes / 1440).toFixed(1)} วัน`;
};

export const formatPercent = (ratio: number | null) => (ratio === null ? "–" : `${(ratio * 100).toFixed(0)}%`);

const pad = (n: number) => String(n).padStart(2, "0");

/** ค่าสำหรับ <input type="date"> และ <input type="time"> */
export const toDateInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const toTimeInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromInputs = (date: string, timeValue = "00:00") => {
  if (!date) return null;
  const d = new Date(`${date}T${timeValue || "00:00"}:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
};
