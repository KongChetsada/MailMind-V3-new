// คำสั่งอ่านข้อมูลอีเมลสำหรับหน้า Inbox (ส่วนที่เปลี่ยนสถานะอยู่ใน workflows/)
const prisma = require('../../config/prisma');
const { notFound } = require('../../utils/httpError');
const { CATEGORY_CODES, effectiveCategory } = require('../../core/categories');
const { getDeps } = require('../../workflows/deps');

const byEffectiveCategory = (category) => ({
  OR: [{ userCategory: category }, { userCategory: null, category }],
});

const FILTERS = {
  has_draft: { replyDraft: { status: 'PENDING' } },
  has_action: { actionItems: { some: { status: 'SUGGESTED' } } },
  needs_reply: { needsReply: true, OR: [{ replyDraft: null }, { replyDraft: { status: { not: 'SENT' } } }] },
  failed: { analysisStatus: 'FAILED' },
  unread: { isRead: false },
};

const toActionDto = (a) => ({
  id: a.id,
  emailId: a.emailId,
  kind: a.kind,
  title: a.title,
  startAt: a.startAt,
  endAt: a.endAt,
  isAllDay: a.isAllDay,
  isTimeSpecified: a.isTimeSpecified,
  repeatDays: a.repeatDays,
  location: a.location,
  evidence: a.evidence,
  missingFields: a.missingFields,
  availability: a.availability,
  availabilityReason: a.availabilityReason,
  suggestedSlots: a.suggestedSlots || [],
  status: a.status,
  externalLink: a.externalLink,
  errorMessage: a.errorMessage,
  relation: a.relation,
  // รายการเดิมในเธรดเดียวกันที่รายการนี้เกี่ยวข้อง (ถ้ามี)
  related: a.relatedAction
    ? {
        id: a.relatedAction.id,
        emailId: a.relatedAction.emailId,
        title: a.relatedAction.title,
        startAt: a.relatedAction.startAt,
        endAt: a.relatedAction.endAt,
        isAllDay: a.relatedAction.isAllDay,
        isTimeSpecified: a.relatedAction.isTimeSpecified,
        repeatDays: a.relatedAction.repeatDays,
        status: a.relatedAction.status,
      }
    : null,
});

const toDraftDto = (d) =>
  d && {
    id: d.id,
    intent: d.intent,
    body: d.body,
    source: d.source,
    status: d.status,
    sentAt: d.sentAt,
    errorMessage: d.errorMessage,
    updatedAt: d.updatedAt,
    templateId: d.templateId ?? null,
    template: d.template ? { id: d.template.id, name: d.template.name } : null,
  };

const toListDto = (e) => ({
  id: e.id,
  fromName: e.fromName,
  fromAddress: e.fromAddress,
  subject: e.subject,
  snippet: e.snippet,
  receivedAt: e.receivedAt,
  isRead: e.isRead,
  category: effectiveCategory(e),
  aiCategory: e.category,
  priority: e.priority,
  summary: e.summary,
  needsReply: e.needsReply,
  analysisStatus: e.analysisStatus,
  analysisError: e.analysisError,
  draftStatus: e.replyDraft?.status || null,
  suggestedActions: e.actionItems.filter((a) => a.status === 'SUGGESTED').length,
  createdActions: e.actionItems.filter((a) => a.status === 'CREATED' || a.status === 'MERGED').length,
});

const listEmails = async (userId, { category, filter, q, cursor, limit = 30 }) => {
  const and = [{ mailAccount: { userId }, removedAt: null }];
  if (category && CATEGORY_CODES.includes(category)) and.push(byEffectiveCategory(category));
  if (filter && FILTERS[filter]) and.push(FILTERS[filter]);
  if (q) {
    and.push({
      OR: ['subject', 'fromName', 'fromAddress', 'snippet'].map((field) => ({
        [field]: { contains: q, mode: 'insensitive' },
      })),
    });
  }

  const rows = await prisma.emailMessage.findMany({
    where: { AND: and },
    orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { replyDraft: { select: { status: true } }, actionItems: { select: { status: true } } },
  });
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return { items: items.map(toListDto), nextCursor: hasMore ? items[items.length - 1].id : null };
};

/** จำนวนอีเมลต่อประเภท และตัวนับสำหรับตัวกรอง */
const getCounts = async (userId) => {
  const base = { mailAccount: { userId }, removedAt: null };
  const [byAi, byUser, total, unread, failed, pending, hasDraft, hasAction] = await Promise.all([
    prisma.emailMessage.groupBy({ by: ['category'], where: { ...base, userCategory: null }, _count: true }),
    prisma.emailMessage.groupBy({ by: ['userCategory'], where: { ...base, userCategory: { not: null } }, _count: true }),
    prisma.emailMessage.count({ where: base }),
    prisma.emailMessage.count({ where: { ...base, ...FILTERS.unread } }),
    prisma.emailMessage.count({ where: { ...base, ...FILTERS.failed } }),
    prisma.emailMessage.count({ where: { ...base, analysisStatus: { in: ['PENDING', 'PROCESSING'] } } }),
    prisma.emailMessage.count({ where: { ...base, ...FILTERS.has_draft } }),
    prisma.emailMessage.count({ where: { ...base, ...FILTERS.has_action } }),
  ]);
  const categories = Object.fromEntries(CATEGORY_CODES.map((c) => [c, 0]));
  for (const row of byAi) if (row.category) categories[row.category] += row._count;
  for (const row of byUser) categories[row.userCategory] += row._count;
  return { total, unread, failed, pending, hasDraft, hasAction, categories };
};

const findOwnedEmail = async (userId, emailId, include) => {
  const email = await prisma.emailMessage.findFirst({ where: { id: emailId, mailAccount: { userId } }, include });
  if (!email) throw notFound('ไม่พบอีเมลนี้');
  return email;
};

/** รายละเอียดอีเมล: ผลวิเคราะห์จากฐานข้อมูล + เนื้อหาเธรดที่ดึงสดจากผู้ให้บริการ */
const getEmailDetail = async (userId, emailId) => {
  const email = await findOwnedEmail(userId, emailId, {
    mailAccount: true,
    replyDraft: { include: { template: { select: { id: true, name: true } } } },
    actionItems: { orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }], include: { relatedAction: true } },
  });

  let messages = [];
  let threadError = email.removedAt ? 'อีเมลนี้ถูกลบหรือย้ายลงถังขยะในกล่องจดหมายแล้ว' : null;
  if (!email.removedAt) try {
    const thread = await getDeps().getMail(email.mailAccount).getThread(email.providerThreadId, { inlineImages: true });
    messages = thread.map((m) => ({
      id: m.id,
      from: m.from,
      subject: m.subject,
      receivedAt: m.receivedAt,
      text: m.text,
      html: m.html,
      attachments: m.attachments || [],
      isCurrent: m.id === email.providerMessageId,
    }));
  } catch (error) {
    // แสดงผลวิเคราะห์ที่เก็บไว้ได้แม้ดึงเนื้อหาไม่สำเร็จ
    threadError =
      error.code === 'REAUTH_REQUIRED'
        ? 'การเชื่อมต่อกับบัญชีอีเมลหมดอายุ กรุณาเข้าสู่ระบบใหม่'
        : 'ดึงเนื้อหาอีเมลจากผู้ให้บริการไม่สำเร็จ';
  }

  return {
    ...toListDto(email),
    removedAt: email.removedAt,
    accountEmail: email.mailAccount.emailAddress,
    aiProvider: email.aiProvider,
    aiModel: email.aiModel,
    analyzedAt: email.analyzedAt,
    actionItems: email.actionItems.map(toActionDto),
    draft: toDraftDto(email.replyDraft),
    messages,
    threadError,
  };
};

/** แก้ประเภทด้วยมือ หรือทำเครื่องหมายอ่านแล้ว */
const updateEmail = async (userId, emailId, { userCategory, isRead }) => {
  const email = await findOwnedEmail(userId, emailId, { mailAccount: true });
  const data = {};
  if (userCategory !== undefined) {
    // เลือกกลับเป็นค่าเดียวกับ AI = ไม่นับว่าเป็นการแก้
    data.userCategory = userCategory === email.category ? null : userCategory;
  }
  if (isRead === true && !email.isRead) {
    data.isRead = true;
    // สถานะอ่านแล้วฝั่งผู้ให้บริการเป็นเรื่องรอง ล้มเหลวได้โดยไม่กระทบผู้ใช้
    getDeps().getMail(email.mailAccount)
      .markRead(email.providerMessageId)
      .catch(() => {});
  }
  if (Object.keys(data).length) await prisma.emailMessage.update({ where: { id: emailId }, data });
  return getEmailDetail(userId, emailId);
};

/**
 * ไฟล์แนบหนึ่งไฟล์ของข้อความในเธรดของอีเมลนี้ — ข้อความจากเธรดอื่นถือว่าไม่พบ
 * คืน { filename, mimeType, data: Buffer }
 */
const getAttachmentFile = async (userId, emailId, messageId, partId) => {
  const email = await findOwnedEmail(userId, emailId, { mailAccount: true });
  const mail = getDeps().getMail(email.mailAccount);
  if (typeof mail.getAttachment !== 'function') throw notFound('ไม่พบไฟล์แนบ');
  const file = await mail.getAttachment(messageId, partId);
  if (!file || file.threadId !== email.providerThreadId) throw notFound('ไม่พบไฟล์แนบ');
  return file;
};

module.exports = { listEmails, getCounts, getEmailDetail, updateEmail, findOwnedEmail, getAttachmentFile, toActionDto, toDraftDto };
