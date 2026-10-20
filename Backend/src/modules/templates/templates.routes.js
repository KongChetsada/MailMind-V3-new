const express = require('express');
const { z } = require('zod');
const prisma = require('../../config/prisma');
const { validate } = require('../../middlewares/errorHandler');
const { notFound } = require('../../utils/httpError');
const { CATEGORY_CODES, REPLY_INTENTS, effectiveCategory } = require('../../core/categories');
const { ensureDefaultTemplates, findTemplate } = require('../../workflows/replyTemplates');
const { pickIntent } = require('../../workflows/generateDraft');
const { findOwnedEmail } = require('../emails/emails.service');

const router = express.Router();

const toDto = (t) => ({
  id: t.id,
  name: t.name,
  category: t.category,
  intent: t.intent,
  whenToUse: t.whenToUse,
  body: t.body,
  isActive: t.isActive,
  hasEmbedding: Boolean(t.embedding?.length),
  updatedAt: t.updatedAt,
});

const nullableEnum = (values) => z.union([z.enum(values), z.null()]);
// แก้ไข: ส่งเฉพาะฟิลด์ที่เปลี่ยน — ห้ามมีค่าเริ่มต้น ไม่งั้นฟิลด์ที่ไม่ได้ส่งจะถูกเขียนทับ
const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  category: nullableEnum(CATEGORY_CODES).optional(),
  intent: nullableEnum(REPLY_INTENTS).optional(),
  whenToUse: z.union([z.string().trim().max(500), z.null()]).optional(),
  body: z.string().trim().min(1).max(4000).optional(),
  isActive: z.boolean().optional(),
});
const bodySchema = patchSchema.extend({
  name: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(4000),
  category: nullableEnum(CATEGORY_CODES).default(null),
  intent: nullableEnum(REPLY_INTENTS).default(null),
});
const previewSchema = z.object({ emailId: z.string().min(1), intent: z.enum(REPLY_INTENTS).optional() });

const findOwned = async (userId, id) => {
  const template = await prisma.replyTemplate.findFirst({ where: { id, userId } });
  if (!template) throw notFound('ไม่พบ template นี้');
  return template;
};

// เนื้อหาเปลี่ยน → ล้าง embedding เดิม ระบบคำนวณใหม่ตอนค้นหาครั้งถัดไป
const textChanged = (data) => ['name', 'whenToUse', 'body'].some((k) => k in data);

// GET /api/templates — template ทั้งหมดของผู้ใช้ (สร้างชุดตัวอย่างให้ครั้งแรก)
router.get('/', async (req, res) => {
  await ensureDefaultTemplates(req.user.id);
  const items = await prisma.replyTemplate.findMany({
    where: { userId: req.user.id },
    orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
  });
  res.json({ items: items.map(toDto) });
});

// POST /api/templates
router.post('/', validate(bodySchema), async (req, res) => {
  const created = await prisma.replyTemplate.create({ data: { userId: req.user.id, ...req.valid.body } });
  res.status(201).json({ template: toDto(created) });
});

// PUT /api/templates/:id — แก้บางฟิลด์ได้ (เช่น เปิด/ปิดอย่างเดียว)
router.put('/:id', validate(patchSchema), async (req, res) => {
  await findOwned(req.user.id, req.params.id);
  const data = req.valid.body;
  const updated = await prisma.replyTemplate.update({
    where: { id: req.params.id },
    data: { ...data, ...(textChanged(data) ? { embedding: [], embeddingModel: null } : {}) },
  });
  res.json({ template: toDto(updated) });
});

// DELETE /api/templates/:id — ร่างที่เคยอิง template นี้ยังอยู่ (templateId ถูกล้าง)
router.delete('/:id', async (req, res) => {
  await findOwned(req.user.id, req.params.id);
  await prisma.replyTemplate.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// POST /api/templates/preview — template ที่ระบบจะเลือกให้อีเมลนี้ (ดูผลการค้นหาโดยไม่ต้องร่างจริง)
router.post('/preview', validate(previewSchema), async (req, res) => {
  const email = await findOwnedEmail(req.user.id, req.valid.body.emailId, { actionItems: { orderBy: { startAt: 'asc' } } });
  const category = effectiveCategory(email) || 'OTHER';
  const primaryEvent = email.actionItems.find((i) => i.kind === 'EVENT' && i.status !== 'DISMISSED') || null;
  const intent = pickIntent(req.valid.body.intent, category, primaryEvent);
  const match = await findTemplate({
    userId: req.user.id,
    category,
    intent,
    queryText: [email.subject, email.summary].filter(Boolean).join('\n'),
  });
  res.json({
    category,
    intent,
    match: match && { template: toDto(match.template), score: match.score, similarity: match.similarity, method: match.method, candidates: match.candidates },
  });
});

module.exports = router;
