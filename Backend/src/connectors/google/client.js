// OAuth client ของ Google ใช้ร่วมกันระหว่างตัวเชื่อม Gmail และ Calendar
const { google } = require('googleapis');
const { env } = require('../../config/env');
const { decryptSecret } = require('../../utils/encryption');

const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar.events',
];

class ReauthRequiredError extends Error {
  constructor(message = 'การเชื่อมต่อกับ Google หมดอายุ กรุณาเข้าสู่ระบบใหม่') {
    super(message);
    this.name = 'ReauthRequiredError';
    this.code = 'REAUTH_REQUIRED';
  }
}

const createOAuthClient = (tokens) => {
  const client = new google.auth.OAuth2(env.google.clientId, env.google.clientSecret, env.google.redirectUri);
  if (tokens) client.setCredentials(tokens);
  return client;
};

/** OAuth client ของบัญชีอีเมลหนึ่งบัญชี (ถอดรหัส token จากฐานข้อมูล) */
const authClientForAccount = (account) => {
  const refreshToken = decryptSecret(account?.refreshToken);
  if (!refreshToken) throw new ReauthRequiredError();
  return createOAuthClient({
    refresh_token: refreshToken,
    access_token: decryptSecret(account.accessToken) || undefined,
  });
};

const isGoogleAuthError = (error) => {
  if (!error) return false;
  if (error instanceof ReauthRequiredError) return true;
  const msg = String(error.message || '').toLowerCase();
  const status = error.code || error.status || error.response?.status;
  return (
    status === 401 ||
    msg.includes('invalid_grant') ||
    msg.includes('invalid credentials') ||
    msg.includes('token has been expired')
  );
};

/** ห่อการเรียก Google API: ข้อผิดพลาดด้านสิทธิ์ทุกแบบกลายเป็น ReauthRequiredError แบบเดียว */
const withGoogleErrors = async (fn) => {
  try {
    return await fn();
  } catch (error) {
    if (isGoogleAuthError(error)) throw new ReauthRequiredError();
    throw error;
  }
};

module.exports = { SCOPES, ReauthRequiredError, createOAuthClient, authClientForAccount, isGoogleAuthError, withGoogleErrors };
