// ประกอบ Express app — ไม่เริ่มฟังพอร์ตและไม่เริ่มงานเบื้องหลัง (ดู server.js)
const express = require('express');
const cors = require('cors');
const { env } = require('./config/env');
const { requireAuth } = require('./middlewares/auth');
const { notFoundHandler, errorHandler } = require('./middlewares/errorHandler');

const { authRouter, userRouter } = require('./modules/auth/auth.routes');
const accountsRouter = require('./modules/accounts/accounts.routes');
const emailsRouter = require('./modules/emails/emails.routes');
const draftsRouter = require('./modules/drafts/drafts.routes');
const actionsRouter = require('./modules/actions/actions.routes');
const calendarRouter = require('./modules/calendar/calendar.routes');
const summaryRouter = require('./modules/summary/summary.routes');
const settingsRouter = require('./modules/settings/settings.routes');
const templatesRouter = require('./modules/templates/templates.routes');

const createApp = () => {
  const app = express();
  const allowedOrigins = [...new Set([env.frontendUrl, 'http://localhost:3000'])];

  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'MailMind Backend', version: 3, demoMode: env.demoMode, uptimeSeconds: Math.floor(process.uptime()) });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/user', userRouter);

  // ทุกเส้นทางด้านล่างต้องเข้าสู่ระบบ
  app.use('/api/accounts', requireAuth, accountsRouter);
  app.use('/api/emails', requireAuth, emailsRouter);
  app.use('/api/drafts', requireAuth, draftsRouter);
  app.use('/api/actions', requireAuth, actionsRouter);
  app.use('/api/calendar', requireAuth, calendarRouter);
  app.use('/api/summary', requireAuth, summaryRouter);
  app.use('/api/settings', requireAuth, settingsRouter);
  app.use('/api/templates', requireAuth, templatesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

module.exports = { createApp };
