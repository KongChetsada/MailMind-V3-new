// ทะเบียนผู้ให้บริการ AI — เพิ่มเจ้าใหม่ที่มี API แบบ OpenAI ได้โดยเพิ่มรายการที่นี่ที่เดียว
//
// isLocal   : ข้อมูลไม่ออกจากเครื่อง/เครือข่ายของผู้ใช้
// jsonMode  : รองรับ response_format json_object (ถ้าไม่รองรับ ระบบยังแกะ JSON จากข้อความได้)
const { env } = require('../../config/env');

const PROVIDERS = Object.freeze({
  ollama: {
    label: 'Ollama (Local)',
    baseUrl: env.localAi.baseUrl,
    requiresKey: false,
    isLocal: true,
    jsonMode: true,
    defaultModel: env.localAi.model,
    timeoutMs: 180_000,
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    requiresKey: true,
    isLocal: false,
    jsonMode: true,
    defaultModel: null,
    timeoutMs: 60_000,
  },
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    requiresKey: true,
    isLocal: false,
    jsonMode: true,
    defaultModel: null,
    timeoutMs: 60_000,
  },
  intelsphere: {
    label: 'KKU IntelSphere',
    baseUrl: 'https://gen.ai.kku.ac.th/api/v1',
    requiresKey: true,
    isLocal: false,
    jsonMode: false, // ยังไม่ได้ยืนยันว่ารองรับ response_format — ระบบแกะ JSON จากข้อความเองได้
    defaultModel: 'deepseek-v4-pro',
    timeoutMs: 60_000,
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    requiresKey: true,
    isLocal: false,
    jsonMode: false, // ขึ้นกับโมเดลที่เลือก
    defaultModel: null,
    timeoutMs: 60_000,
  },
});

const DEFAULT_PROVIDER = 'ollama';
const getProvider = (id) => PROVIDERS[id] || null;
const listProviders = () =>
  Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    label: p.label,
    requiresKey: p.requiresKey,
    isLocal: p.isLocal,
    defaultModel: p.defaultModel,
  }));

module.exports = { PROVIDERS, DEFAULT_PROVIDER, getProvider, listProviders };
