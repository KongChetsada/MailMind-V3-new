// โครงสร้างผลลัพธ์ที่ยอมรับจาก AI ขั้น "จำแนกและสกัด"
// ฟิลด์ที่เป็นแกน (category) ผิดแล้วถือว่าทั้งผลลัพธ์ใช้ไม่ได้ ฟิลด์รองผิดแล้วใช้ค่าเริ่มต้น
const { z } = require('zod');
const { CATEGORY_CODES, PRIORITIES, REPLY_INTENTS, ACTION_KINDS } = require('../categories');

const upper = (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v);
const emptyToNull = (v) => (v === '' || v === undefined || v === 'null' ? null : v);
const toBool = (v) => (typeof v === 'string' ? v.trim().toLowerCase() === 'true' : v);

const nullableString = z.preprocess(emptyToNull, z.string().nullable()).catch(null);
const bool = z.preprocess(toBool, z.boolean()).catch(false);

const actionItemSchema = z.object({
  kind: z.preprocess(upper, z.enum(ACTION_KINDS)),
  title: z.string().trim().min(1),
  start: nullableString,
  end: nullableString,
  isAllDay: bool,
  isTimeSpecified: bool,
  location: nullableString,
  evidence: nullableString,
});

const analysisSchema = z.object({
  category: z.preprocess(upper, z.enum(CATEGORY_CODES)),
  priority: z.preprocess(upper, z.enum(PRIORITIES)).catch('NORMAL'),
  summary: z.string().trim().catch(''),
  needsReply: bool,
  replyIntent: z.preprocess((v) => emptyToNull(upper(v)), z.enum(REPLY_INTENTS).nullable()).catch(null),
  // รายการที่ผิดรูปแบบถูกตัดทิ้งทีละรายการ ไม่ทำให้ผลลัพธ์ทั้งก้อนใช้ไม่ได้
  actionItems: z
    .array(z.unknown())
    .catch([])
    .transform((items) =>
      items
        .map((item) => actionItemSchema.safeParse(item))
        .filter((r) => r.success)
        .map((r) => r.data)
    ),
});

module.exports = { analysisSchema, actionItemSchema };
