const { ZodError } = require('zod');
const { HttpError } = require('../utils/httpError');
const { createLogger } = require('../utils/logger');

const logger = createLogger('HTTP');

/** ตรวจข้อมูลขาเข้าด้วย zod schema — ผิดรูปแบบแล้วตอบ 400 */
const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) return next(result.error);
  req.valid = { ...(req.valid || {}), [source]: result.data };
  next();
};

const notFoundHandler = (_req, res) => res.status(404).json({ error: 'ไม่พบเส้นทางนี้', code: 'NOT_FOUND' });

// รูปแบบข้อผิดพลาดเดียวกันทุกเส้นทาง: { error, code, details? }
const errorHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return res.status(400).json({
      error: `ข้อมูลไม่ถูกต้อง: ${first?.path.join('.') || ''} ${first?.message || ''}`.trim(),
      code: 'BAD_REQUEST',
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
  }
  if (err?.code === 'REAUTH_REQUIRED') {
    return res.status(401).json({ error: err.message, code: 'REAUTH_REQUIRED' });
  }
  if (err?.name === 'AiError') {
    const status = err.code === 'AI_NOT_CONFIGURED' ? 400 : 502;
    return res.status(status).json({ error: err.message, code: err.code });
  }
  logger.error('UNHANDLED', `${req.method} ${req.originalUrl} failed`, err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ', code: 'INTERNAL_ERROR' });
};

module.exports = { validate, notFoundHandler, errorHandler };
