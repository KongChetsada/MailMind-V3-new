const express = require('express');
const { z } = require('zod');
const { validate } = require('../../middlewares/errorHandler');
const { getOrGenerateSummary } = require('./summary.service');
const { getStats } = require('./stats.service');

const router = express.Router();

const summaryQuery = z.object({
  type: z.preprocess((v) => String(v || 'DAILY').toUpperCase(), z.enum(['DAILY', 'WEEKLY', 'MONTHLY'])),
  force: z.preprocess((v) => v === 'true' || v === true, z.boolean()).default(false),
});
const statsQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

// GET /api/summary?type=DAILY&force=false — สรุปตารางงานด้วย AI (มีแคชต่อช่วงเวลา)
router.get('/', validate(summaryQuery, 'query'), async (req, res) => {
  const { type, force } = req.valid.query;
  res.json(await getOrGenerateSummary(req.user.id, type, force));
});

// GET /api/summary/stats?days=30 — สถิติการใช้งาน
router.get('/stats', validate(statsQuery, 'query'), async (req, res) => {
  res.json(await getStats(req.user.id, req.valid.query.days));
});

module.exports = router;
