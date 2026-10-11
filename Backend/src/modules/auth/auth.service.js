const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { google } = require('googleapis');
const prisma = require('../../config/prisma');
const { env } = require('../../config/env');
const { createOAuthClient, SCOPES } = require('../../connectors/google/client');
const { encryptSecret } = require('../../utils/encryption');
const { signUserToken } = require('../../middlewares/auth');
const { DEMO_ACCOUNT_PREFIX } = require('../../connectors/demo');

// state ที่เซ็นแล้ว ป้องกันการปลอม callback
const createState = () => jwt.sign({ n: crypto.randomBytes(8).toString('hex') }, env.jwtSecret, { expiresIn: '10m' });
const verifyState = (state) => {
  try {
    jwt.verify(String(state || ''), env.jwtSecret);
    return true;
  } catch {
    return false;
  }
};

const buildGoogleAuthUrl = () =>
  createOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state: createState(),
  });

/**
 * แลก code เป็น token → บันทึกผู้ใช้และบัญชีอีเมล → คืน JWT ของระบบ
 * การเข้าสู่ระบบด้วย Google เท่ากับการเชื่อมกล่อง Gmail ของบัญชีนั้น
 */
const completeGoogleLogin = async (code) => {
  const oauth = createOAuthClient();
  const { tokens } = await oauth.getToken(code);
  oauth.setCredentials(tokens);
  const { data: profile } = await google.oauth2({ auth: oauth, version: 'v2' }).userinfo.get();
  if (!profile.email) throw new Error('Google did not return an email address');

  const user = await prisma.user.upsert({
    where: { email: profile.email },
    update: { name: profile.name, picture: profile.picture },
    create: { email: profile.email, name: profile.name, picture: profile.picture, setting: { create: {} } },
  });
  await prisma.userSetting.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });

  const tokenData = {
    accessToken: encryptSecret(tokens.access_token),
    // Google ส่ง refresh token เฉพาะตอนให้สิทธิ์ครั้งแรกหรือเมื่อ prompt=consent
    ...(tokens.refresh_token ? { refreshToken: encryptSecret(tokens.refresh_token) } : {}),
  };
  const account = await prisma.mailAccount.upsert({
    where: { provider_providerAccountId: { provider: 'GOOGLE', providerAccountId: String(profile.id) } },
    update: { userId: user.id, emailAddress: profile.email, status: 'ACTIVE', lastSyncError: null, ...tokenData },
    create: {
      userId: user.id,
      provider: 'GOOGLE',
      providerAccountId: String(profile.id),
      emailAddress: profile.email,
      ...tokenData,
    },
  });

  return { token: signUserToken(user), user, account };
};

/** โหมดสาธิต: สร้างผู้ใช้และบัญชีตัวอย่าง (ไม่ผูกกับ Google) */
const loginDemoUser = async () => {
  const email = 'demo@mailmind.local';
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: 'ผู้ใช้สาธิต', setting: { create: { firstName: 'สมชาย', lastName: 'ตัวอย่าง', gender: 'MALE' } } },
  });
  await prisma.mailAccount.upsert({
    where: { provider_providerAccountId: { provider: 'GOOGLE', providerAccountId: `${DEMO_ACCOUNT_PREFIX}${user.id}` } },
    update: { status: 'ACTIVE' },
    create: { userId: user.id, provider: 'GOOGLE', providerAccountId: `${DEMO_ACCOUNT_PREFIX}${user.id}`, emailAddress: email },
  });
  return { token: signUserToken(user), user };
};

const getUserProfile = async (userId) =>
  prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, picture: true } });

module.exports = { buildGoogleAuthUrl, verifyState, completeGoogleLogin, loginDemoUser, getUserProfile };
