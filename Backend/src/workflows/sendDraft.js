// ขั้น (D1) ส่งร่างตอบกลับ — กดซ้ำหรือเรียกซ้อนกันจะไม่ส่งอีเมลซ้ำ
const { getDeps } = require('./deps');
const { badRequest, conflict, notFound, HttpError } = require('../utils/httpError');

const SENDABLE = ['PENDING', 'FAILED'];
const BLOCKED_MESSAGES = {
  SENDING: 'ร่างนี้กำลังถูกส่งอยู่',
  SENT: 'ร่างนี้ถูกส่งไปแล้ว',
  DISCARDED: 'ร่างนี้ถูกทิ้งแล้ว',
};

/** ร่างของผู้ใช้คนนี้เท่านั้น (ไม่พบ = 404 ไม่บอกว่าเป็นของคนอื่น) */
const findOwnedDraft = async (prisma, userId, draftId) => {
  const draft = await prisma.replyDraft.findFirst({
    where: { id: draftId, email: { mailAccount: { userId } } },
    include: { email: { include: { mailAccount: true } } },
  });
  if (!draft) throw notFound('ไม่พบร่างนี้');
  return draft;
};

/**
 * @param input.body  ข้อความที่ผู้ใช้แก้แล้ว (ไม่ระบุ = ใช้ข้อความในร่าง)
 * คืนแถว ReplyDraft สถานะ SENT
 */
const sendDraft = async (userId, draftId, input = {}, deps = getDeps()) => {
  const { prisma, getMail, now } = deps;
  const logger = deps.logger.child({ draftId }, 'SEND');

  const draft = await findOwnedDraft(prisma, userId, draftId);
  const edited = typeof input.body === 'string' && input.body.trim() !== draft.body.trim();
  const body = (edited ? input.body : draft.body).trim();
  if (!body) throw badRequest('ข้อความตอบกลับว่างเปล่า');

  // ล็อกด้วยการเปลี่ยนสถานะแบบมีเงื่อนไข: มีเพียงคำขอเดียวที่เปลี่ยนเป็น SENDING ได้
  const lock = await prisma.replyDraft.updateMany({
    where: { id: draftId, status: { in: SENDABLE } },
    data: { status: 'SENDING', body, errorMessage: null, ...(edited ? { source: 'USER' } : {}) },
  });
  if (lock.count === 0) {
    const current = await prisma.replyDraft.findUnique({ where: { id: draftId } });
    throw conflict('DRAFT_NOT_SENDABLE', BLOCKED_MESSAGES[current?.status] || 'ร่างนี้ส่งไม่ได้');
  }

  const { email } = draft;
  try {
    const sent = await getMail(email.mailAccount).sendReply({
      threadId: email.providerThreadId,
      inReplyToMessageId: email.providerMessageId,
      body,
    });
    const updated = await prisma.replyDraft.update({
      where: { id: draftId },
      data: { status: 'SENT', sentAt: now(), providerMessageId: sent.id },
    });
    logger.info('SEND_END', 'Reply sent', { providerMessageId: sent.id, edited });
    return updated;
  } catch (error) {
    const message = String(error.message || error).slice(0, 300);
    await prisma.replyDraft.update({ where: { id: draftId }, data: { status: 'FAILED', errorMessage: message } });
    if (error.code === 'REAUTH_REQUIRED') {
      await prisma.mailAccount.update({ where: { id: email.mailAccountId }, data: { status: 'NEEDS_REAUTH' } });
      throw new HttpError(401, 'REAUTH_REQUIRED', error.message);
    }
    logger.error('SEND_ERROR', 'Reply could not be sent', error);
    throw new HttpError(502, 'SEND_FAILED', `ส่งอีเมลไม่สำเร็จ: ${message}`);
  }
};

/** แก้ข้อความร่าง (เฉพาะร่างที่ยังไม่ส่ง) */
const updateDraftBody = async (userId, draftId, body, deps = getDeps()) => {
  const { prisma } = deps;
  await findOwnedDraft(prisma, userId, draftId);
  if (typeof body !== 'string' || !body.trim()) throw badRequest('ข้อความตอบกลับว่างเปล่า');
  const result = await prisma.replyDraft.updateMany({
    where: { id: draftId, status: { in: [...SENDABLE, 'DISCARDED'] } },
    data: { body: body.trim(), source: 'USER', status: 'PENDING', errorMessage: null },
  });
  if (result.count === 0) throw conflict('DRAFT_NOT_EDITABLE', 'ร่างนี้ส่งไปแล้วหรือกำลังส่งอยู่ จึงแก้ไม่ได้');
  return prisma.replyDraft.findUnique({ where: { id: draftId } });
};

/** ทิ้งร่าง — เก็บแถวไว้เป็นสถิติ ไม่ลบ */
const discardDraft = async (userId, draftId, deps = getDeps()) => {
  const { prisma } = deps;
  await findOwnedDraft(prisma, userId, draftId);
  const result = await prisma.replyDraft.updateMany({
    where: { id: draftId, status: { in: SENDABLE } },
    data: { status: 'DISCARDED' },
  });
  if (result.count === 0) throw conflict('DRAFT_NOT_EDITABLE', 'ร่างนี้ส่งไปแล้วหรือกำลังส่งอยู่ จึงทิ้งไม่ได้');
  return prisma.replyDraft.findUnique({ where: { id: draftId } });
};

/** เขียนร่างเองโดยไม่ใช้ AI (ใช้ตอบได้แม้ AI ไม่พร้อม) */
const saveManualDraft = async (userId, emailId, body, deps = getDeps()) => {
  const { prisma } = deps;
  if (typeof body !== 'string' || !body.trim()) throw badRequest('ข้อความตอบกลับว่างเปล่า');
  const email = await prisma.emailMessage.findFirst({
    where: { id: emailId, mailAccount: { userId } },
    include: { replyDraft: true },
  });
  if (!email) throw notFound('ไม่พบอีเมลนี้');
  if (email.replyDraft && ['SENDING', 'SENT'].includes(email.replyDraft.status)) {
    throw conflict('DRAFT_LOCKED', 'อีเมลนี้ตอบกลับไปแล้วหรือกำลังส่งอยู่');
  }
  const data = { body: body.trim(), source: 'USER', status: 'PENDING', errorMessage: null, templateId: null };
  return prisma.replyDraft.upsert({
    where: { emailId },
    update: data,
    create: { emailId, intent: 'ANSWER', ...data },
  });
};

module.exports = { sendDraft, updateDraftBody, discardDraft, saveManualDraft };
