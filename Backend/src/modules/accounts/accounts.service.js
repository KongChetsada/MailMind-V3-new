const prisma = require('../../config/prisma');
const { HttpError } = require('../../utils/httpError');

const toAccountDto = (a) => ({
  id: a.id,
  provider: a.provider,
  emailAddress: a.emailAddress,
  status: a.status,
  lastSyncAt: a.lastSyncAt,
  lastSyncError: a.lastSyncError,
});

const listAccounts = async (userId) => {
  const accounts = await prisma.mailAccount.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  return accounts.map(toAccountDto);
};

/** บัญชีอีเมลที่ใช้งานได้ของผู้ใช้ (รอบแรกมีหนึ่งบัญชีต่อผู้ใช้) */
const requireActiveAccount = async (userId) => {
  const accounts = await prisma.mailAccount.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  const active = accounts.find((a) => a.status === 'ACTIVE');
  if (active) return active;
  if (accounts.some((a) => a.status === 'NEEDS_REAUTH')) {
    throw new HttpError(401, 'REAUTH_REQUIRED', 'การเชื่อมต่อกับบัญชีอีเมลหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }
  throw new HttpError(400, 'NO_MAIL_ACCOUNT', 'ยังไม่ได้เชื่อมบัญชีอีเมล');
};

module.exports = { listAccounts, requireActiveAccount, toAccountDto };
