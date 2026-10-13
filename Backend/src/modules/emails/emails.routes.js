const express = require('express');
const { z } = require('zod');
const prisma = require('../../config/prisma');
const { validate } = require('../../middlewares/errorHandler');
const { HttpError } = require('../../utils/httpError');
const { CATEGORY_CODES, REPLY_INTENTS } = require('../../core/categories');
const emails = require('./emails.service');
const { syncAccount } = require('../../workflows/syncAccount');
const { analyzeEmail } = require('../../workflows/analyzeEmail');
const { generateDraft } = require('../../workflows/generateDraft');
const { saveManualDraft } = require('../../workflows/sendDraft');
const { runAnalyzeJob } = require('../../jobs/analyzeJob');

const router = express.Router();

const listQuery = z.object({
  category: z.enum(CATEGORY_CODES).optional(),
  filter: z.enum(['has_draft', 'has_action', 'needs_reply', 'failed', 'unread']).optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

// GET /api/emails — รายการ Inbox จากฐานข้อมูล
router.get('/', validate(listQuery, 'query'), async (req, res) => {
  res.json(await emails.listEmails(req.user.id, req.valid.query));
});

// GET /api/emails/counts — ตัวนับสำหรับแถบประเภท
router.get('/counts', async (req, res) => {
  res.json(await emails.getCounts(req.user.id));
});

// POST /api/emails/sync — ซิงก์ทันที แล้วเริ่มวิเคราะห์เบื้องหลัง
router.post('/sync', async (req, res) => {
  const accounts = await prisma.mailAccount.findMany({ where: { userId: req.user.id } });
  if (accounts.some((a) => a.status === 'NEEDS_REAUTH') && !accounts.some((a) => a.status === 'ACTIVE')) {
    throw new HttpError(401, 'REAUTH_REQUIRED', 'การเชื่อมต่อกับบัญชีอีเมลหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }
  const results = [];
  for (const account of accounts.filter((a) => a.status === 'ACTIVE')) {
    results.push(await syncAccount(account.id));
  }
  runAnalyzeJob().catch(() => {});
  const total = (key) => results.reduce((sum, r) => sum + (r[key] || 0), 0);
  res.json({ results, created: total('created'), removed: total('removed'), restored: total('restored') });
});

// GET /api/emails/:id — รายละเอียด + เนื้อหาเธรด
router.get('/:id', async (req, res) => {
  res.json(await emails.getEmailDetail(req.user.id, req.params.id));
});

const patchBody = z.object({
  userCategory: z.enum(CATEGORY_CODES).optional(),
  isRead: z.literal(true).optional(),
});

// PATCH /api/emails/:id — แก้ประเภท / ทำเครื่องหมายอ่านแล้ว
router.patch('/:id', validate(patchBody), async (req, res) => {
  res.json(await emails.updateEmail(req.user.id, req.params.id, req.valid.body));
});

// POST /api/emails/:id/analyze — วิเคราะห์ใหม่ตามคำสั่งผู้ใช้
router.post('/:id/analyze', async (req, res) => {
  await emails.findOwnedEmail(req.user.id, req.params.id);
  const result = await analyzeEmail(req.params.id, { force: true });
  if (!result.claimed) throw new HttpError(409, 'ANALYSIS_IN_PROGRESS', 'อีเมลนี้กำลังถูกวิเคราะห์อยู่');
  if (!result.ok) {
    const status = result.code === 'AI_NOT_CONFIGURED' ? 400 : result.code === 'REAUTH_REQUIRED' ? 401 : 502;
    throw new HttpError(status, result.code || 'ANALYSIS_FAILED', `วิเคราะห์ไม่สำเร็จ: ${result.error}`);
  }
  res.json(await emails.getEmailDetail(req.user.id, req.params.id));
});

const draftBody = z.object({
  intent: z.enum(REPLY_INTENTS).optional(),
  body: z.string().max(20000).optional(), // ส่ง body = เขียนเองโดยไม่ใช้ AI
});

// POST /api/emails/:id/draft — สร้างร่าง (ด้วย AI หรือเขียนเอง)
router.post('/:id/draft', validate(draftBody), async (req, res) => {
  await emails.findOwnedEmail(req.user.id, req.params.id);
  const { intent, body } = req.valid.body;
  const draft = body
    ? await saveManualDraft(req.user.id, req.params.id, body)
    : await generateDraft(req.params.id, { intent });
  res.json({ draft: emails.toDraftDto(draft) });
});

module.exports = router;
