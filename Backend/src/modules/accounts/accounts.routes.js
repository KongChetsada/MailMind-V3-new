const express = require('express');
const prisma = require('../../config/prisma');
const { HttpError } = require('../../utils/httpError');
const { listAccounts, findOwnedAccount, toAccountDto } = require('./accounts.service');
const { startBackfill, stopBackfill } = require('../../jobs/backfillJob');

const router = express.Router();

// GET /api/accounts — บัญชีอีเมลที่เชื่อม สถานะการเชื่อมต่อ และความคืบหน้าการดึงย้อนหลัง
router.get('/', async (req, res) => {
  res.json({ items: await listAccounts(req.user.id) });
});

// POST /api/accounts/:id/backfill — เริ่มหรือทำต่อการดึงอีเมลย้อนหลังทั้งหมด (ทำในเบื้องหลัง)
router.post('/:id/backfill', async (req, res) => {
  const account = await findOwnedAccount(req.user.id, req.params.id);
  if (account.status !== 'ACTIVE') {
    throw new HttpError(401, 'REAUTH_REQUIRED', 'การเชื่อมต่อกับบัญชีอีเมลหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }
  await startBackfill(account.id);
  const fresh = await prisma.mailAccount.findUnique({ where: { id: account.id } });
  res.status(202).json({ account: toAccountDto(fresh) });
});

// POST /api/accounts/:id/backfill/stop — หยุดหลังจบช่วงที่กำลังดึง (กดทำต่อได้)
router.post('/:id/backfill/stop', async (req, res) => {
  const account = await findOwnedAccount(req.user.id, req.params.id);
  await stopBackfill(account.id);
  const fresh = await prisma.mailAccount.findUnique({ where: { id: account.id } });
  res.json({ account: toAccountDto(fresh) });
});

module.exports = router;
