const prisma = require('../../config/prisma');
const { badRequest } = require('../../utils/httpError');
const { encryptSecret, decryptSecret } = require('../../utils/encryption');
const { listProviders, getProvider } = require('../../connectors/ai/providers');
const { createAiClient } = require('../../connectors/ai');

const getSettings = async (userId) => {
  const [setting, credentials] = await Promise.all([
    prisma.userSetting.upsert({ where: { userId }, update: {}, create: { userId } }),
    prisma.aiCredential.findMany({ where: { userId }, select: { provider: true } }),
  ]);
  const withKey = new Set(credentials.map((c) => c.provider));
  return {
    setting,
    // ไม่ส่ง API key กลับไปที่หน้าเว็บ บอกแค่ว่าตั้งค่าแล้วหรือยัง
    providers: listProviders().map((p) => ({ ...p, hasKey: !p.requiresKey || withKey.has(p.id) })),
  };
};

const updateSettings = async (userId, data) => {
  if (data.aiProvider) {
    const provider = getProvider(data.aiProvider);
    if (!provider) throw badRequest('ไม่รู้จักผู้ให้บริการ AI นี้');
    if (provider.requiresKey) {
      const credential = await prisma.aiCredential.findUnique({
        where: { userId_provider: { userId, provider: data.aiProvider } },
      });
      if (!credential) throw badRequest(`กรุณาบันทึก API key ของ ${provider.label} ก่อนเลือกใช้`);
    }
  }
  await prisma.userSetting.upsert({ where: { userId }, update: data, create: { userId, ...data } });
  return getSettings(userId);
};

const saveAiKey = async (userId, providerId, apiKey) => {
  const provider = getProvider(providerId);
  if (!provider || !provider.requiresKey) throw badRequest('ผู้ให้บริการนี้ไม่ต้องใช้ API key');
  const encryptedKey = encryptSecret(apiKey.trim());
  await prisma.aiCredential.upsert({
    where: { userId_provider: { userId, provider: providerId } },
    update: { encryptedKey },
    create: { userId, provider: providerId, encryptedKey },
  });
};

/** ลบ key — ถ้าเป็นเจ้าที่กำลังใช้อยู่ ให้กลับไปใช้ Ollama เพื่อไม่ให้การวิเคราะห์ค้างในสถานะตั้งค่าไม่ครบ */
const deleteAiKey = async (userId, providerId) => {
  await prisma.aiCredential.deleteMany({ where: { userId, provider: providerId } });
  await prisma.userSetting.updateMany({
    where: { userId, aiProvider: providerId },
    data: { aiProvider: 'ollama', aiModel: null },
  });
};

/** สร้าง client สำหรับทดสอบหรือดูรายชื่อโมเดล: ใช้ key ที่ส่งมา ถ้าไม่มีใช้ key ที่บันทึกไว้ */
const clientFor = async (userId, { provider, model, apiKey }) => {
  const info = getProvider(provider);
  if (!info) throw badRequest('ไม่รู้จักผู้ให้บริการ AI นี้');
  let key = apiKey?.trim() || null;
  if (info.requiresKey && !key) {
    const credential = await prisma.aiCredential.findUnique({ where: { userId_provider: { userId, provider } } });
    key = decryptSecret(credential?.encryptedKey);
  }
  return createAiClient({ provider, model, apiKey: key });
};

const testAi = async (userId, input) => {
  const client = await clientFor(userId, input);
  await client.ping();
  return { ok: true, provider: client.provider, model: client.model };
};

const listAiModels = async (userId, provider) => {
  const client = await clientFor(userId, { provider });
  return client.listModels();
};

module.exports = { getSettings, updateSettings, saveAiKey, deleteAiKey, testAi, listAiModels };
