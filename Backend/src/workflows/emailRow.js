// แปลงข้อมูลอีเมลจากตัวเชื่อมเป็นข้อมูลแถว EmailMessage — ใช้ร่วมระหว่างการซิงก์และการดึงย้อนหลัง
const { SKIP_PROVIDER_LABELS } = require('../core/categories');

/** ผู้ให้บริการจัดเป็นโปรโมชัน/โซเชียล → ข้ามการวิเคราะห์ด้วยกฎ */
const isSkippedByRule = (meta) => (meta.labels || []).some((label) => SKIP_PROVIDER_LABELS.includes(label));

/**
 * @param status  สถานะการวิเคราะห์ของฉบับที่ไม่ถูกข้าม (ซิงก์ปกติ = PENDING, ย้อนหลัง = MANUAL)
 */
const toEmailRow = (meta, status = 'PENDING') => ({
  providerThreadId: meta.providerThreadId,
  fromName: meta.fromName,
  fromAddress: meta.fromAddress,
  subject: meta.subject,
  snippet: meta.snippet,
  receivedAt: meta.receivedAt,
  isRead: meta.isRead,
  ...(isSkippedByRule(meta) ? { analysisStatus: 'SKIPPED', category: 'OTHER', priority: 'LOW' } : { analysisStatus: status }),
});

module.exports = { toEmailRow, isSkippedByRule };
