// อีเมลแจ้งเตือนผู้ใช้เมื่อพบนัดหมายใหม่รอยืนยัน (หน้าตาตามแบบ V2)
// ไฟล์นี้เป็นตรรกะล้วน: เลือกรายการที่ควรแจ้ง และสร้างหัวเรื่อง/HTML — การส่งอยู่ที่ workflows/notifyAppointment.js
const { formatThaiDate, formatThaiRange } = require('./time');
const { repeatCount, lastOccurrenceStart, shiftDays } = require('./occurrences');

// แจ้งเฉพาะประเภทนัดหมาย/เลื่อนนัด (ประเภทอื่นที่ลงปฏิทินได้ เช่น สัมมนา การเดินทาง ไม่แจ้ง)
const NOTIFY_CATEGORIES = ['APPOINTMENT'];

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** เวลาที่กิจกรรมจบ (วันสุดท้าย) — ใช้ตัดรายการที่ผ่านไปแล้ว */
const lastMoment = (item, tz) => {
  if (!item.startAt) return null;
  if (repeatCount(item) > 1) {
    return item.endAt ? shiftDays(item.endAt, repeatCount(item) - 1, tz) : lastOccurrenceStart(item, tz);
  }
  return item.endAt || item.startAt;
};

/**
 * รายการที่ควรแจ้ง: นัดหมาย (EVENT) ที่ยังรอยืนยัน และยังไม่ผ่านไปทั้งหมด
 * รายการที่ยังไม่มีวันที่ก็แจ้ง เพราะผู้ใช้ต้องเข้าไปเติมเอง
 */
const pickNotifiableItems = ({ category, items, now, timezone }) => {
  if (!NOTIFY_CATEGORIES.includes(category)) return [];
  return (items || []).filter((item) => {
    if (item.kind !== 'EVENT' || item.status !== 'SUGGESTED') return false;
    const end = lastMoment(item, timezone);
    return !end || new Date(end) >= now;
  });
};

const describeWhen = (item, tz) => {
  if (!item.startAt) return 'ยังไม่ระบุวันที่';
  if (item.isTimeSpecified) {
    const days = repeatCount(item);
    return `${formatThaiRange(item.startAt, item.endAt, tz)}${days > 1 ? ` · ทุกวัน รวม ${days} วัน` : ''}`;
  }
  const end = item.endAt && formatThaiDate(item.endAt, tz) !== formatThaiDate(item.startAt, tz) ? ` ถึง ${formatThaiDate(item.endAt, tz)}` : '';
  return `${formatThaiDate(item.startAt, tz)}${end} (ทั้งวัน)`;
};

const row = (label, value) =>
  `<p style="margin: 8px 0; color: #334155;"><strong>${label}:</strong> ${value}</p>`;

const itemBlock = (item, tz) => {
  const tag = item.relation === 'RESCHEDULE' ? '<span style="color: #b45309; font-weight: bold;">[ขอเลื่อนนัด]</span> ' : '';
  // CONFLICT / OUT_OF_WORKING_HOURS / OUT_OF_WORK_DAYS
  const conflict =
    item.availability && !['NOT_CHECKED', 'AVAILABLE'].includes(item.availability)
      ? `<p style="margin: 6px 0 0; color: #b91c1c; font-size: 14px;">⚠️ ${escapeHtml(item.availabilityReason || 'ช่วงเวลานี้ไม่ว่างตามปฏิทินหรือเวลาทำงาน')}</p>`
      : '';
  return `
          <div style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 15px 20px; margin: 16px 0; border-radius: 0 8px 8px 0;">
            <p style="margin: 0 0 6px; color: #0f172a; font-size: 16px; font-weight: bold;">${tag}${escapeHtml(item.title)}</p>
            ${row('วัน/เวลา', escapeHtml(describeWhen(item, tz)))}
            ${item.location ? row('สถานที่', escapeHtml(item.location)) : ''}${conflict}
          </div>`;
};

/**
 * @param email    { fromName, fromAddress, subject }
 * @param items    รายการจาก pickNotifiableItems
 * @param inboxUrl ลิงก์ไปเปิดอีเมลฉบับนี้ใน MailMind
 * @param hasDraft มีร่างตอบกลับรอตรวจแล้วหรือไม่
 * คืน { subject, html }
 */
const buildAppointmentNotification = ({ email, items, timezone, inboxUrl, hasDraft }) => {
  const isReschedule = items.some((i) => i.relation === 'RESCHEDULE');
  const subject = isReschedule ? '🔔 มีการขอเลื่อนนัด รอการยืนยัน (MailMind)' : '🔔 มีนัดหมายใหม่รอการยืนยัน (MailMind)';
  const heading = isReschedule ? '🔔 มีการขอเลื่อนนัดรอการยืนยัน!' : '🔔 มีนัดหมายใหม่รอการยืนยัน!';
  const from = email.fromName ? `${email.fromName} <${email.fromAddress || ''}>` : email.fromAddress || 'ไม่ทราบผู้ส่ง';
  const intro = hasDraft
    ? 'ผู้ช่วย AI พบนัดหมายจากอีเมลล่าสุด และเตรียม "ร่างการตอบกลับ" พร้อมรายการลงปฏิทินไว้ให้คุณตรวจสอบแล้ว'
    : 'ผู้ช่วย AI พบนัดหมายจากอีเมลล่าสุด และเตรียมรายการลงปฏิทินไว้ให้คุณตรวจสอบแล้ว';

  const html = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
        <div style="background-color: #f59e0b; color: white; padding: 20px; text-align: center;">
          <h2 style="margin: 0; font-size: 24px;">${heading}</h2>
        </div>
        <div style="padding: 30px; background-color: #ffffff;">
          <p style="color: #475569; font-size: 16px; line-height: 1.5; margin-top: 0;">${intro}</p>
          ${row('จาก', escapeHtml(from))}
          ${row('หัวข้ออีเมล', escapeHtml(email.subject || '(ไม่มีหัวเรื่อง)'))}
          ${items.map((item) => itemBlock(item, timezone)).join('')}
          <div style="text-align: center; margin-top: 30px;">
            <a href="${escapeHtml(inboxUrl)}" style="background-color: #f59e0b; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 16px;">
              ตรวจสอบและยืนยัน
            </a>
          </div>
        </div>
        <div style="background-color: #f1f5f9; padding: 15px; text-align: center; border-top: 1px solid #e2e8f0;">
          <p style="margin: 0; color: #64748b; font-size: 12px;">อีเมลฉบับนี้ส่งอัตโนมัติจากระบบ MailMind 🤖 ปิดการแจ้งเตือนได้ที่หน้าตั้งค่า</p>
        </div>
      </div>`;

  return { subject, html };
};

module.exports = { NOTIFY_CATEGORIES, escapeHtml, pickNotifiableItems, buildAppointmentNotification };
