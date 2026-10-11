// แปลงการตั้งค่าผู้ใช้เป็นข้อมูลที่ใช้ในการร่างตอบกลับ
const DAY_LABELS = { mon: 'จันทร์', tue: 'อังคาร', wed: 'พุธ', thu: 'พฤหัสบดี', fri: 'ศุกร์', sat: 'เสาร์', sun: 'อาทิตย์' };
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];

const formatWorkDays = (workDays) => {
  const days = Array.isArray(workDays) ? workDays.map((d) => String(d).toLowerCase()) : WEEKDAYS;
  if (days.length === 7) return 'ทุกวัน';
  if (days.length === 5 && WEEKDAYS.every((d) => days.includes(d))) return 'วันจันทร์ ถึง วันศุกร์';
  const labels = days.map((d) => DAY_LABELS[d]).filter(Boolean);
  return labels.length ? `วัน${labels.join(', วัน')}` : 'วันจันทร์ ถึง วันศุกร์';
};

const buildReplyProfile = (setting) => {
  const gender = String(setting?.gender || '').toUpperCase();
  const pronoun = gender === 'MALE' ? 'ผม' : gender === 'FEMALE' ? 'ดิฉัน' : 'ฉัน';
  const politeParticle = gender === 'MALE' ? 'ครับ' : gender === 'FEMALE' ? 'ค่ะ' : 'ครับ/ค่ะ';
  const tone =
    setting?.tone === 'casual'
      ? 'เป็นกันเอง สุภาพ และอบอุ่น (casual, polite)'
      : 'เป็นทางการ สุภาพ และมืออาชีพ (formal, professional)';

  const fullName = `${setting?.firstName || ''} ${setting?.lastName || ''}`.trim();
  const signature = [setting?.signature || 'ขอแสดงความนับถือ', fullName, setting?.position]
    .filter(Boolean)
    .join('\n');

  const workingHours = `${formatWorkDays(setting?.workDays)} เวลา ${setting?.startTime || '09:00'} - ${setting?.endTime || '17:00'} น.`;

  return { pronoun, politeParticle, tone, signature, workingHours };
};

module.exports = { buildReplyProfile, formatWorkDays };
