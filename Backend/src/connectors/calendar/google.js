// ตัวเชื่อม Google Calendar
const crypto = require('crypto');
const { google } = require('googleapis');
const { authClientForAccount, withGoogleErrors } = require('../google/client');
const { zonedParts, addZonedDays, startOfZonedDay } = require('../../core/time');

const CALENDAR_ID = 'primary';
const pad = (n) => String(n).padStart(2, '0');
const dateOnly = (date, tz) => {
  const p = zonedParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

const toEvent = (item) => ({
  id: item.id,
  title: item.summary || '(ไม่มีชื่อกิจกรรม)',
  start: item.start?.dateTime || item.start?.date || null,
  end: item.end?.dateTime || item.end?.date || null,
  isAllDay: Boolean(item.start?.date && !item.start?.dateTime),
  location: item.location || '',
  htmlLink: item.htmlLink || '',
  // กิจกรรมที่เกิดซ้ำถูกแตกเป็นรายครั้ง แต่ละครั้งอ้างถึงกิจกรรมต้นทางด้วยรหัสนี้
  recurringEventId: item.recurringEventId || null,
});

/** กฎการเกิดซ้ำรายวัน: [] = ไม่ซ้ำ (ใช้ล้างกฎเดิมตอนแก้กิจกรรม) */
const dailyRecurrence = (repeatDays, isAllDay) =>
  !isAllDay && Number(repeatDays) > 1 ? [`RRULE:FREQ=DAILY;COUNT=${Math.floor(repeatDays)}`] : [];

/**
 * ช่วงเวลาในรูปแบบของ Google Calendar
 * clearOtherKind: ใช้ตอนแก้กิจกรรม — เมื่อเปลี่ยนชนิด (ทั้งวัน <-> มีเวลา) ต้องล้างฟิลด์ของอีกชนิดด้วย null
 */
const toEventTimes = ({ start, end, isAllDay, timezone, clearOtherKind = false }) => {
  const clear = (fields) => (clearOtherKind ? fields : {});
  if (isAllDay) {
    const firstDay = startOfZonedDay(new Date(start), timezone);
    const lastDay = end ? startOfZonedDay(new Date(end), timezone) : firstDay;
    return {
      start: { date: dateOnly(firstDay, timezone), ...clear({ dateTime: null, timeZone: null }) },
      end: { date: dateOnly(addZonedDays(lastDay, 1, timezone), timezone), ...clear({ dateTime: null, timeZone: null }) }, // วันสิ้นสุดแบบไม่รวม
    };
  }
  return {
    start: { dateTime: new Date(start).toISOString(), timeZone: timezone, ...clear({ date: null }) },
    end: { dateTime: new Date(end).toISOString(), timeZone: timezone, ...clear({ date: null }) },
  };
};

/**
 * รหัสกิจกรรมที่กำหนดเองจาก key ของระบบ: เรียกสร้างซ้ำด้วย key เดิมจะได้กิจกรรมเดิม ไม่เกิดรายการซ้ำ
 * Google กำหนดให้ใช้อักขระ a-v และ 0-9 — เลขฐานสิบหกอยู่ในช่วงนี้
 */
const eventIdFromKey = (key) => `mm${crypto.createHash('sha1').update(String(key)).digest('hex')}`;

const createGoogleCalendarConnector = (account) => {
  const calendar = google.calendar({ version: 'v3', auth: authClientForAccount(account) });

  return {
    provider: 'GOOGLE',

    /** กิจกรรมในช่วงเวลา: [{ id, title, start, end, isAllDay, location, htmlLink }] */
    async listEvents({ timeMin, timeMax }) {
      const events = [];
      let pageToken;
      do {
        const res = await withGoogleErrors(() =>
          calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: new Date(timeMin).toISOString(),
            timeMax: new Date(timeMax).toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 250,
            pageToken,
          })
        );
        for (const item of res.data.items || []) {
          if (item.status !== 'cancelled') events.push(toEvent(item));
        }
        pageToken = res.data.nextPageToken;
      } while (pageToken);
      return events;
    },

    /** แก้วันเวลา (และสถานที่ ถ้าระบุ) ของกิจกรรมที่มีอยู่ — ชื่อและรายละเอียดอื่นคงเดิม */
    async updateEvent({ eventId, start, end, isAllDay, location, timezone, repeatDays = 1 }) {
      const res = await withGoogleErrors(() =>
        calendar.events.patch({
          calendarId: CALENDAR_ID,
          eventId,
          sendUpdates: 'none',
          requestBody: {
            ...toEventTimes({ start, end, isAllDay, timezone, clearOtherKind: true }),
            ...(location ? { location } : {}),
            recurrence: dailyRecurrence(repeatDays, isAllDay),
          },
        })
      );
      return { id: res.data.id, htmlLink: res.data.htmlLink || '' };
    },

    /**
     * สร้างกิจกรรม — ส่ง idempotencyKey เดิมซ้ำได้โดยไม่เกิดกิจกรรมซ้ำ
     * คืน { id, htmlLink, alreadyExisted }
     */
    async createEvent({ idempotencyKey, title, start, end, isAllDay, location, description, timezone, attendeeEmail, repeatDays = 1 }) {
      const id = eventIdFromKey(idempotencyKey);
      const requestBody = {
        id,
        summary: title,
        location: location || '',
        description: description || '',
        ...toEventTimes({ start, end, isAllDay, timezone }),
      };
      if (attendeeEmail) requestBody.attendees = [{ email: attendeeEmail }];
      const recurrence = dailyRecurrence(repeatDays, isAllDay);
      if (recurrence.length) requestBody.recurrence = recurrence;

      try {
        const res = await withGoogleErrors(() =>
          calendar.events.insert({
            calendarId: CALENDAR_ID,
            sendUpdates: attendeeEmail ? 'all' : 'none',
            requestBody,
          })
        );
        return { id: res.data.id, htmlLink: res.data.htmlLink || '', alreadyExisted: false };
      } catch (error) {
        const status = error.code || error.status || error.response?.status;
        if (status !== 409) throw error;
        // รหัสนี้ถูกใช้แล้ว = คำขอก่อนหน้าสร้างสำเร็จไปแล้ว
        const existing = await withGoogleErrors(() => calendar.events.get({ calendarId: CALENDAR_ID, eventId: id }));
        return { id: existing.data.id, htmlLink: existing.data.htmlLink || '', alreadyExisted: true };
      }
    },
  };
};

module.exports = { createGoogleCalendarConnector, eventIdFromKey, toEventTimes, dailyRecurrence };
