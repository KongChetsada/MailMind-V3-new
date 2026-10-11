// เลือกตัวเชื่อมปฏิทินตามผู้ให้บริการของบัญชี
//
// สัญญาของตัวเชื่อมปฏิทิน:
//   listEvents({ timeMin, timeMax }) -> [{ id, title, start, end, isAllDay, location, htmlLink }]
//   createEvent({ idempotencyKey, title, start, end, isAllDay, location, description,
//                 timezone, attendeeEmail }) -> { id, htmlLink, alreadyExisted }
const { createGoogleCalendarConnector } = require('./google');
const { env } = require('../../config/env');
const { isDemoAccount, demoCalendar } = require('../demo');

const FACTORIES = {
  GOOGLE: createGoogleCalendarConnector,
  // MICROSOFT: createOutlookCalendarConnector,  (รอบสอง)
};

const getCalendarConnector = (account) => {
  if (env.demoMode && isDemoAccount(account)) return demoCalendar;
  const factory = FACTORIES[account?.provider];
  if (!factory) throw new Error(`ยังไม่รองรับปฏิทินของผู้ให้บริการ: ${account?.provider}`);
  return factory(account);
};

module.exports = { getCalendarConnector };
