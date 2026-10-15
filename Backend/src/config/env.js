// อ่านค่าจาก environment ที่เดียว ส่วนอื่นของระบบไม่อ่าน process.env เอง
const int = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const env = {
  isProduction: process.env.NODE_ENV === 'production',
  port: int(process.env.PORT, 5000),
  frontendUrl: (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  databaseUrl: process.env.DATABASE_URL,
  // จำนวนการเชื่อมต่อฐานข้อมูลสูงสุด (ไม่ตั้ง = ค่าเริ่มต้นของ pg) — ฐานข้อมูลทดสอบ `prisma dev` รองรับทีละการเชื่อมต่อ ต้องตั้งเป็น 1
  dbPoolMax: process.env.DB_POOL_MAX ? int(process.env.DB_POOL_MAX, 10) : undefined,
  jwtSecret: process.env.JWT_SECRET,
  encryptionSecret: process.env.ENCRYPTION_SECRET,
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  },
  localAi: {
    baseUrl: process.env.LOCAL_AI_BASE_URL || 'http://localhost:11434/v1',
    model: process.env.LOCAL_AI_MODEL || 'llama3.1:8b',
  },
  // โหมดสาธิต: ใช้อีเมลตัวอย่างแทน Gmail ไม่ต้องมี Google credentials (ห้ามเปิดในระบบที่ใช้งานจริง)
  demoMode: String(process.env.DEMO_MODE || 'false').toLowerCase() === 'true',
  jobs: {
    enabled: String(process.env.JOBS_ENABLED || 'true').toLowerCase() !== 'false',
    syncCron: process.env.SYNC_CRON || '*/10 * * * *',
    initialSyncDays: int(process.env.INITIAL_SYNC_DAYS, 7),
    syncMaxMessages: int(process.env.SYNC_MAX_MESSAGES, 300),
    analyzeConcurrency: int(process.env.ANALYZE_CONCURRENCY, 1),
    analyzeMaxAttempts: int(process.env.ANALYZE_MAX_ATTEMPTS, 3),
  },
};

// ค่าที่ขาดแล้วระบบทำงานต่ออย่างปลอดภัยไม่ได้
const assertRequiredEnv = () => {
  const missing = [
    ['DATABASE_URL', env.databaseUrl],
    ['JWT_SECRET', env.jwtSecret],
    ['ENCRYPTION_SECRET', env.encryptionSecret],
    ...(env.isProduction ? [
      ['FRONTEND_URL', process.env.FRONTEND_URL],
      ['GOOGLE_CLIENT_ID', env.google.clientId],
      ['GOOGLE_CLIENT_SECRET', env.google.clientSecret],
      ['GOOGLE_REDIRECT_URI', env.google.redirectUri],
    ] : []),
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (env.isProduction) {
    for (const [name, value, pathname] of [
      ['FRONTEND_URL', env.frontendUrl, '/'],
      ['GOOGLE_REDIRECT_URI', env.google.redirectUri, '/api/auth/google/callback'],
    ]) {
      let url;
      try { url = new URL(value); } catch { /* Report only the variable name, never its value. */ }
      if (!url || url.protocol !== 'https:' || url.pathname !== pathname || url.search || url.hash || url.username || url.password) {
        throw new Error(`${name} must be an HTTPS URL with path ${pathname} and no query, fragment or credentials`);
      }
    }
    for (const [name, value] of [['JWT_SECRET', env.jwtSecret], ['ENCRYPTION_SECRET', env.encryptionSecret]]) {
      if (value.trim().length < 32) throw new Error(`${name} must contain at least 32 characters in production`);
    }
    if (env.jwtSecret === env.encryptionSecret) throw new Error('JWT_SECRET and ENCRYPTION_SECRET must be different');
    if (env.demoMode) throw new Error('DEMO_MODE must be false in production');
  }
};

module.exports = { env, assertRequiredEnv };
