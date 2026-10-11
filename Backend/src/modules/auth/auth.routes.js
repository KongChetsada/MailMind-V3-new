const express = require('express');
const { env } = require('../../config/env');
const { requireAuth } = require('../../middlewares/auth');
const { unauthorized } = require('../../utils/httpError');
const { createLogger } = require('../../utils/logger');
const authService = require('./auth.service');
const { runSyncJob } = require('../../jobs/syncJob');

const logger = createLogger('AUTH');

// /api/auth
const authRouter = express.Router();

authRouter.get('/google', (_req, res) => res.redirect(authService.buildGoogleAuthUrl()));

authRouter.get('/google/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !authService.verifyState(state)) {
    return res.redirect(`${env.frontendUrl}/login?error=invalid_request`);
  }
  try {
    const { token } = await authService.completeGoogleLogin(String(code));
    runSyncJob().catch(() => {}); // ดึงอีเมลชุดแรกทันที ไม่ต้องรอรอบเวลา
    // ส่ง token ในส่วน # ของ URL เพื่อไม่ให้ติดไปกับ log ของเซิร์ฟเวอร์
    res.redirect(`${env.frontendUrl}/login-success#token=${token}`);
  } catch (error) {
    logger.error('LOGIN_FAILED', 'Google login failed', error);
    res.redirect(`${env.frontendUrl}/login?error=auth_failed`);
  }
});

// GET /api/auth/demo — เข้าสู่ระบบด้วยบัญชีตัวอย่าง (มีเฉพาะเมื่อ DEMO_MODE=true)
authRouter.get('/demo', async (_req, res) => {
  if (!env.demoMode) return res.status(404).json({ error: 'ไม่พบเส้นทางนี้', code: 'NOT_FOUND' });
  const { token } = await authService.loginDemoUser();
  runSyncJob().catch(() => {});
  res.redirect(`${env.frontendUrl}/login-success#token=${token}`);
});

// /api/user
const userRouter = express.Router();

userRouter.get('/me', requireAuth, async (req, res) => {
  const user = await authService.getUserProfile(req.user.id);
  if (!user) throw unauthorized();
  res.json({ user });
});

module.exports = { authRouter, userRouter };
