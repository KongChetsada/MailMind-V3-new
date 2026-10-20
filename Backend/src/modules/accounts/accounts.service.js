const prisma = require('../../config/prisma');
const { HttpError, notFound } = require('../../utils/httpError');

/** idle = ยังไม่เคยดึง · running · paused = หยุดไว้ ทำต่อได้ · done · failed */
const backfillStatus = (a) => {
  if (a.backfillDoneAt) return 'done';
  if (a.backfillStartedAt) return 'running';
  if (a.backfillError) return 'failed';
  return a.backfillCursor ? 'paused' : 'idle';
};

const toAccountDto = (a) => ({
  id: a.id,
  provider: a.provider,
  emailAddress: a.emailAddress,
  status: a.status,
  lastSyncAt: a.lastSyncAt,
  lastSyncError: a.lastSyncError,
  backfill: {
    status: backfillStatus(a),
    count: a.backfillCount,
    oldestAt: a.backfillCursor,
    error: a.backfillError,
  },
});

/** บัญชีอีเมลของผู้ใช้ตามรหัส (ของคนอื่น = ไม่พบ) */
const findOwnedAccount = async (userId, accountId) => {
  const account = await prisma.mailAccount.findFirst({ where: { id: accountId, userId } });
  if (!account) throw notFound('ไม่พบบัญชีอีเมลนี้');
  return account;
};

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

module.exports = { listAccounts, requireActiveAccount, findOwnedAccount, toAccountDto };
