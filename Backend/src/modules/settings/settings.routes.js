const express = require('express');
const { z } = require('zod');
const { validate } = require('../../middlewares/errorHandler');
const { isValidTimeZone } = require('../../core/time');
const settings = require('./settings.service');
const { runAnalyzeJob } = require('../../jobs/analyzeJob');

const router = express.Router();

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'ต้องเป็นรูปแบบ HH:mm');
const optionalText = (max) => z.union([z.string().trim().max(max), z.null()]).optional();

// รับเฉพาะฟิลด์ที่อนุญาต — ฟิลด์อื่นใน body ถูกตัดทิ้ง
const settingsSchema = z
  .object({
    isAutoAnalyzeActive: z.boolean().optional(),
    notifyNewAppointments: z.boolean().optional(),
    aiProvider: z.string().max(40).optional(),
    aiModel: optionalText(120),
    startTime: time.optional(),
    endTime: time.optional(),
    workDays: z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])).min(1).optional(),
    timezone: z.string().refine(isValidTimeZone, 'timezone ไม่ถูกต้อง').optional(),
    firstName: optionalText(80),
    lastName: optionalText(80),
    gender: z.union([z.enum(['MALE', 'FEMALE', 'OTHER']), z.null()]).optional(),
    position: optionalText(120),
    signature: optionalText(500),
    tone: z.enum(['formal', 'casual']).optional(),
    theme: z.enum(['light', 'dark']).optional(),
  })
  .refine((d) => !(d.startTime && d.endTime) || d.startTime < d.endTime, 'เวลาเริ่มงานต้องอยู่ก่อนเวลาเลิกงาน');

const keySchema = z.object({ apiKey: z.string().trim().min(8).max(400) });
const testSchema = z.object({
  provider: z.string().max(40),
  model: z.string().max(120).optional(),
  apiKey: z.string().max(400).optional(),
});

// GET /api/settings
router.get('/', async (req, res) => {
  res.json(await settings.getSettings(req.user.id));
});

// PUT /api/settings
router.put('/', validate(settingsSchema), async (req, res) => {
  const result = await settings.updateSettings(req.user.id, req.valid.body);
  if (req.valid.body.isAutoAnalyzeActive) runAnalyzeJob().catch(() => {});
  res.json(result);
});

// PUT /api/settings/ai/keys/:provider — บันทึก API key (เข้ารหัสก่อนเก็บ)
router.put('/ai/keys/:provider', validate(keySchema), async (req, res) => {
  await settings.saveAiKey(req.user.id, req.params.provider, req.valid.body.apiKey);
  res.json(await settings.getSettings(req.user.id));
});

// DELETE /api/settings/ai/keys/:provider
router.delete('/ai/keys/:provider', async (req, res) => {
  await settings.deleteAiKey(req.user.id, req.params.provider);
  res.json(await settings.getSettings(req.user.id));
});

// POST /api/settings/ai/test — ทดสอบการเชื่อมต่อด้วยคำขอสั้น ๆ
router.post('/ai/test', validate(testSchema), async (req, res) => {
  res.json(await settings.testAi(req.user.id, req.valid.body));
});

// GET /api/settings/ai/models?provider=ollama
router.get('/ai/models', async (req, res) => {
  res.json({ models: await settings.listAiModels(req.user.id, String(req.query.provider || 'ollama')) });
});

module.exports = router;
