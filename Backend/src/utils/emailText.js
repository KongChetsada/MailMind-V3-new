// แปลงเนื้อหาอีเมลเป็นข้อความสำหรับส่งให้ AI
// ไม่ผูกกับผู้ให้บริการอีเมล: รับข้อความในรูปแบบกลาง { from, date, text, html }

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };

/**
 * แปลง HTML เป็นข้อความธรรมดา (สำหรับอีเมลที่ไม่มีส่วน text/plain เช่น ใบยืนยันการจอง)
 */
const htmlToText = (html) => {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' ')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const QUOTE_PATTERNS = [
  /-----Original Message-----[\s\S]*/i,
  /On\s+.+?wrote:[\s\S]*/i,
  /เมื่อ\s+.+?เขียนว่า:[\s\S]*/i,
  /From:\s*.+?Sent:\s*.+?To:\s*.+?Subject:[\s\S]*/i,
  /จาก:\s*.+?ส่งเมื่อ:\s*.+?ถึง:\s*.+?หัวข้อ:[\s\S]*/i,
];

const FOOTER_PATTERNS = [
  /Sent from my iPhone.*/i,
  /Sent from my Galaxy.*/i,
  /Sent from Mail for Windows.*/i,
  /ส่งจากสมาร์ทโฟนของฉัน.*/i,
  /This email and any attachments are confidential[\s\S]*/i,
  /ข้อความนี้และเอกสารแนบเป็นความลับ[\s\S]*/i,
];

/**
 * ตัดข้อความที่อ้างถึงเมลก่อนหน้า ลายเซ็นของแอป และบรรทัดว่างส่วนเกิน
 */
const stripQuotedText = (rawText) => {
  if (!rawText || typeof rawText !== 'string') return '';
  let text = rawText;
  for (const pattern of QUOTE_PATTERNS) text = text.replace(pattern, '');
  text = text
    .split('\n')
    .filter((line) => !line.trim().startsWith('>'))
    .join('\n');
  for (const pattern of FOOTER_PATTERNS) text = text.replace(pattern, '');
  return text.replace(/\n{3,}/g, '\n\n').trim();
};

/** ข้อความที่อ่านได้ของข้อความหนึ่งฉบับ: ใช้ text/plain ก่อน ถ้าไม่มีจึงแปลงจาก HTML */
const messagePlainText = (message) => {
  const plain = (message?.text || '').trim();
  return plain ? plain : htmlToText(message?.html || '');
};

const MAX_MESSAGE_CHARS = 6000;
const MAX_THREAD_MESSAGES = 6;

/**
 * จัดรูปแบบทั้งเธรดตามลำดับเวลา โดยระบุชัดว่าข้อความใดเป็นฉบับล่าสุด
 * คืน { formattedThread, plainText } — plainText ใช้ตรวจว่าหลักฐานที่ AI อ้างมีอยู่จริง
 */
const formatThreadForAi = (messages) => {
  const all = Array.isArray(messages) ? messages : [];
  const list = all.slice(-MAX_THREAD_MESSAGES);
  const total = list.length;
  if (total === 0) return { formattedThread: '', plainText: '' };

  const bodies = list.map((m) => stripQuotedText(messagePlainText(m)).slice(0, MAX_MESSAGE_CHARS));
  const sections = list.map((m, index) => {
    let label;
    if (total === 1) label = '[SINGLE EMAIL MESSAGE]';
    else if (index === total - 1) label = `[MESSAGE ${index + 1} of ${total} - LATEST MESSAGE (CURRENT FOCUS)]`;
    else label = `[MESSAGE ${index + 1} of ${total} - earlier message]`;
    return `${label}\nFrom: ${m.from || 'Unknown'}\nDate: ${m.date || ''}\nSubject: ${m.subject || ''}\nContent:\n${bodies[index]}`;
  });

  return {
    formattedThread: sections.join('\n\n---------------------------------\n\n'),
    plainText: list.map((m, i) => `${m.subject || ''}\n${bodies[i]}`).join('\n'),
  };
};

/** แยก "ชื่อ <อีเมล>" */
const parseAddress = (raw) => {
  const value = String(raw || '').trim();
  const match = value.match(/^(.*?)<([^>]+)>\s*$/);
  if (match) return { name: match[1].trim().replace(/^"|"$/g, '') || null, address: match[2].trim() };
  return { name: null, address: value || null };
};

module.exports = { htmlToText, stripQuotedText, messagePlainText, formatThreadForAi, parseAddress };
