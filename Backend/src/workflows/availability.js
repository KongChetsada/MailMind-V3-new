// ขั้น (C) ตรวจตารางว่างของรายการลงปฏิทิน — ใช้ทั้งตอนวิเคราะห์และตอนผู้ใช้แก้รายการ
const { checkAvailability, findAvailableSlots } = require('../core/scheduler');
const { occurrencesOf, repeatCount } = require('../core/occurrences');
const { normalizeTimeZone } = require('../core/time');

const DAY_MS = 24 * 60 * 60 * 1000;
const SLOT_SEARCH_DAYS = 14;

const isTimedEvent = (item) =>
  item.kind === 'EVENT' && !item.isAllDay && item.isTimeSpecified && item.startAt && item.endAt;

const toSlotJson = (slots) => slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() }));

/**
 * เติมผลตรวจตารางให้แต่ละรายการ
 * @param items     รายการที่มี { kind, startAt, endAt, isAllDay, isTimeSpecified }
 *                  และอาจมี relatedActionId (ผูกกับรายการเดิมในเธรด) กับ ignoreEventId
 * @param mode      'SUGGEST' | 'WARN' | 'NONE' (จากนโยบายของประเภทอีเมล)
 * @param calendar  ตัวเชื่อมปฏิทิน (อาจเป็น null)
 * คืนรายการเดิมพร้อม { availability, availabilityReason, suggestedSlots }
 * ถ้าโหลดปฏิทินไม่ได้ ทุกรายการเป็น NOT_CHECKED — ไม่ทำให้ขั้นตอนที่เรียกล้มเหลว
 *
 * รายการที่ผูกกับรายการเดิมแล้ว: เวลานั้นเป็นส่วนของกิจกรรมที่ตกลงกันไปแล้ว จึงตรวจเฉพาะการชน
 * (ไม่ตรวจวัน/เวลาทำงาน ไม่เสนอเวลาอื่น) และไม่นับกิจกรรมเดิมของตัวเองว่าชน
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
  const ends = events.map((i) => ((i.endAt || i.startAt)?.getTime() || 0) + (repeatCount(i) - 1) * DAY_MS).filter(Boolean);
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

    const linked = Boolean(item.relatedActionId);
    const itemMode = linked ? 'WARN' : mode;
    // ไม่นับกิจกรรมเดิมของตัวเอง (รวมทุกครั้งของกิจกรรมที่เกิดซ้ำ) ว่าชน
    const others = item.ignoreEventId
      ? calendarEvents.filter((e) => e.id !== item.ignoreEventId && e.recurringEventId !== item.ignoreEventId)
      : calendarEvents;

    if (!isTimedEvent(item)) {
      // ยังไม่มีเวลาที่ตรวจได้: สำหรับนัดหมายใหม่ เสนอเวลาว่างให้ผู้ใช้เลือกตอบ
      const slots =
        itemMode === 'SUGGEST' && !item.isAllDay
          ? findAvailableSlots({ from: item.startAt || now, events: others, settings, now })
          : [];
      return {
        ...blank(item, item.isAllDay || linked ? null : 'ผู้ส่งยังไม่ได้ระบุเวลาที่ชัดเจน'),
        suggestedSlots: slots.length ? toSlotJson(slots) : null,
      };
    }

    // กิจกรรมหลายวัน: ตรวจทุกวัน แล้วรายงานวันแรกที่มีปัญหา
    const occurrences = occurrencesOf(item, normalizeTimeZone(settings?.timezone));
    const checks = occurrences.map((o) => checkAvailability({ start: o.start, end: o.end, events: others, settings, mode: itemMode }));
    const result = checks.find((c) => c.availability !== 'AVAILABLE') || checks[0];
    let slots = [];
    // เสนอเวลาอื่นเฉพาะกิจกรรมครั้งเดียว (กิจกรรมหลายวันต้องตกลงกันใหม่ทั้งช่วง)
    if (itemMode === 'SUGGEST' && result.availability !== 'AVAILABLE' && occurrences.length === 1) {
      slots = findAvailableSlots({
        from: item.startAt,
        durationMinutes: Math.round((item.endAt - item.startAt) / 60000),
        events: others,
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
