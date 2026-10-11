const crypto = require('crypto');
const { env } = require('../config/env');

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

const getKey = () => {
  if (!env.encryptionSecret) throw new Error('ENCRYPTION_SECRET is not set');
  return crypto.createHash('sha256').update(String(env.encryptionSecret)).digest();
};

// เข้ารหัสเป็นสตริง enc:v1:<iv>:<authTag>:<data> — ล้มเหลวแล้ว throw ไม่คืนค่า plaintext
const encryptSecret = (plain) => {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = cipher.update(String(plain), 'utf8', 'hex') + cipher.final('hex');
  return `${PREFIX}${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted}`;
};

// คืน null เมื่อถอดรหัสไม่ได้ (เช่น ENCRYPTION_SECRET เปลี่ยน) ให้ผู้เรียกจัดการเป็นกรณีต้องเชื่อมใหม่
const decryptSecret = (stored) => {
  if (!stored || !String(stored).startsWith(PREFIX)) return null;
  const [ivHex, tagHex, data] = String(stored).slice(PREFIX.length).split(':');
  if (!ivHex || !tagHex || !data) return null;
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(data, 'hex', 'utf8') + decipher.final('utf8');
  } catch {
    return null;
  }
};

module.exports = { encryptSecret, decryptSecret };
