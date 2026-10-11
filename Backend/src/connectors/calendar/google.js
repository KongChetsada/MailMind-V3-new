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
});

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

    /**
     * สร้างกิจกรรม — ส่ง idempotencyKey เดิมซ้ำได้โดยไม่เกิดกิจกรรมซ้ำ
     * คืน { id, htmlLink, alreadyExisted }
     */
    async createEvent({ idempotencyKey, title, start, end, isAllDay, location, description, timezone, attendeeEmail }) {
      const id = eventIdFromKey(idempotencyKey);
      const requestBody = { id, summary: title, location: location || '', description: description || '' };

      if (isAllDay) {
        const firstDay = startOfZonedDay(new Date(start), timezone);
        const lastDay = end ? startOfZonedDay(new Date(end), timezone) : firstDay;
        requestBody.start = { date: dateOnly(firstDay, timezone) };
        requestBody.end = { date: dateOnly(addZonedDays(lastDay, 1, timezone), timezone) }; // วันสิ้นสุดแบบไม่รวม
      } else {
        requestBody.start = { dateTime: new Date(start).toISOString(), timeZone: timezone };
        requestBody.end = { dateTime: new Date(end).toISOString(), timeZone: timezone };
      }
      if (attendeeEmail) requestBody.attendees = [{ email: attendeeEmail }];

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

module.exports = { createGoogleCalendarConnector, eventIdFromKey };
