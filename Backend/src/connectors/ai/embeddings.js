// เวกเตอร์ความหมายของข้อความ (ใช้ค้นหา template ตอบกลับ)
// ใช้ Ollama ในเครื่องเสมอ ไม่ขึ้นกับผู้ให้บริการแชตที่เลือก — ข้อความไม่ถูกส่งออกนอกเครื่องเพิ่ม
// เชื่อมไม่ได้หรือยังไม่ได้ติดตั้งโมเดล → คืน null แล้วผู้เรียกค้นด้วยคำแทน (ไม่ทำให้การร่างล้ม)
const { OpenAI } = require('openai');
const { env } = require('../../config/env');

const TIMEOUT_MS = 30_000;
let client = null;

const embeddingModel = () => env.localAi.embeddingModel || null;

/** texts: string[] → number[][] หรือ null เมื่อใช้ไม่ได้ */
const embed = async (texts) => {
  const model = embeddingModel();
  if (!model || !texts.length) return null;
  client = client || new OpenAI({ baseURL: env.localAi.baseUrl, apiKey: 'not-required', timeout: TIMEOUT_MS, maxRetries: 0 });
  try {
    const res = await client.embeddings.create({ model, input: texts });
    const vectors = (res.data || []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
    return vectors.length === texts.length && vectors.every((v) => Array.isArray(v) && v.length) ? vectors : null;
  } catch {
    return null;
  }
};

module.exports = { embed, embeddingModel };
