// แกะข้อความที่โมเดลตอบกลับให้เป็นข้อมูล — ไม่เชื่อว่าโมเดลจะตอบ JSON ที่ถูกต้องเสมอ

const stripWrappers = (text) =>
  String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '') // โมเดลแบบ reasoning บางตัวแนบส่วนคิดมาด้วย
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

/**
 * คืน { value, strategy } — value เป็น null เมื่ออ่านไม่ได้
 * strategy: 'direct' | 'repaired' | 'failed'
 */
const parseJsonFromLlm = (text) => {
  let cleaned = stripWrappers(text);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) cleaned = match[0];
  if (!cleaned) return { value: null, strategy: 'failed' };

  try {
    return { value: JSON.parse(cleaned), strategy: 'direct' };
  } catch {
    try {
      // ซ่อม backslash ที่ไม่ถูกต้องและการขึ้นบรรทัดใหม่จริงในสตริง
      const fixed = cleaned.replace(/\\([^"\\/bfnrtu])/g, '\\\\$1').replace(/[\r\n]/g, '\\n');
      return { value: JSON.parse(fixed), strategy: 'repaired' };
    } catch {
      return { value: null, strategy: 'failed' };
    }
  }
};

const unescape = (s) => s.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');

/** ทำให้ข้อความร่างเป็นข้อความธรรมดา แม้โมเดลจะห่อมาเป็น object หรือ JSON ซ้อน */
const cleanDraftText = (value) => {
  if (!value) return '';
  if (typeof value === 'object') {
    return Object.values(value).map(cleanDraftText).filter(Boolean).join('\n\n');
  }
  let str = String(value).trim();
  if (str.startsWith('{') && str.endsWith('}')) {
    try {
      return cleanDraftText(JSON.parse(str));
    } catch {
      str = str.replace(/^\{\s*/, '').replace(/\s*\}$/, '').replace(/"[\wก-๙]+"\s*:\s*/g, '');
    }
  }
  return unescape(str).replace(/^"|"$/g, '').trim();
};

/** ดึงข้อความร่างจากคำตอบของโมเดล: JSON { draftMessage } ก่อน ถ้าไม่ได้จึงใช้ regex */
const extractDraftMessage = (rawText) => {
  const { value, strategy } = parseJsonFromLlm(rawText);
  if (value && (value.draftMessage || value.draft || value.message)) {
    return { draft: cleanDraftText(value.draftMessage || value.draft || value.message), strategy };
  }
  const cleaned = stripWrappers(rawText);
  const idx = cleaned.indexOf('"draftMessage"');
  if (idx !== -1) {
    const colon = cleaned.indexOf(':', idx);
    const tail = cleaned.slice(colon + 1).replace(/^\s*"/, '').replace(/"\s*\}?\s*$/, '');
    return { draft: cleanDraftText(tail), strategy: 'regex' };
  }
  return { draft: '', strategy: 'failed' };
};

module.exports = { parseJsonFromLlm, extractDraftMessage, cleanDraftText };
