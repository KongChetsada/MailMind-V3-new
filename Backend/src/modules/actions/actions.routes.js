const express = require('express');
const { z } = require('zod');
const prisma = require('../../config/prisma');
const { validate } = require('../../middlewares/errorHandler');
const { toActionDto } = require('../emails/emails.service');
const { updateActionItem, confirmActionItem, dismissActionItem } = require('../../workflows/actionItems');

const router = express.Router();

const isoOrNull = z.union([z.string().datetime({ offset: true }), z.null()]);
const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  startAt: isoOrNull.optional(),
  endAt: isoOrNull.optional(),
  isAllDay: z.boolean().optional(),
  // จำนวนวันติดกันที่กิจกรรมเกิดในช่วงเวลาเดิม (1 = ครั้งเดียว)
  repeatDays: z.number().int().min(1).max(31).optional(),
  location: z.union([z.string().max(300), z.null()]).optional(),
});
const confirmSchema = z.object({
  force: z.boolean().default(false),
  inviteSender: z.boolean().default(false),
  // CREATE = สร้างกิจกรรมใหม่ · UPDATE_RELATED = แก้กิจกรรมเดิมในเธรดที่รายการนี้ผูกอยู่
  mode: z.enum(['CREATE', 'UPDATE_RELATED']).default('CREATE'),
});
const listQuery = z.object({ status: z.enum(['SUGGESTED', 'CREATED', 'FAILED', 'DISMISSED']).default('SUGGESTED') });

// GET /api/actions — รายการลงปฏิทินของผู้ใช้ (หน้าปฏิทินใช้แสดงรายการที่รอยืนยัน)
router.get('/', validate(listQuery, 'query'), async (req, res) => {
  const items = await prisma.actionItem.findMany({
    where: { status: req.valid.query.status, email: { mailAccount: { userId: req.user.id }, removedAt: null } },
    orderBy: { startAt: 'asc' },
    take: 200,
    include: { email: { select: { subject: true } }, relatedAction: true },
  });
  res.json({ items: items.map((a) => ({ ...toActionDto(a), emailSubject: a.email.subject })) });
});

// PUT /api/actions/:id — แก้รายละเอียด แล้วตรวจตารางใหม่
router.put('/:id', validate(updateSchema), async (req, res) => {
  res.json({ action: toActionDto(await updateActionItem(req.user.id, req.params.id, req.valid.body)) });
});

// POST /api/actions/:id/confirm — บันทึกลงปฏิทิน: สร้างใหม่ หรือแก้กิจกรรมเดิมที่ผูกไว้ (ไม่ส่งอีเมล)
router.post('/:id/confirm', validate(confirmSchema), async (req, res) => {
  res.json({ action: toActionDto(await confirmActionItem(req.user.id, req.params.id, req.valid.body)) });
});

// POST /api/actions/:id/dismiss — ไม่สนใจรายการนี้
router.post('/:id/dismiss', async (req, res) => {
  res.json({ action: toActionDto(await dismissActionItem(req.user.id, req.params.id)) });
});

module.exports = router;
