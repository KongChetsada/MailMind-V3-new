// ขั้น (B) วิเคราะห์อีเมลหนึ่งฉบับ: จำแนก → สกัด → ตรวจผลลัพธ์ → ตรวจตาราง → (ร่างตอบกลับ)
const { getDeps } = require('./deps');
const { formatThreadForAi } = require('../utils/emailText');
const { JSON_SYSTEM_PROMPT, buildAnalysisPrompt } = require('../core/analysis/prompts');
const { parseJsonFromLlm } = require('../core/analysis/parse');
const { validateAnalysis } = require('../core/analysis/validate');
const { getCategoryPolicy } = require('../core/categories');
const { normalizeTimeZone } = require('../core/time');
const { evaluateAvailability } = require('./availability');
const { generateDraft } = require('./generateDraft');

const CLAIMABLE = ['PENDING', 'FAILED'];
const CLAIMABLE_FORCED = ['PENDING', 'FAILED', 'DONE', 'SKIPPED'];
// รายการที่ผู้ใช้ยังไม่ได้ลงปฏิทิน ถูกแทนที่เมื่อวิเคราะห์ใหม่
const REPLACEABLE_ITEM_STATUSES = ['SUGGESTED', 'FAILED', 'DISMISSED'];

/** ข้อความในเธรดจนถึงฉบับที่กำลังวิเคราะห์ (ไม่รวมฉบับที่มาทีหลัง) */
const threadUpTo = (messages, messageId) => {
  const index = messages.findIndex((m) => m.id === messageId);
  return index === -1 ? messages : messages.slice(0, index + 1);
};

/**
 * @param options.force  วิเคราะห์ใหม่แม้เคยวิเคราะห์แล้ว (ผู้ใช้กดเอง)
 * คืน { claimed, ok, category?, error? }
 */
const analyzeEmail = async (emailId, options = {}, deps = getDeps()) => {
  const { prisma, getMail, getCalendar, getAi, now } = deps;
  const logger = deps.logger.child({ emailId }, 'ANALYZE');

  // จองแถวด้วยการ update แบบมีเงื่อนไข: งานสองตัวจะไม่วิเคราะห์ฉบับเดียวกันพร้อมกัน
  const claim = await prisma.emailMessage.updateMany({
    where: { id: emailId, analysisStatus: { in: options.force ? CLAIMABLE_FORCED : CLAIMABLE } },
    data: { analysisStatus: 'PROCESSING', analysisAttempts: { increment: 1 }, analysisError: null },
  });
  if (claim.count === 0) return { claimed: false, ok: false };

  const email = await prisma.emailMessage.findUnique({
    where: { id: emailId },
    include: { mailAccount: { include: { user: { include: { setting: true } } } } },
  });
  const account = email.mailAccount;
  const settings = account.user.setting || {};
  const timezone = normalizeTimeZone(settings.timezone);
  const startedAt = Date.now();

  try {
    const ai = await getAi(account.userId);
    const mail = getMail(account);

    const thread = threadUpTo(await mail.getThread(email.providerThreadId), email.providerMessageId);
    let { formattedThread, plainText } = formatThreadForAi(thread);
    if (!plainText.trim()) {
      plainText = `${email.subject || ''}\n${email.snippet || ''}`;
      formattedThread = `[SINGLE EMAIL MESSAGE]\nFrom: ${email.fromAddress || ''}\nSubject: ${email.subject || ''}\nContent:\n${email.snippet || ''}`;
    }

    const response = await ai.complete({
      system: JSON_SYSTEM_PROMPT,
      user: buildAnalysisPrompt({ formattedThread, now: now(), timezone }),
      temperature: 0.1,
      json: true,
    });
    const { value, strategy } = parseJsonFromLlm(response.text);
    if (strategy !== 'direct') {
      logger.sensitiveBlock('ANALYSIS_RAW_RESPONSE', 'AI ANALYSIS RAW RESPONSE', String(response.text).slice(0, 1500));
    }
    const result = validateAnalysis(value, { plainText, timezone, now: now() });
    const policy = getCategoryPolicy(result.category);

    let calendar = null;
    if (policy.calendarMode !== 'NONE' && result.actionItems.some((i) => i.kind === 'EVENT')) {
      calendar = getCalendar(account);
    }
    const items = await evaluateAvailability({
      items: result.actionItems,
      mode: policy.calendarMode,
      calendar,
      settings,
      now: now(),
      logger,
    });

    await prisma.$transaction([
      prisma.actionItem.deleteMany({ where: { emailId, status: { in: REPLACEABLE_ITEM_STATUSES } } }),
      prisma.emailMessage.update({
        where: { id: emailId },
        data: {
          analysisStatus: 'DONE',
          analysisError: null,
          analyzedAt: now(),
          aiProvider: ai.provider,
          aiModel: ai.model,
          category: result.category,
          priority: result.priority,
          summary: result.summary,
          needsReply: result.needsReply,
          ...(options.force ? { userCategory: null } : {}),
        },
      }),
      prisma.actionItem.createMany({
        data: items.map((item) => ({
          emailId,
          kind: item.kind,
          title: item.title,
          startAt: item.startAt,
          endAt: item.endAt,
          isAllDay: item.isAllDay,
          isTimeSpecified: item.isTimeSpecified,
          location: item.location,
          evidence: item.evidence,
          missingFields: item.missingFields,
          availability: item.availability,
          availabilityReason: item.availabilityReason,
          suggestedSlots: item.suggestedSlots ?? undefined,
        })),
      }),
    ]);

    logger.info('ANALYZE_END', 'Email analysis completed', {
      durationMs: Date.now() - startedAt,
      provider: ai.provider,
      model: ai.model,
      parserStrategy: strategy,
      category: result.category,
      priority: result.priority,
      needsReply: result.needsReply,
      actionItems: items.length,
      usage: response.usage,
    });

    // ร่างตอบกลับเป็นขั้นเสริม: ล้มเหลวได้โดยผลวิเคราะห์ยังอยู่ ผู้ใช้กดขอร่างเองได้ภายหลัง
    if (policy.autoDraft && result.needsReply) {
      try {
        await generateDraft(emailId, { formattedThread }, deps);
      } catch (draftError) {
        logger.warn('AUTO_DRAFT_FAILED', 'Automatic draft generation failed', { error: draftError.message });
      }
    }

    return { claimed: true, ok: true, category: result.category };
  } catch (error) {
    const message = String(error.message || error).slice(0, 300);
    // updateMany: ถ้าอีเมลถูกลบไประหว่างวิเคราะห์ ก็ไม่ทำให้งานทั้งรอบล้ม
    await prisma.emailMessage.updateMany({
      where: { id: emailId },
      data: { analysisStatus: 'FAILED', analysisError: message },
    });
    if (error.code === 'REAUTH_REQUIRED') {
      await prisma.mailAccount.update({ where: { id: account.id }, data: { status: 'NEEDS_REAUTH' } });
    }
    logger.error('ANALYZE_ERROR', 'Email analysis failed', error, { durationMs: Date.now() - startedAt });
    return { claimed: true, ok: false, error: message, code: error.code };
  }
};

module.exports = { analyzeEmail };
