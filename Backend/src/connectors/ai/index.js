// ตัวเชื่อม AI — ทุกผู้ให้บริการถูกเรียกผ่าน API แบบ OpenAI ด้วยโค้ดชุดเดียว
//
// สัญญาของ AI client:
//   complete({ system, user, temperature, json }) -> { text, usage, finishReason }
//   listModels() -> [{ id }]
//   ping() -> true (หรือ throw AiError)
//
// ไม่มีการสลับผู้ให้บริการอัตโนมัติ: ถ้าเจ้าที่ผู้ใช้เลือกล้มเหลว คำขอนั้นล้มเหลว
const { OpenAI } = require('openai');
const { getProvider, DEFAULT_PROVIDER } = require('./providers');
const { decryptSecret } = require('../../utils/encryption');

class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AiError';
    this.code = code; // AI_NOT_CONFIGURED | AI_UNREACHABLE | AI_REQUEST_FAILED
  }
}

const toAiError = (error, provider) => {
  if (error instanceof AiError) return error;
  const msg = String(error?.message || error);
  // หมดเวลา ≠ เชื่อมต่อไม่ได้: โมเดลในเครื่องที่รับงานพร้อมกันหลายคำขอจะตอบช้าจนเกินกำหนด
  if (/timed out|timeout/i.test(msg)) {
    return new AiError(
      'AI_UNREACHABLE',
      provider.isLocal
        ? 'Ollama ตอบช้าเกินกำหนด (อาจกำลังประมวลผลหลายคำขอพร้อมกัน) กรุณาลองใหม่'
        : `${provider.label} ตอบช้าเกินกำหนด กรุณาลองใหม่`
    );
  }
  const unreachable = error?.code === 'ECONNREFUSED' || /ECONNREFUSED|Connection error|fetch failed/i.test(msg);
  if (unreachable) {
    return new AiError(
      'AI_UNREACHABLE',
      provider.isLocal
        ? 'เชื่อมต่อ Ollama ไม่ได้ กรุณาตรวจสอบว่าเปิด Ollama อยู่'
        : `เชื่อมต่อ ${provider.label} ไม่ได้ หรือใช้เวลานานเกินกำหนด`
    );
  }
  const status = error?.status;
  if (status === 401 || status === 403) return new AiError('AI_REQUEST_FAILED', `API key ของ ${provider.label} ไม่ถูกต้องหรือไม่มีสิทธิ์`);
  if (status === 404) return new AiError('AI_REQUEST_FAILED', `ไม่พบโมเดลที่เลือกใน ${provider.label}`);
  if (status === 429) return new AiError('AI_REQUEST_FAILED', `${provider.label} จำกัดจำนวนคำขอหรือโควตาหมด`);
  return new AiError('AI_REQUEST_FAILED', `${provider.label}: ${msg.slice(0, 200)}`);
};

const createAiClient = ({ provider: providerId, model, apiKey }) => {
  const provider = getProvider(providerId);
  if (!provider) throw new AiError('AI_NOT_CONFIGURED', `ไม่รู้จักผู้ให้บริการ AI: ${providerId}`);
  if (provider.requiresKey && !apiKey) {
    throw new AiError('AI_NOT_CONFIGURED', `ยังไม่ได้ตั้งค่า API key ของ ${provider.label}`);
  }
  const modelName = model || provider.defaultModel;

  const client = new OpenAI({
    baseURL: provider.baseUrl,
    apiKey: apiKey || 'not-required',
    timeout: provider.timeoutMs,
    maxRetries: provider.isLocal ? 0 : 1,
  });

  return {
    provider: providerId,
    model: modelName,
    isLocal: provider.isLocal,

    async complete({ system, user, temperature = 0.2, json = false }) {
      if (!modelName) throw new AiError('AI_NOT_CONFIGURED', `ยังไม่ได้เลือกโมเดลของ ${provider.label}`);
      try {
        const res = await client.chat.completions.create({
          model: modelName,
          temperature,
          ...(json && provider.jsonMode ? { response_format: { type: 'json_object' } } : {}),
          messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }],
        });
        return {
          text: res.choices?.[0]?.message?.content || '',
          usage: res.usage || null,
          finishReason: res.choices?.[0]?.finish_reason || null,
        };
      } catch (error) {
        throw toAiError(error, provider);
      }
    },

    async listModels() {
      try {
        const list = await client.models.list();
        return (list.data || []).map((m) => ({ id: m.id })).sort((a, b) => a.id.localeCompare(b.id));
      } catch (error) {
        throw toAiError(error, provider);
      }
    },

    async ping() {
      await this.complete({ user: 'Reply with the single word OK.', temperature: 0 });
      return true;
    },
  };
};

/** สร้าง AI client ตามการตั้งค่าของผู้ใช้ (อ่าน API key ที่เข้ารหัสไว้) */
const getAiClientForUser = async (prisma, userId) => {
  const setting = await prisma.userSetting.findUnique({ where: { userId } });
  const providerId = setting?.aiProvider || DEFAULT_PROVIDER;
  const provider = getProvider(providerId);
  if (!provider) throw new AiError('AI_NOT_CONFIGURED', `ไม่รู้จักผู้ให้บริการ AI: ${providerId}`);

  let apiKey = null;
  if (provider.requiresKey) {
    const credential = await prisma.aiCredential.findUnique({
      where: { userId_provider: { userId, provider: providerId } },
    });
    apiKey = decryptSecret(credential?.encryptedKey);
  }
  return createAiClient({ provider: providerId, model: setting?.aiModel, apiKey });
};

module.exports = { AiError, createAiClient, getAiClientForUser };
