const express = require('express');
const { z } = require('zod');
const { validate } = require('../../middlewares/errorHandler');
const { toDraftDto } = require('../emails/emails.service');
const { sendDraft, updateDraftBody, discardDraft } = require('../../workflows/sendDraft');

const router = express.Router();
const bodySchema = z.object({ body: z.string().min(1).max(20000) });
const sendSchema = z.object({ body: z.string().max(20000).optional() });

// PUT /api/drafts/:id — บันทึกข้อความที่แก้
router.put('/:id', validate(bodySchema), async (req, res) => {
  res.json({ draft: toDraftDto(await updateDraftBody(req.user.id, req.params.id, req.valid.body.body)) });
});

// POST /api/drafts/:id/send — ส่งอีเมลตอบกลับ (ไม่แตะปฏิทิน)
router.post('/:id/send', validate(sendSchema), async (req, res) => {
  res.json({ draft: toDraftDto(await sendDraft(req.user.id, req.params.id, req.valid.body)) });
});

// POST /api/drafts/:id/discard — ทิ้งร่าง
router.post('/:id/discard', async (req, res) => {
  res.json({ draft: toDraftDto(await discardDraft(req.user.id, req.params.id)) });
});

module.exports = router;
