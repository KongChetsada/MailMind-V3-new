const express = require('express');
const { requireActiveAccount } = require('../accounts/accounts.service');
const { getDeps } = require('../../workflows/deps');

const router = express.Router();
const DAY_MS = 24 * 60 * 60 * 1000;

// GET /api/calendar — กิจกรรมย้อนหลัง 1 เดือนถึงล่วงหน้า 2 เดือน
router.get('/', async (req, res) => {
  const account = await requireActiveAccount(req.user.id);
  const now = Date.now();
  const items = await getDeps().getCalendar(account).listEvents({
    timeMin: new Date(now - 31 * DAY_MS),
    timeMax: new Date(now + 62 * DAY_MS),
  });
  res.json({ items });
});

module.exports = router;
