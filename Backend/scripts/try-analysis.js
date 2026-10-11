// ลองขั้น "จำแนกและสกัด" กับโมเดลจริง โดยไม่แตะฐานข้อมูลและไม่ต้องเข้าสู่ระบบ
//
//   node scripts/try-analysis.js                         ใช้ Ollama และโมเดลใน .env
//   node scripts/try-analysis.js --model qwen3:8b
//   node scripts/try-analysis.js --provider openai --model <ชื่อโมเดล> --key <api key>
//   node scripts/try-analysis.js --file path/to/emails.json --verbose
//
// ไฟล์ตัวอย่างเป็นอีเมลสังเคราะห์ 8 ฉบับ ใช้ตรวจว่า prompt ทำงานและวัดเวลาต่อฉบับ
// ไม่ใช่ชุดวัดความถูกต้อง — การประเมินจริงต้องใช้ชุดข้อมูลที่ติดป้ายกำกับจำนวนมากกว่านี้
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createAiClient } = require('../src/connectors/ai');
const { formatThreadForAi } = require('../src/utils/emailText');
const { JSON_SYSTEM_PROMPT, buildAnalysisPrompt } = require('../src/core/analysis/prompts');
const { parseJsonFromLlm } = require('../src/core/analysis/parse');
const { validateAnalysis } = require('../src/core/analysis/validate');
const { formatThaiRange, formatThaiDate } = require('../src/core/time');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const verbose = process.argv.includes('--verbose');
const TZ = arg('tz', 'Asia/Bangkok');

(async () => {
  const file = arg('file', path.join(__dirname, 'samples', 'emails.json'));
  const samples = JSON.parse(fs.readFileSync(file, 'utf8'));
  const ai = createAiClient({ provider: arg('provider', 'ollama'), model: arg('model'), apiKey: arg('key') });
  const now = arg('now') ? new Date(arg('now')) : new Date();
  console.log(`provider=${ai.provider} model=${ai.model} samples=${samples.length} now=${now.toISOString()}\n`);

  let correct = 0;
  let failed = 0;
  const durations = [];

  for (const sample of samples) {
    const { formattedThread, plainText } = formatThreadForAi([
      { from: sample.from, subject: sample.subject, date: now.toISOString(), text: sample.text, html: sample.html },
    ]);
    const started = Date.now();
    try {
      const res = await ai.complete({
        system: JSON_SYSTEM_PROMPT,
        user: buildAnalysisPrompt({ formattedThread, now, timezone: TZ }),
        temperature: 0.1,
        json: true,
      });
      const ms = Date.now() - started;
      durations.push(ms);
      const { value, strategy } = parseJsonFromLlm(res.text);
      const result = validateAnalysis(value, { plainText, timezone: TZ, now });
      const ok = !sample.expected || result.category === sample.expected;
      if (ok) correct += 1;

      console.log(`${ok ? 'OK  ' : 'MISS'} ${sample.id.padEnd(18)} ${result.category.padEnd(17)} ${result.priority.padEnd(6)} reply=${result.needsReply} ${(ms / 1000).toFixed(1)}s parse=${strategy}`);
      if (!ok) console.log(`       expected ${sample.expected}`);
      console.log(`       ${result.summary}`);
      for (const item of result.actionItems) {
        const when = !item.startAt
          ? '(ไม่มีวันที่)'
          : item.isTimeSpecified
            ? formatThaiRange(item.startAt, item.endAt, TZ)
            : formatThaiDate(item.startAt, TZ);
        const flags = item.missingFields.length ? `  [ขาด: ${item.missingFields.join(', ')}]` : '';
        console.log(`       - ${item.kind} ${item.title} | ${when}${item.location ? ` | ${item.location}` : ''}${flags}`);
      }
      if (verbose) console.log(res.text);
    } catch (error) {
      failed += 1;
      console.log(`FAIL ${sample.id.padEnd(18)} ${((Date.now() - started) / 1000).toFixed(1)}s ${error.message}`);
    }
  }

  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length / 1000 : 0;
  console.log(`\ncategory match ${correct}/${samples.length} · failed ${failed} · avg ${avg.toFixed(1)}s per email`);
})();
