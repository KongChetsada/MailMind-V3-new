// ขั้น (D2) รายการลงปฏิทิน: แก้ไข ยืนยัน (สร้างกิจกรรมใหม่ หรือแก้กิจกรรมเดิมในเธรด) และไม่สนใจ
const { Prisma } = require('@prisma/client');
const { getDeps } = require('./deps');
const { badRequest, conflict, notFound, HttpError } = require('../utils/httpError');
const { getCategoryPolicy, effectiveCategory } = require('../core/categories');
const { normalizeTimeZone } = require('../core/time');
const { checkAvailability } = require('../core/scheduler');
const { evaluateAvailability, isTimedEvent } = require('./availability');
const { MAX_REPEAT_DAYS, occurrencesOf, repeatCount } = require('../core/occurrences');

const EDITABLE = ['SUGGESTED', 'FAILED'];
const DEADLINE_BLOCK_MINUTES = 30;
const BLOCKED_MESSAGES = {
  CREATING: 'รายการนี้กำลังถูกบันทึกลงปฏิทิน',
  CREATED: 'รายการนี้อยู่ในปฏิทินแล้ว',
  DISMISSED: 'รายการนี้ถูกปิดไปแล้ว',
  MERGED: 'รายการนี้ถูกรวมเข้ากับกิจกรรมเดิมแล้ว',
};

const ITEM_INCLUDE = {
  relatedAction: true,
  email: { include: { mailAccount: { include: { user: { include: { setting: true } } } } } },
};

const findOwnedItem = async (prisma, userId, actionId) => {
  const item = await prisma.actionItem.findFirst({
    where: { id: actionId, email: { mailAccount: { userId } } },
    include: ITEM_INCLUDE,
  });
  if (!item) throw notFound('ไม่พบรายการนี้');
  return item;
};

/** รายการพร้อมรายการเดิมที่ผูกไว้ — รูปแบบที่ส่งกลับให้หน้าเว็บ */
const reload = (prisma, actionId) =>
  prisma.actionItem.findUnique({ where: { id: actionId }, include: { relatedAction: true } });

/** ฟิลด์ที่ยังขาดหลังผู้ใช้แก้ไข ('evidence' คงไว้เสมอถ้าเคยยืนยันหลักฐานไม่ได้) */
const recomputeMissing = (item) => {
  const missing = [];
  if (!item.startAt) missing.push('start');
  else if (item.kind === 'EVENT' && !item.isAllDay && !item.isTimeSpecified) missing.push('time');
  // 'date' (วันที่ที่ระบบอนุมานจากกิจกรรมเดิม) หายไปเมื่อผู้ใช้แก้รายการเอง
  if (item.missingFields?.includes('evidence')) missing.push('evidence');
  return missing;
};

/** กิจกรรมในปฏิทินของรายการเดิมที่ผูกไว้ — ไม่นับว่าชนกับรายการนี้ */
const relatedEventId = (item) => item.relatedAction?.externalEventId || null;

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
  if (patch.repeatDays !== undefined) next.repeatDays = patch.repeatDays;

  if (next.kind === 'DEADLINE') next.endAt = null;
  // ผู้ใช้กรอกเวลาเองถือว่าระบุเวลาแล้ว
  if (patch.startAt !== undefined || patch.isAllDay !== undefined) {
    next.isTimeSpecified = Boolean(next.startAt) && !next.isAllDay;
  }
  if (next.kind === 'EVENT' && !next.isAllDay && next.startAt) {
    if (!next.endAt) next.endAt = new Date(next.startAt.getTime() + 60 * 60000);
    if (next.endAt <= next.startAt) throw badRequest('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม');
  }
  // เกิดซ้ำรายวันได้เฉพาะกิจกรรมที่มีเวลา และช่วงเวลาของแต่ละวันต้องจบภายในวันนั้น
  if (next.kind !== 'EVENT' || next.isAllDay || !next.startAt || !next.endAt) next.repeatDays = 1;
  if (next.repeatDays > 1) {
    if (next.repeatDays > MAX_REPEAT_DAYS) throw badRequest(`กิจกรรมหลายวันยาวได้ไม่เกิน ${MAX_REPEAT_DAYS} วัน`);
    if (next.endAt - next.startAt >= 24 * 60 * 60000) throw badRequest('กิจกรรมที่เกิดทุกวัน เวลาเริ่มและสิ้นสุดต้องอยู่ในวันเดียวกัน');
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
    items: [{ ...next, ignoreEventId: relatedEventId(item) }],
    mode: policy.calendarMode,
    calendar,
    settings: account.user.setting || {},
    now: now(),
    logger: deps.logger,
  });

  await prisma.actionItem.update({
    where: { id: actionId },
    data: {
      title: next.title,
      location: next.location,
      startAt: next.startAt,
      endAt: next.endAt,
      isAllDay: next.isAllDay,
      isTimeSpecified: next.isTimeSpecified,
      repeatDays: next.repeatDays || 1,
      missingFields: next.missingFields,
      availability: evaluated.availability,
      availabilityReason: evaluated.availabilityReason,
      suggestedSlots: evaluated.suggestedSlots ?? Prisma.DbNull,
      status: 'SUGGESTED',
      errorMessage: null,
    },
  });
  return reload(prisma, actionId);
};

/** ช่วงเวลาของกิจกรรมที่จะสร้างจากรายการ */
const toEventWindow = (item) => {
  if (item.isAllDay) return { start: item.startAt, end: item.endAt || item.startAt, isAllDay: true };
  if (item.kind === 'DEADLINE') {
    return { start: item.startAt, end: new Date(item.startAt.getTime() + DEADLINE_BLOCK_MINUTES * 60000), isAllDay: false };
  }
  return { start: item.startAt, end: item.endAt, isAllDay: false };
};

/** สร้างกิจกรรมใหม่จากรายการนี้ */
const createAsNewEvent = async ({ item, window, timezone, calendar, options, prisma, now }) => {
  const { email } = item;
  const created = await calendar.createEvent({
    idempotencyKey: item.id,
    title: item.kind === 'DEADLINE' ? `[กำหนดส่ง] ${item.title}` : item.title,
    start: window.start,
    end: window.end,
    isAllDay: window.isAllDay,
    location: item.location,
    repeatDays: repeatCount(item),
    description: `สร้างโดย MailMind จากอีเมล: ${email.subject || '(ไม่มีหัวข้อ)'}\nผู้ส่ง: ${email.fromAddress || '-'}`,
    timezone,
    attendeeEmail: options.inviteSender ? email.fromAddress : null,
  });
  await prisma.actionItem.update({
    where: { id: item.id },
    data: {
      status: 'CREATED',
      externalEventId: created.id,
      externalLink: created.htmlLink || null,
      createdEventAt: now(),
      errorMessage: null,
    },
  });
  return { eventId: created.id, alreadyExisted: created.alreadyExisted };
};

/**
 * ย้ายวันเวลาของรายการนี้ไปใส่รายการเดิมที่ผูกไว้ แล้วปิดรายการนี้เป็น MERGED
 * - รายการเดิมอยู่ในปฏิทินแล้ว → แก้กิจกรรมในปฏิทินด้วย
 * - รายการเดิมยังรอยืนยัน → แก้เฉพาะข้อมูลในระบบ ผู้ใช้ยืนยันรายการเดิมทีหลัง
 * ชื่อกิจกรรมเดิมคงไว้ สถานที่เปลี่ยนเฉพาะเมื่อรายการใหม่ระบุ
 */
const mergeIntoRelated = async ({ item, window, timezone, calendar, prisma }) => {
  const related = item.relatedAction;
  if (related.status === 'CREATED' && related.externalEventId) {
    await calendar.updateEvent({
      eventId: related.externalEventId,
      start: window.start,
      end: window.end,
      isAllDay: window.isAllDay,
      location: item.location,
      timezone,
      repeatDays: repeatCount(item),
    });
  }
  const moved = { ...related, startAt: item.startAt, isAllDay: item.isAllDay, isTimeSpecified: item.isTimeSpecified };
  await prisma.$transaction([
    prisma.actionItem.update({
      where: { id: related.id },
      data: {
        startAt: item.startAt,
        endAt: item.endAt,
        isAllDay: item.isAllDay,
        isTimeSpecified: item.isTimeSpecified,
        repeatDays: repeatCount(item),
        ...(item.location ? { location: item.location } : {}),
        missingFields: recomputeMissing(moved),
        availability: item.availability,
        availabilityReason: item.availabilityReason,
        suggestedSlots: Prisma.DbNull,
      },
    }),
    prisma.actionItem.update({ where: { id: item.id }, data: { status: 'MERGED', errorMessage: null } }),
  ]);
  return { eventId: related.externalEventId, updatedCalendar: related.status === 'CREATED' };
};

/**
 * ยืนยันรายการ — กดซ้ำหรือเรียกซ้อนกันจะไม่เกิดกิจกรรมซ้ำ
 * @param options.mode          'CREATE' (ค่าเริ่มต้น) สร้างกิจกรรมใหม่ · 'UPDATE_RELATED' แก้กิจกรรมเดิมที่ผูกไว้
 * @param options.force         บันทึกแม้ชนกับกิจกรรมอื่น
 * @param options.inviteSender  เพิ่มผู้ส่งอีเมลเป็นผู้เข้าร่วม (เฉพาะ mode CREATE)
 * ถ้าชนและไม่ได้ force → 409 CALENDAR_CONFLICT และรายการกลับเป็น SUGGESTED
 */
const confirmActionItem = async (userId, actionId, options = {}, deps = getDeps()) => {
  const { prisma, getCalendar, now } = deps;
  const logger = deps.logger.child({ actionId }, 'CONFIRM');
  const item = await findOwnedItem(prisma, userId, actionId);
  const updateRelated = options.mode === 'UPDATE_RELATED';

  if (!item.startAt) throw badRequest('กรุณาระบุวันที่ก่อนยืนยัน');
  if (item.kind === 'EVENT' && !item.isAllDay && !(item.isTimeSpecified && item.endAt)) {
    throw badRequest('กรุณาระบุเวลาเริ่มและสิ้นสุด หรือเลือกเป็นกิจกรรมทั้งวัน');
  }
  if (updateRelated) {
    if (!item.relatedAction) throw badRequest('รายการนี้ไม่ได้ผูกกับกิจกรรมเดิม');
    if (!['SUGGESTED', 'FAILED', 'CREATED'].includes(item.relatedAction.status)) {
      throw conflict('RELATED_NOT_UPDATABLE', 'กิจกรรมเดิมถูกปิดไปแล้ว กรุณาเพิ่มเป็นรายการแยก');
    }
  }

  const lock = await prisma.actionItem.updateMany({
    where: { id: actionId, status: { in: EDITABLE } },
    data: { status: 'CREATING', errorMessage: null },
  });
  if (lock.count === 0) {
    const current = await prisma.actionItem.findUnique({ where: { id: actionId } });
    throw conflict('ACTION_NOT_CONFIRMABLE', BLOCKED_MESSAGES[current?.status] || 'รายการนี้ยืนยันไม่ได้');
  }

  const account = item.email.mailAccount;
  const settings = account.user.setting || {};
  const timezone = normalizeTimeZone(settings.timezone);
  const window = toEventWindow(item);

  try {
    const calendar = getCalendar(account);

    // ปฏิทินอาจเปลี่ยนไปตั้งแต่ตอนวิเคราะห์ จึงตรวจการชนอีกครั้งก่อนบันทึกจริง
    if (isTimedEvent(item) && !options.force) {
      const occurrences = occurrencesOf(item, timezone);
      const events = await calendar.listEvents({
        timeMin: new Date(window.start.getTime() - 60 * 60000),
        timeMax: new Date(occurrences[occurrences.length - 1].end.getTime() + 60 * 60000),
      });
      const ownEvent = relatedEventId(item);
      const others = events.filter((e) => e.id !== ownEvent && (!ownEvent || e.recurringEventId !== ownEvent));
      // กิจกรรมหลายวัน: ตรวจทุกวัน รายงานวันแรกที่ชน
      const check =
        occurrences
          .map((o) => checkAvailability({ start: o.start, end: o.end, events: others, settings, mode: 'WARN' }))
          .find((c) => c.availability === 'CONFLICT') || { availability: 'AVAILABLE' };
      if (check.availability === 'CONFLICT') {
        await prisma.actionItem.update({
          where: { id: actionId },
          data: { status: 'SUGGESTED', availability: 'CONFLICT', availabilityReason: check.reason },
        });
        throw conflict('CALENDAR_CONFLICT', check.reason, { conflict: check.conflict });
      }
    }

    const result = updateRelated
      ? await mergeIntoRelated({ item, window, timezone, calendar, prisma })
      : await createAsNewEvent({ item, window, timezone, calendar, options, prisma, now });

    logger.info('CONFIRM_END', updateRelated ? 'Existing event updated' : 'Calendar event created', result);
    return reload(prisma, actionId);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const message = String(error.message || error).slice(0, 300);
    await prisma.actionItem.update({ where: { id: actionId }, data: { status: 'FAILED', errorMessage: message } });
    if (error.code === 'REAUTH_REQUIRED') {
      await prisma.mailAccount.update({ where: { id: account.id }, data: { status: 'NEEDS_REAUTH' } });
      throw new HttpError(401, 'REAUTH_REQUIRED', error.message);
    }
    logger.error('CONFIRM_ERROR', 'Calendar could not be updated', error);
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
  return reload(prisma, actionId);
};

module.exports = { updateActionItem, confirmActionItem, dismissActionItem, toEventWindow };
