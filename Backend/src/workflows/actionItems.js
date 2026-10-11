// ขั้น (D2) รายการลงปฏิทิน: แก้ไข ยืนยัน (สร้างกิจกรรม) และไม่สนใจ
const { Prisma } = require('@prisma/client');
const { getDeps } = require('./deps');
const { badRequest, conflict, notFound, HttpError } = require('../utils/httpError');
const { getCategoryPolicy, effectiveCategory } = require('../core/categories');
const { normalizeTimeZone } = require('../core/time');
const { checkAvailability } = require('../core/scheduler');
const { evaluateAvailability, isTimedEvent } = require('./availability');

const EDITABLE = ['SUGGESTED', 'FAILED'];
const DEADLINE_BLOCK_MINUTES = 30;
const BLOCKED_MESSAGES = {
  CREATING: 'รายการนี้กำลังถูกบันทึกลงปฏิทิน',
  CREATED: 'รายการนี้อยู่ในปฏิทินแล้ว',
  DISMISSED: 'รายการนี้ถูกปิดไปแล้ว',
};

const findOwnedItem = async (prisma, userId, actionId) => {
  const item = await prisma.actionItem.findFirst({
    where: { id: actionId, email: { mailAccount: { userId } } },
    include: { email: { include: { mailAccount: { include: { user: { include: { setting: true } } } } } } },
  });
  if (!item) throw notFound('ไม่พบรายการนี้');
  return item;
};

/** ฟิลด์ที่ยังขาดหลังผู้ใช้แก้ไข ('evidence' คงไว้เสมอถ้าเคยยืนยันหลักฐานไม่ได้) */
const recomputeMissing = (item) => {
  const missing = [];
  if (!item.startAt) missing.push('start');
  else if (item.kind === 'EVENT' && !item.isAllDay && !item.isTimeSpecified) missing.push('time');
  if (item.missingFields?.includes('evidence')) missing.push('evidence');
  return missing;
};

/**
 * แก้รายละเอียดของรายการ แล้วตรวจตารางใหม่
 * @param patch { title?, startAt?, endAt?, isAllDay?, location? } — วันเวลาเป็น ISO string หรือ null
 */
const updateActionItem = async (userId, actionId, patch, deps = getDeps()) => {
  const { prisma, getCalendar, now } = deps;
  const item = await findOwnedItem(prisma, userId, actionId);
  if (!EDITABLE.includes(item.status)) {
    throw conflict('ACTION_NOT_EDITABLE', BLOCKED_MESSAGES[item.status] || 'รายการนี้แก้ไม่ได้');
  }

  const parseDate = (value, label) => {
    if (value === null) return null;
    const d = new Date(value);
    if (isNaN(d)) throw badRequest(`${label}ไม่ถูกต้อง`);
    return d;
  };

  const next = { ...item };
  if (patch.title !== undefined) next.title = String(patch.title).trim().slice(0, 200) || item.title;
  if (patch.location !== undefined) next.location = patch.location ? String(patch.location).trim().slice(0, 300) : null;
  if (patch.isAllDay !== undefined) next.isAllDay = Boolean(patch.isAllDay);
  if (patch.startAt !== undefined) next.startAt = parseDate(patch.startAt, 'เวลาเริ่ม');
  if (patch.endAt !== undefined) next.endAt = parseDate(patch.endAt, 'เวลาสิ้นสุด');

  if (next.kind === 'DEADLINE') next.endAt = null;
  // ผู้ใช้กรอกเวลาเองถือว่าระบุเวลาแล้ว
  if (patch.startAt !== undefined || patch.isAllDay !== undefined) {
    next.isTimeSpecified = Boolean(next.startAt) && !next.isAllDay;
  }
  if (next.kind === 'EVENT' && !next.isAllDay && next.startAt) {
    if (!next.endAt) next.endAt = new Date(next.startAt.getTime() + 60 * 60000);
    if (next.endAt <= next.startAt) throw badRequest('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม');
  }
  if (next.isAllDay && next.endAt && next.startAt && next.endAt < next.startAt) {
    throw badRequest('วันสิ้นสุดต้องไม่อยู่ก่อนวันเริ่ม');
  }
  next.missingFields = recomputeMissing(next);

  const account = item.email.mailAccount;
  const policy = getCategoryPolicy(effectiveCategory(item.email));
  let calendar = null;
  try {
    if (policy.calendarMode !== 'NONE' && next.kind === 'EVENT') calendar = getCalendar(account);
  } catch {
    calendar = null;
  }
  const [evaluated] = await evaluateAvailability({
    items: [next],
    mode: policy.calendarMode,
    calendar,
    settings: account.user.setting || {},
    now: now(),
    logger: deps.logger,
  });

  return prisma.actionItem.update({
    where: { id: actionId },
    data: {
      title: next.title,
      location: next.location,
      startAt: next.startAt,
      endAt: next.endAt,
      isAllDay: next.isAllDay,
      isTimeSpecified: next.isTimeSpecified,
      missingFields: next.missingFields,
      availability: evaluated.availability,
      availabilityReason: evaluated.availabilityReason,
      suggestedSlots: evaluated.suggestedSlots ?? Prisma.DbNull,
      status: 'SUGGESTED',
      errorMessage: null,
    },
  });
};

/** ช่วงเวลาของกิจกรรมที่จะสร้างจากรายการ */
const toEventWindow = (item) => {
  if (item.isAllDay) return { start: item.startAt, end: item.endAt || item.startAt, isAllDay: true };
  if (item.kind === 'DEADLINE') {
    return { start: item.startAt, end: new Date(item.startAt.getTime() + DEADLINE_BLOCK_MINUTES * 60000), isAllDay: false };
  }
  return { start: item.startAt, end: item.endAt, isAllDay: false };
};

/**
 * ยืนยันลงปฏิทิน — กดซ้ำหรือเรียกซ้อนกันจะไม่เกิดกิจกรรมซ้ำ
 * @param options.force         ลงทับแม้ชนกับกิจกรรมอื่น
 * @param options.inviteSender  เพิ่มผู้ส่งอีเมลเป็นผู้เข้าร่วม (Google จะส่งคำเชิญให้)
 * ถ้าชนและไม่ได้ force → 409 CALENDAR_CONFLICT และรายการกลับเป็น SUGGESTED
 */
const confirmActionItem = async (userId, actionId, options = {}, deps = getDeps()) => {
  const { prisma, getCalendar, now } = deps;
  const logger = deps.logger.child({ actionId }, 'CONFIRM');
  const item = await findOwnedItem(prisma, userId, actionId);

  if (!item.startAt) throw badRequest('กรุณาระบุวันที่ก่อนยืนยัน');
  if (item.kind === 'EVENT' && !item.isAllDay && !(item.isTimeSpecified && item.endAt)) {
    throw badRequest('กรุณาระบุเวลาเริ่มและสิ้นสุด หรือเลือกเป็นกิจกรรมทั้งวัน');
  }

  const lock = await prisma.actionItem.updateMany({
    where: { id: actionId, status: { in: EDITABLE } },
    data: { status: 'CREATING', errorMessage: null },
  });
  if (lock.count === 0) {
    const current = await prisma.actionItem.findUnique({ where: { id: actionId } });
    throw conflict('ACTION_NOT_CONFIRMABLE', BLOCKED_MESSAGES[current?.status] || 'รายการนี้ยืนยันไม่ได้');
  }

  const { email } = item;
  const account = email.mailAccount;
  const settings = account.user.setting || {};
  const timezone = normalizeTimeZone(settings.timezone);
  const window = toEventWindow(item);

  try {
    const calendar = getCalendar(account);

    // ปฏิทินอาจเปลี่ยนไปตั้งแต่ตอนวิเคราะห์ จึงตรวจการชนอีกครั้งก่อนสร้างจริง
    if (isTimedEvent(item) && !options.force) {
      const events = await calendar.listEvents({
        timeMin: new Date(window.start.getTime() - 60 * 60000),
        timeMax: new Date(window.end.getTime() + 60 * 60000),
      });
      const check = checkAvailability({ start: window.start, end: window.end, events, settings, mode: 'WARN' });
      if (check.availability === 'CONFLICT') {
        await prisma.actionItem.update({
          where: { id: actionId },
          data: { status: 'SUGGESTED', availability: 'CONFLICT', availabilityReason: check.reason },
        });
        throw conflict('CALENDAR_CONFLICT', check.reason, { conflict: check.conflict });
      }
    }

    const created = await calendar.createEvent({
      idempotencyKey: item.id,
      title: item.kind === 'DEADLINE' ? `[กำหนดส่ง] ${item.title}` : item.title,
      start: window.start,
      end: window.end,
      isAllDay: window.isAllDay,
      location: item.location,
      description: `สร้างโดย MailMind จากอีเมล: ${email.subject || '(ไม่มีหัวข้อ)'}\nผู้ส่ง: ${email.fromAddress || '-'}`,
      timezone,
      attendeeEmail: options.inviteSender ? email.fromAddress : null,
    });

    const updated = await prisma.actionItem.update({
      where: { id: actionId },
      data: {
        status: 'CREATED',
        externalEventId: created.id,
        externalLink: created.htmlLink || null,
        createdEventAt: now(),
        errorMessage: null,
      },
    });
    logger.info('CONFIRM_END', 'Calendar event created', { eventId: created.id, alreadyExisted: created.alreadyExisted });
    return updated;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const message = String(error.message || error).slice(0, 300);
    await prisma.actionItem.update({ where: { id: actionId }, data: { status: 'FAILED', errorMessage: message } });
    if (error.code === 'REAUTH_REQUIRED') {
      await prisma.mailAccount.update({ where: { id: account.id }, data: { status: 'NEEDS_REAUTH' } });
      throw new HttpError(401, 'REAUTH_REQUIRED', error.message);
    }
    logger.error('CONFIRM_ERROR', 'Calendar event could not be created', error);
    throw new HttpError(502, 'CALENDAR_FAILED', `บันทึกลงปฏิทินไม่สำเร็จ: ${message}`);
  }
};

const dismissActionItem = async (userId, actionId, deps = getDeps()) => {
  const { prisma } = deps;
  await findOwnedItem(prisma, userId, actionId);
  const result = await prisma.actionItem.updateMany({
    where: { id: actionId, status: { in: EDITABLE } },
    data: { status: 'DISMISSED' },
  });
  if (result.count === 0) throw conflict('ACTION_NOT_EDITABLE', 'รายการนี้อยู่ในปฏิทินแล้วหรือกำลังบันทึกอยู่');
  return prisma.actionItem.findUnique({ where: { id: actionId } });
};

module.exports = { updateActionItem, confirmActionItem, dismissActionItem, toEventWindow };
