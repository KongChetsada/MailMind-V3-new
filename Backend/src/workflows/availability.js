// ขั้น (C) ตรวจตารางว่างของรายการลงปฏิทิน — ใช้ทั้งตอนวิเคราะห์และตอนผู้ใช้แก้รายการ
const { checkAvailability, findAvailableSlots } = require('../core/scheduler');

const DAY_MS = 24 * 60 * 60 * 1000;
const SLOT_SEARCH_DAYS = 14;

const isTimedEvent = (item) =>
  item.kind === 'EVENT' && !item.isAllDay && item.isTimeSpecified && item.startAt && item.endAt;

const toSlotJson = (slots) => slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() }));

/**
 * เติมผลตรวจตารางให้แต่ละรายการ
 * @param items     รายการที่มี { kind, startAt, endAt, isAllDay, isTimeSpecified }
 * @param mode      'SUGGEST' | 'WARN' | 'NONE' (จากนโยบายของประเภทอีเมล)
 * @param calendar  ตัวเชื่อมปฏิทิน (อาจเป็น null)
 * คืนรายการเดิมพร้อม { availability, availabilityReason, suggestedSlots }
 * ถ้าโหลดปฏิทินไม่ได้ ทุกรายการเป็น NOT_CHECKED — ไม่ทำให้ขั้นตอนที่เรียกล้มเหลว
 */
const evaluateAvailability = async ({ items, mode, calendar, settings, now, logger }) => {
  const blank = (item, reason = null) => ({
    ...item,
    availability: 'NOT_CHECKED',
    availabilityReason: reason,
    suggestedSlots: null,
  });

  const events = items.filter((i) => i.kind === 'EVENT');
  if (mode === 'NONE' || !calendar || events.length === 0) return items.map((i) => blank(i));

  const starts = events.map((i) => i.startAt?.getTime()).filter(Boolean);
  const ends = events.map((i) => (i.endAt || i.startAt)?.getTime()).filter(Boolean);
  const timeMin = new Date(Math.min(now.getTime(), ...starts) - DAY_MS);
  const timeMax = new Date(Math.max(now.getTime(), ...ends) + (SLOT_SEARCH_DAYS + 1) * DAY_MS);

  let calendarEvents;
  try {
    calendarEvents = await calendar.listEvents({ timeMin, timeMax });
  } catch (error) {
    logger?.warn('CALENDAR_UNAVAILABLE', 'Skipped availability check because calendar could not be loaded', {
      error: error.message,
    });
    if (error.code === 'REAUTH_REQUIRED') throw error;
    return items.map((i) => blank(i, 'ตรวจปฏิทินไม่ได้ในขณะนี้'));
  }

  return items.map((item) => {
    if (item.kind !== 'EVENT') return blank(item);

    if (!isTimedEvent(item)) {
      // ยังไม่มีเวลาที่ตรวจได้: สำหรับนัดหมาย เสนอเวลาว่างให้ผู้ใช้เลือกตอบ
      const slots =
        mode === 'SUGGEST' && !item.isAllDay
          ? findAvailableSlots({ from: item.startAt || now, events: calendarEvents, settings, now })
          : [];
      return {
        ...blank(item, item.isAllDay ? null : 'ผู้ส่งยังไม่ได้ระบุเวลาที่ชัดเจน'),
        suggestedSlots: slots.length ? toSlotJson(slots) : null,
      };
    }

    const result = checkAvailability({ start: item.startAt, end: item.endAt, events: calendarEvents, settings, mode });
    let slots = [];
    if (mode === 'SUGGEST' && result.availability !== 'AVAILABLE') {
      slots = findAvailableSlots({
        from: item.startAt,
        durationMinutes: Math.round((item.endAt - item.startAt) / 60000),
        events: calendarEvents,
        settings,
        now,
      });
    }
    return {
      ...item,
      availability: result.availability,
      availabilityReason: result.reason,
      suggestedSlots: slots.length ? toSlotJson(slots) : null,
    };
  });
};

module.exports = { evaluateAvailability, isTimedEvent };
