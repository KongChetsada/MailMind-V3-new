// นโยบายต่อประเภทอีเมล — แก้ที่ไฟล์นี้ที่เดียวเมื่อต้องการเพิ่มประเภทหรือเปลี่ยนพฤติกรรม
// (ถ้าเพิ่มรหัสประเภทใหม่ ต้องเพิ่มใน enum EmailCategory ของ prisma/schema.prisma ด้วย)
//
// autoDraft     : สร้างร่างตอบกลับทันทีหลังวิเคราะห์ เมื่อ AI ระบุว่าต้องตอบ
// defaultIntent : เจตนาของร่างเมื่อผู้ใช้กดขอร่างโดยไม่ระบุ
// calendarMode  : SUGGEST = ตรวจตารางและเสนอเวลาอื่นเมื่อไม่ว่าง
//                 WARN    = ตรวจแค่ว่าชนกับปฏิทินหรือไม่ (เลื่อนเองไม่ได้ เช่น สัมมนา เที่ยวบิน)
//                 NONE    = ไม่ตรวจ

const CATEGORIES = Object.freeze({
  APPOINTMENT: {
    label: 'นัดหมาย / เลื่อนนัด',
    description: 'ขอนัดพบ นัดประชุม ขอเลื่อนหรือยืนยันเวลานัดระหว่างบุคคล',
    autoDraft: true,
    defaultIntent: 'ACCEPT',
    calendarMode: 'SUGGEST',
  },
  TASK_DEADLINE: {
    label: 'กำหนดส่ง / งานที่ต้องทำ',
    description: 'มอบหมายงาน หรือแจ้งสิ่งที่ผู้รับต้องทำให้เสร็จภายในกำหนด',
    autoDraft: false,
    defaultIntent: 'ACKNOWLEDGE',
    calendarMode: 'NONE',
  },
  INFO_REQUEST: {
    label: 'ขอข้อมูลหรือเอกสาร',
    description: 'ผู้ส่งขอให้ผู้รับตอบคำถาม ให้ข้อมูล หรือส่งเอกสาร',
    autoDraft: true,
    defaultIntent: 'ANSWER',
    calendarMode: 'NONE',
  },
  FYI: {
    label: 'แจ้งเพื่อทราบ',
    description: 'ประกาศ รายงาน หรือแจ้งข่าวที่ไม่ต้องดำเนินการหรือตอบกลับ',
    autoDraft: false,
    defaultIntent: 'ACKNOWLEDGE',
    calendarMode: 'WARN',
  },
  BOOKING_TRAVEL: {
    label: 'ยืนยันการจองและการเดินทาง',
    description: 'ใบยืนยันการจองตั๋ว ที่พัก ห้องประชุม หรือกำหนดการเดินทาง',
    autoDraft: false,
    defaultIntent: 'ACKNOWLEDGE',
    calendarMode: 'WARN',
  },
  EVENT_INVITATION: {
    label: 'เชิญสัมมนา / ฝึกอบรม',
    description: 'เชิญเข้าร่วมงานสัมมนา อบรม เวิร์กช็อป หรือกิจกรรมที่ผู้จัดกำหนดเวลาไว้แล้ว',
    autoDraft: false,
    defaultIntent: 'ACCEPT',
    calendarMode: 'WARN',
  },
  OTHER: {
    label: 'อื่น ๆ',
    description: 'โฆษณา จดหมายข่าว การแจ้งเตือนอัตโนมัติ หรือเรื่องที่ไม่เข้าประเภทข้างต้น',
    autoDraft: false,
    defaultIntent: 'ANSWER',
    calendarMode: 'NONE',
  },
});

const CATEGORY_CODES = Object.freeze(Object.keys(CATEGORIES));
const PRIORITIES = Object.freeze(['HIGH', 'NORMAL', 'LOW']);
const REPLY_INTENTS = Object.freeze(['ACCEPT', 'PROPOSE_TIME', 'DECLINE', 'ANSWER', 'ACKNOWLEDGE']);
const ACTION_KINDS = Object.freeze(['EVENT', 'DEADLINE']);

const PRIORITY_RULES = Object.freeze({
  HIGH: 'มีคำแสดงความเร่งด่วน (ด่วน, ด่วนที่สุด, ASAP, ฉุกเฉิน) กำหนดภายใน 1-2 วัน หรือมาจากผู้บังคับบัญชา/ผู้บริหาร',
  NORMAL: 'เรื่องงานทั่วไปที่ต้องดำเนินการ แต่ไม่มีคำแสดงความเร่งด่วน',
  LOW: 'แจ้งเพื่อทราบ จดหมายข่าว ประชาสัมพันธ์ หรือเรื่องที่ไม่ต้องดำเนินการ',
});

// ป้ายของ Gmail ที่ข้ามการวิเคราะห์ด้วย AI
const SKIP_PROVIDER_LABELS = Object.freeze(['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'SPAM']);

const getCategoryPolicy = (code) => CATEGORIES[code] || CATEGORIES.OTHER;

/** ประเภทที่ใช้จริง: ค่าที่ผู้ใช้แก้มีสิทธิ์เหนือค่าจาก AI */
const effectiveCategory = (email) => email?.userCategory || email?.category || null;

module.exports = {
  CATEGORIES,
  CATEGORY_CODES,
  PRIORITIES,
  REPLY_INTENTS,
  ACTION_KINDS,
  PRIORITY_RULES,
  SKIP_PROVIDER_LABELS,
  getCategoryPolicy,
  effectiveCategory,
};
