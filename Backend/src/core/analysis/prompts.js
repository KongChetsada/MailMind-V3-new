// Prompt ทั้งหมดของระบบอยู่ในไฟล์นี้ — ไม่มีการเรียกโมเดลที่นี่
const { CATEGORIES, PRIORITY_RULES } = require('../categories');
const { offsetString, formatThaiDate } = require('../time');

const JSON_SYSTEM_PROMPT =
  'You are an executive assistant that analyses business emails. You MUST reply with one valid JSON object only, no extra text.';

const categoryLines = () =>
  Object.entries(CATEGORIES)
    .map(([code, c]) => `- ${code}: ${c.label} — ${c.description}`)
    .join('\n');

/** ขั้นที่ 1: จำแนกประเภทและสกัดรายการที่ลงปฏิทินได้ */
const buildAnalysisPrompt = ({ formattedThread, now = new Date(), timezone }) => {
  const offset = offsetString(timezone, now);
  const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, dateStyle: 'short' }).format(now);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(now);

  return `
Analyse the email thread below and return a JSON object.

DATE CONTEXT
- Today is ${weekday}, ${todayIso} (${formatThaiDate(now, timezone)}), timezone offset ${offset}.
- Resolve relative dates ("พรุ่งนี้", "วันศุกร์นี้", "สัปดาห์หน้า", "tomorrow") against today.
- Thai Buddhist Era years (พ.ศ.) MUST be converted to Gregorian: year - 543 (2569 -> 2026).
- Every date-time MUST be ISO 8601 with the offset ${offset}, e.g. "2026-08-24T10:00:00${offset}".

THREAD RULE
- When the thread has several messages, the LATEST message states the current intent.
  If it changes a date or time proposed earlier, use the new one and ignore the old one.

STEP 1 - category (choose exactly one code)
${categoryLines()}
Tie-breakers: advertising, marketing and newsletters are OTHER, not FYI. A request to meet at a time the two parties must agree on is APPOINTMENT; an event whose time the organiser already fixed for many people is EVENT_INVITATION.

STEP 2 - priority
- HIGH: ${PRIORITY_RULES.HIGH}
- NORMAL: ${PRIORITY_RULES.NORMAL}
- LOW: ${PRIORITY_RULES.LOW}

STEP 3 - summary
- 1-2 sentences in THAI saying what the sender wants and by when.

STEP 4 - needsReply and replyIntent
- needsReply is true only when the sender expects an answer from the recipient.
- replyIntent: "ACCEPT" (agree to a meeting/invitation), "ANSWER" (provide requested information),
  "ACKNOWLEDGE" (confirm receipt), or null when no reply is needed.

STEP 5 - actionItems (things that could go on a calendar; may be empty, at most 5)
- kind "EVENT": something that happens at a time (meeting, seminar, training, flight, hotel stay).
  A meeting time that is proposed, asked about ("สะดวกไหม"), confirmed, or rescheduled IS an EVENT — always extract it.
- kind "DEADLINE": a due date for a task or document. Put the due date in "start", "end" must be null.
- "start"/"end": ISO 8601 with offset. Use null when the email does not say. NEVER invent a date or time.
- "isTimeSpecified": true only if the email states a clock time. If only a date is given, set false and use 00:00:00 in "start".
- "isAllDay": true only for events that explicitly last whole days.
- "end": if the email gives an end time or a duration, compute it; otherwise null.
- "location": room, address, or online platform/link; null if absent.
- "evidence": copy the EXACT phrase from the email (max 150 characters) that states this date/time. Do not paraphrase.
- "title": short THAI title for the calendar entry.

EMAIL THREAD
"""
${formattedThread}
"""

Return exactly this JSON shape:
{
  "category": "APPOINTMENT | TASK_DEADLINE | INFO_REQUEST | FYI | BOOKING_TRAVEL | EVENT_INVITATION | OTHER",
  "priority": "HIGH | NORMAL | LOW",
  "summary": "string",
  "needsReply": true,
  "replyIntent": "ACCEPT | ANSWER | ACKNOWLEDGE | null",
  "actionItems": [
    {
      "kind": "EVENT | DEADLINE",
      "title": "string",
      "start": "ISO 8601 or null",
      "end": "ISO 8601 or null",
      "isAllDay": false,
      "isTimeSpecified": true,
      "location": "string or null",
      "evidence": "exact phrase from the email"
    }
  ]
}
`.trim();
};

const INTENT_INSTRUCTIONS = {
  ACCEPT: (c) => `
DECISION: ACCEPT
- Confirm that the user will attend / agrees.
- Time to confirm: ${c.requestedTimeText || 'ตามที่ผู้ส่งเสนอ'}
- Location or channel: ${c.location || 'ตามที่ผู้ส่งเสนอ'}`,
  PROPOSE_TIME: (c) => `
DECISION: PROPOSE OTHER TIMES
- Reason the requested time cannot be confirmed: ${c.reason || 'ผู้ส่งยังไม่ได้ระบุเวลาที่ชัดเจน'}
- Politely explain, then offer ONLY these pre-checked free slots:
${(c.slotTexts?.length ? c.slotTexts : ['วันและเวลาทำการที่ผู้ส่งสะดวก']).map((s, i) => `  ${i + 1}. ${s}`).join('\n')}
- Ask which slot works, or invite the sender to suggest another.`,
  DECLINE: () => `
DECISION: DECLINE
- Politely decline and thank the sender. Do not invent a reason; keep it general.`,
  ANSWER: () => `
DECISION: ANSWER THE REQUEST
- Respond to what the sender asked for.
- You do NOT know the user's files or facts. Wherever specific information, a document, or a number is needed,
  write a placeholder in square brackets such as [ระบุข้อมูล...] or [แนบไฟล์...] for the user to fill in. Never make facts up.`,
  ACKNOWLEDGE: (c) => `
DECISION: ACKNOWLEDGE
- Confirm that the message has been received${c.deadlineText ? ` and that the deadline (${c.deadlineText}) is noted` : ''}.
- Keep it short.`,
};

/**
 * ขั้นที่ 2: ร่างข้อความตอบกลับตามเจตนาที่ระบบกำหนดไว้แล้ว (โมเดลไม่ได้เป็นผู้ตัดสินใจ)
 * @param profile  ผลจาก core/profile.buildReplyProfile
 * @param context  { requestedTimeText, location, reason, slotTexts, deadlineText, summary }
 */
const buildDraftPrompt = ({ intent, profile, formattedThread, context = {} }) => {
  const instruction = (INTENT_INSTRUCTIONS[intent] || INTENT_INSTRUCTIONS.ANSWER)(context);
  return `
Draft an email reply in THAI on behalf of the user.

USER PROFILE
- First-person pronoun: ${profile.pronoun}
- Polite ending particle: ${profile.politeParticle}
- Tone: ${profile.tone}
- Working hours: ${profile.workingHours}

WHAT THE EMAIL IS ABOUT
${context.summary || '(see thread)'}
${instruction}

EMAIL THREAD
"""
${formattedThread}
"""

RULES
1. Write natural, grammatically correct Thai. Plain text only, no markdown.
2. Structure: greeting, the decision above stated clearly, closing line.
3. Use the pronoun "${profile.pronoun}" and the particle "${profile.politeParticle}".
4. Do not promise anything that is not in the decision above. Do not invent dates, times, or facts.
5. End with exactly this signature:
${profile.signature}

Return JSON:
{ "draftMessage": "ข้อความตอบกลับฉบับเต็ม" }
`.trim();
};

/**
 * ภาพรวมสั้น ๆ ของตารางงาน — รายการกิจกรรมจริงถูกจัดรูปแบบด้วยโค้ด ไม่ได้ให้โมเดลเขียน
 * (โมเดลขนาดเล็กแต่งกิจกรรมขึ้นเองเมื่อให้เขียนรายการ โดยเฉพาะเมื่อรายการว่าง)
 */
const buildScheduleOverviewPrompt = ({ scheduleText, dateContext }) =>
  `
You are an executive assistant. Below is the user's schedule for a period.
Date context: ${dateContext}

SCHEDULE
${scheduleText}

Write an overview in THAI, 1-3 sentences, plain text, no bullet points, no headers, no emojis.
Mention only what is in the schedule above: how busy the period is, which day or time is densest,
and any item that still needs confirmation. Do NOT add, rename, or guess any event, time, or person.
`.trim();

module.exports = { JSON_SYSTEM_PROMPT, buildAnalysisPrompt, buildDraftPrompt, buildScheduleOverviewPrompt };
