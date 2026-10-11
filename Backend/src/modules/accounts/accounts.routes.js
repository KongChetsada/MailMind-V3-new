const express = require('express');
const { listAccounts } = require('./accounts.service');

const router = express.Router();

// GET /api/accounts — บัญชีอีเมลที่เชื่อมและสถานะการเชื่อมต่อ
router.get('/', async (req, res) => {
  res.json({ items: await listAccounts(req.user.id) });
});

module.exports = router;
