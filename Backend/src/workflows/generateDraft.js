// ร่างข้อความตอบกลับของอีเมลหนึ่งฉบับ
// ระบบเป็นผู้กำหนดเจตนา (ตอบรับ / เสนอเวลาอื่น / ...) จากผลตรวจตาราง แล้วให้ AI เรียบเรียงข้อความเท่านั้น
const { getDeps } = require('./deps');
const { conflict, notFound, HttpError } = require('../utils/httpError');
const { formatThreadForAi } = require('../utils/emailText');
const { JSON_SYSTEM_PROMPT, buildDraftPrompt } = require('../core/analysis/prompts');
const { extractDraftMessage } = require('../core/analysis/parse');
const { buildReplyProfile } = require('../core/profile');
const { getCategoryPolicy, effectiveCategory, REPLY_INTENTS } = require('../core/categories');
const { normalizeTimeZone, formatThaiRange, formatThaiDate } = require('../core/time');
const { findAvailableSlots } = require('../core/scheduler');
const { lastOccurrenceStart } = require('../core/occurrences');

const LOCKED_DRAFT_STATUSES = ['SENDING', 'SENT'];

const pickIntent = (requested, category, primaryEvent) => {
  if (requested && REPLY_INTENTS.includes(requested)) return requested;
  if (category === 'APPOINTMENT') {
    return primaryEvent?.availability === 'AVAILABLE' ? 'ACCEPT' : 'PROPOSE_TIME';
  }
  return getCategoryPolicy(category).defaultIntent;
};

/** เวลาว่างที่จะเสนอ: ใช้ที่คำนวณไว้ตอนวิเคราะห์ ถ้าไม่มีจึงคำนวณจากปฏิทินตอนนี้ */
const resolveSlots = async ({ primaryEvent, account, settings, deps }) => {
  if (Array.isArray(primaryEvent?.suggestedSlots) && primaryEvent.suggestedSlots.length) {
    return primaryEvent.suggestedSlots.map((s) => ({ start: new Date(s.start), end: new Date(s.end) }));
  }
  try {
    const now = deps.now();
    const events = await deps.getCalendar(account).listEvents({
      timeMin: now,
      timeMax: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000),
    });
    return findAvailableSlots({ from: primaryEvent?.startAt || now, events, settings, now });
  } catch {
    return [];
  }
};

/**
 * @param options.intent           เจตนาที่ผู้ใช้เลือก (ไม่ระบุ = ระบบเลือกให้)
 * @param options.formattedThread  เนื้อเธรดที่เตรียมไว้แล้ว (ไม่ระบุ = ดึงจากผู้ให้บริการ)
 * คืนแถว ReplyDraft
 */
const generateDraft = async (emailId, options = {}, deps = getDeps()) => {
  const { prisma, getMail, getAi } = deps;
  const logger = deps.logger.child({ emailId }, 'DRAFT');

  const email = await prisma.emailMessage.findUnique({
    where: { id: emailId },
    include: {
      actionItems: { orderBy: { startAt: 'asc' } },
      replyDraft: true,
      mailAccount: { include: { user: { include: { setting: true } } } },
    },
  });
  if (!email) throw notFound('ไม่พบอีเมลนี้');
  if (email.replyDraft && LOCKED_DRAFT_STATUSES.includes(email.replyDraft.status)) {
    throw conflict('DRAFT_LOCKED', 'อีเมลนี้ตอบกลับไปแล้วหรือกำลังส่งอยู่ จึงสร้างร่างใหม่ไม่ได้');
  }

  const account = email.mailAccount;
  const settings = account.user.setting || {};
  const timezone = normalizeTimeZone(settings.timezone);
  const category = effectiveCategory(email) || 'OTHER';

  const activeItems = email.actionItems.filter((i) => i.status !== 'DISMISSED');
  const primaryEvent = activeItems.find((i) => i.kind === 'EVENT') || null;
  const deadline = activeItems.find((i) => i.kind === 'DEADLINE' && i.startAt) || null;
  const intent = pickIntent(options.intent, category, primaryEvent);

  const context = {
    summary: email.summary,
    location: primaryEvent?.location || null,
    requestedTimeText:
      primaryEvent?.startAt && primaryEvent.isTimeSpecified
        ? `${formatThaiRange(primaryEvent.startAt, primaryEvent.endAt, timezone)}${
            primaryEvent.repeatDays > 1
              ? ` ทุกวัน รวม ${primaryEvent.repeatDays} วัน ถึง${formatThaiDate(lastOccurrenceStart(primaryEvent, timezone), timezone)}`
              : ''
          }`
        : primaryEvent?.startAt
          ? formatThaiDate(primaryEvent.startAt, timezone)
          : null,
    reason: primaryEvent?.availabilityReason || null,
    deadlineText: deadline ? formatThaiDate(deadline.startAt, timezone) : null,
  };
  if (intent === 'PROPOSE_TIME') {
    const slots = await resolveSlots({ primaryEvent, account, settings, deps });
    context.slotTexts = slots.map((s) => formatThaiRange(s.start, s.end, timezone));
  }

  let formattedThread = options.formattedThread;
  if (!formattedThread) {
    const thread = await getMail(account).getThread(email.providerThreadId);
    formattedThread = formatThreadForAi(thread).formattedThread || `Subject: ${email.subject || ''}\n${email.snippet || ''}`;
  }

  const ai = await getAi(account.userId);
  const response = await ai.complete({
    system: JSON_SYSTEM_PROMPT,
    user: buildDraftPrompt({ intent, profile: buildReplyProfile(settings), formattedThread, context }),
    temperature: 0.3,
    json: true,
  });
  const { draft, strategy } = extractDraftMessage(response.text);
  if (!draft) {
    logger.sensitiveBlock('DRAFT_RAW_RESPONSE', 'AI DRAFT RAW RESPONSE', String(response.text).slice(0, 1500));
    throw new HttpError(502, 'AI_EMPTY_DRAFT', 'AI ไม่ได้สร้างข้อความร่าง กรุณาลองใหม่');
  }

  const data = { intent, body: draft, source: 'AI', status: 'PENDING', errorMessage: null };
  const saved = await prisma.replyDraft.upsert({
    where: { emailId },
    update: data,
    create: { emailId, ...data },
  });
  logger.info('DRAFT_SAVED', 'Reply draft saved', {
    intent,
    parserStrategy: strategy,
    draftLength: draft.length,
    provider: ai.provider,
    model: ai.model,
  });
  return saved;
};

module.exports = { generateDraft, pickIntent };
