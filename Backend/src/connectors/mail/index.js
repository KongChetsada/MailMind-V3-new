// เลือกตัวเชื่อมอีเมลตามผู้ให้บริการของบัญชี
//
// สัญญาของตัวเชื่อมอีเมล (ทุกเจ้าต้องมีครบ):
//   listMessageIdsSince({ since: Date, maxMessages }) -> { ids: string[], truncated: boolean }
//   getMessageMeta(id) -> { providerMessageId, providerThreadId, fromName, fromAddress,
//                           subject, snippet, receivedAt: Date, isRead, labels: string[] }
//   getThread(threadId) -> [{ id, from, subject, date, receivedAt, text, html, isRead }]
//   sendReply({ threadId, inReplyToMessageId, body }) -> { id }
//   markRead(messageId)
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
