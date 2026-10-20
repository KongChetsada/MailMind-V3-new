// เลือกตัวเชื่อมอีเมลตามผู้ให้บริการของบัญชี
//
// สัญญาของตัวเชื่อมอีเมล (ทุกเจ้าต้องมีครบ):
//   listMessageIdsSince({ since: Date, maxMessages }) -> { ids: string[], truncated: boolean }
//   getMessageMeta(id) -> { providerMessageId, providerThreadId, fromName, fromAddress,
//                           subject, snippet, receivedAt: Date, isRead, labels: string[] }
//   getThread(threadId, { inlineImages? }) -> [{ id, from, subject, date, receivedAt, text, html, isRead }]
//     inlineImages = true: ฝังรูปที่แนบในเนื้อเมล (cid:) ลงใน html เป็น data URI (ตัวเชื่อมที่ทำไม่ได้ละเลยได้)
//   sendReply({ threadId, inReplyToMessageId, body }) -> { id }
//   markRead(messageId)
// ไม่บังคับ (ถ้าไม่มี ระบบข้ามการตามการลบฝั่งผู้ให้บริการ):
//   getChangeCursor() -> string
//   getChanges({ cursor }) -> { cursor, removedIds, restoredIds, readIds, unreadIds, expired }
//   listRemovedIds({ days }) -> string[]
// ไม่บังคับ (ถ้าไม่มี ระบบข้ามการแจ้งเตือนนัดหมายทางอีเมล):
//   listMessageIdsBefore({ before: Date, maxMessages }) -> { ids }   ใหม่สุดก่อน (ถ้าไม่มี ดึงอีเมลย้อนหลังไม่ได้)
//   sendNotification({ to, subject, html }) -> { id }
// ไม่บังคับ (ถ้าไม่มี หน้าเว็บแสดงรายการไฟล์แนบแต่เปิดไม่ได้):
//   getThread คืน attachments: [{ partId, filename, mimeType, size }] ต่อข้อความ
//   getAttachment(messageId, partId) -> { threadId, filename, mimeType, data: Buffer } | null   ส่งอีเมลฉบับใหม่ (ไม่อยู่ในเธรดใด)
//
// เพิ่มผู้ให้บริการใหม่: เขียนไฟล์ในโฟลเดอร์นี้ แล้วลงทะเบียนใน FACTORIES
const { createGmailConnector } = require('./gmail');
const { env } = require('../../config/env');
const { isDemoAccount, demoMail } = require('../demo');

const FACTORIES = {
  GOOGLE: createGmailConnector,
  // MICROSOFT: createOutlookConnector,  (รอบสอง)
};

const getMailConnector = (account) => {
  if (env.demoMode && isDemoAccount(account)) return demoMail;
  const factory = FACTORIES[account?.provider];
  if (!factory) throw new Error(`ยังไม่รองรับผู้ให้บริการอีเมล: ${account?.provider}`);
  return factory(account);
};

module.exports = { getMailConnector };
