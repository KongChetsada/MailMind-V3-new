// สิ่งที่ workflow ต้องใช้จากภายนอก รวมไว้ที่เดียวเพื่อให้แทนที่ได้ตอนทดสอบ
// workflow ทุกตัวรับ deps เป็นอาร์กิวเมนต์สุดท้าย (ค่าเริ่มต้นคือของจริง)
const { createLogger } = require('../utils/logger');

let cached = null;

const createDefaultDeps = () => {
  const prisma = require('../config/prisma');
  const { getMailConnector } = require('../connectors/mail');
  const { getCalendarConnector } = require('../connectors/calendar');
  const { getAiClientForUser } = require('../connectors/ai');
  const { embed, embeddingModel } = require('../connectors/ai/embeddings');
  return {
    embed,
    embeddingModel,
    prisma,
    getMail: (account) => getMailConnector(account),
    getCalendar: (account) => getCalendarConnector(account),
    getAi: (userId) => getAiClientForUser(prisma, userId),
    now: () => new Date(),
    logger: createLogger('WORKFLOW'),
  };
};

const getDeps = () => {
  if (!cached) cached = createDefaultDeps();
  return cached;
};

/** แทนที่บางส่วน (เช่น ตัวเชื่อมจำลอง) — ใช้ในการทดสอบและโหมดสาธิต */
const overrideDeps = (overrides) => {
  cached = { ...getDeps(), ...overrides };
  return cached;
};

module.exports = { getDeps, createDefaultDeps, overrideDeps };
