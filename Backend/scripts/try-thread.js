// ลอง prompt แบบรู้จักเธรดกับโมเดลจริง: อีเมลตอบกลับที่เกี่ยวกับรายการเดิม
//   node scripts/try-thread.js [--model <ชื่อโมเดล>] [--provider <id> --key <api key>]
// แสดงทั้งสิ่งที่ AI เสนอ และผลหลังผ่านกฎใน core/threadLinking.js (ผลของกฎคือสิ่งที่ระบบใช้จริง)
require('dotenv').config({ quiet: true });
const { createAiClient } = require('../src/connectors/ai');
const { formatThreadForAi } = require('../src/utils/emailText');
const { JSON_SYSTEM_PROMPT, buildAnalysisPrompt } = require('../src/core/analysis/prompts');
const { parseJsonFromLlm } = require('../src/core/analysis/parse');
const { validateAnalysis } = require('../src/core/analysis/validate');
const { linkToExisting } = require('../src/core/threadLinking');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const TZ = 'Asia/Bangkok';
const now = new Date('2026-10-12T03:00:00+07:00');

const CASES = [
  {
    name: 'รายละเอียดเพิ่มของทริปทั้งวัน (คาดหวัง: DETAIL)',
    existing: [{ id: 'A', kind: 'EVENT', title: 'นัดไปเที่ยวภูสอยดาวกับน้องการ์ตูน', startAt: new Date('2026-10-14T17:00:00Z'), endAt: null, isAllDay: true, isTimeSpecified: false }],
    thread: [
      { from: 'me@example.com', subject: 'นัดไปเที่ยวภูสอยดาวกับน้องการ์ตูน', text: 'วันที่ 15 ตุลาคม 2569 ไปเที่ยวภูสอยดาวกันนะ ทั้งวันเลย' },
      { from: 'Chetsada <c@example.com>', subject: 'Re: นัดไปเที่ยวภูสอยดาวกับน้องการ์ตูน', text: 'โอเคครับ รอที่หอนะ ตอน 02.00 เดี๋ยวไปรับ' },
    ],
  },
  {
    name: 'ขอเลื่อนนัด (คาดหวัง: RESCHEDULE)',
    existing: [{ id: 'B', kind: 'EVENT', title: 'ประชุมแผนงานไตรมาส 4', startAt: new Date('2026-10-22T07:00:00Z'), endAt: new Date('2026-10-22T08:30:00Z'), isAllDay: false, isTimeSpecified: true }],
    thread: [
      { from: 'wichai@example.com', subject: 'ขอนัดประชุมแผนงานไตรมาส 4', text: 'ขอนัดประชุมวันพฤหัสบดีที่ 22 ตุลาคม 2569 เวลา 14:00 - 15:30 น. ห้องประชุม 2' },
      { from: 'wichai@example.com', subject: 'Re: ขอนัดประชุมแผนงานไตรมาส 4', text: 'ขอโทษครับ วันพฤหัสผมติดงานด่วน ขอเลื่อนเป็นวันศุกร์ที่ 23 ตุลาคม 2569 เวลา 10:00 - 11:30 น. ห้องเดิมครับ' },
    ],
  },
  {
    name: 'ตอบรับเฉย ๆ ไม่มีข้อมูลใหม่ (คาดหวัง: ไม่มีรายการ)',
    existing: [{ id: 'C', kind: 'EVENT', title: 'ประชุมแผนงานไตรมาส 4', startAt: new Date('2026-10-22T07:00:00Z'), endAt: new Date('2026-10-22T08:30:00Z'), isAllDay: false, isTimeSpecified: true }],
    thread: [
      { from: 'wichai@example.com', subject: 'ขอนัดประชุมแผนงานไตรมาส 4', text: 'ขอนัดประชุมวันพฤหัสบดีที่ 22 ตุลาคม 2569 เวลา 14:00 - 15:30 น. ห้องประชุม 2' },
      { from: 'somsri@example.com', subject: 'Re: ขอนัดประชุมแผนงานไตรมาส 4', text: 'รับทราบค่ะ วันพฤหัสบดีที่ 22 ตุลาคม เวลา 14:00 - 15:30 น. เจอกันที่ห้องประชุม 2 ค่ะ' },
    ],
  },
  {
    name: 'ทริปหลายวัน + ข้อความที่บอกแค่เวลา (คาดหวัง: DETAIL ในวันแรกของทริป ไม่ใช่วันนี้)',
    existing: [{ id: 'D', kind: 'EVENT', title: 'นัดไปเที่ยวภูกระดึง', startAt: new Date('2026-10-14T17:00:00Z'), endAt: new Date('2026-10-16T17:00:00Z'), isAllDay: true, isTimeSpecified: false }],
    thread: [
      { from: 'a@example.com', subject: 'นัดไปเที่ยวภูกระดึง', text: 'ไปเที่ยวภูกระดึงกันไหม วันที่ 15/10/2569 - 17/10/2569' },
      { from: 'b@example.com', subject: 'Re: นัดไปเที่ยวภูกระดึง', text: 'ได้เลย ไปด้วย' },
      { from: 'a@example.com', subject: 'Re: นัดไปเที่ยวภูกระดึง', text: 'นัดรวมตัว 05.00 ที่หน้ามหาลัยขอนแก่น นะ เตรียมของมาให้พร้อม' },
    ],
  },
];

(async () => {
  const ai = createAiClient({ provider: arg('provider', 'ollama'), model: arg('model'), apiKey: arg('key') });
  console.log(`provider=${ai.provider} model=${ai.model}\n`);
  for (const c of CASES) {
    const { formattedThread, plainText } = formatThreadForAi(c.thread.map((m) => ({ ...m, date: now.toISOString() })));
    const started = Date.now();
    try {
      const res = await ai.complete({
        system: JSON_SYSTEM_PROMPT,
        user: buildAnalysisPrompt({ formattedThread, now, timezone: TZ, existingItems: c.existing }),
        temperature: 0.1,
        json: true,
      });
      const result = validateAnalysis(parseJsonFromLlm(res.text).value, { plainText, timezone: TZ, now, fallbackTitle: c.thread[c.thread.length - 1].subject });
      const latestText = c.thread[c.thread.length - 1].text;
      const linked = linkToExisting({ items: result.actionItems, existing: c.existing, timezone: TZ, latestText, referenceDate: now });
      console.log(`${c.name}  [${((Date.now() - started) / 1000).toFixed(0)}s, ${result.category}]`);
      for (const i of result.actionItems) console.log(`   AI   : "${i.title}" ${i.startAt?.toISOString() || '-'}  relatesTo=${i.relatesTo} relation=${i.relation}`);
      if (linked.length === 0) console.log('   ระบบ : ไม่มีรายการใหม่');
      for (const i of linked) console.log(`   ระบบ : "${i.title}" ${i.startAt?.toISOString() || '-'} → ${i.relation || 'ไม่ผูก'}${i.relatedActionId ? ` กับ ${i.relatedActionId}` : ''}${i.missingFields.length ? ` [ธง: ${i.missingFields.join(', ')}]` : ''}`);
    } catch (error) {
      console.log(`${c.name}  ล้มเหลว: ${error.message}`);
    }
    console.log();
  }
})();
