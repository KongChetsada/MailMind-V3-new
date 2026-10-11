// ป้ายข้อความและสีของค่าต่าง ๆ รวมไว้ที่เดียว — เพิ่มประเภทอีเมลใหม่ให้แก้ที่ CATEGORY_META
import {
  CalendarClock,
  ClipboardList,
  FileQuestion,
  Megaphone,
  Plane,
  GraduationCap,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import type { Availability, EmailCategory, EmailFilter, Priority, ReplyIntent } from "./types";

export const CATEGORY_META: Record<EmailCategory, { label: string; short: string; icon: LucideIcon; badge: string; dot: string }> = {
  APPOINTMENT: {
    label: "นัดหมาย / เลื่อนนัด",
    short: "นัดหมาย",
    icon: CalendarClock,
    badge: "bg-blue-50 text-blue-700 border-blue-200",
    dot: "bg-blue-500",
  },
  TASK_DEADLINE: {
    label: "กำหนดส่ง / งานที่ต้องทำ",
    short: "กำหนดส่ง",
    icon: ClipboardList,
    badge: "bg-rose-50 text-rose-700 border-rose-200",
    dot: "bg-rose-500",
  },
  INFO_REQUEST: {
    label: "ขอข้อมูลหรือเอกสาร",
    short: "ขอข้อมูล",
    icon: FileQuestion,
    badge: "bg-amber-50 text-amber-800 border-amber-200",
    dot: "bg-amber-500",
  },
  FYI: {
    label: "แจ้งเพื่อทราบ",
    short: "แจ้งเพื่อทราบ",
    icon: Megaphone,
    badge: "bg-slate-100 text-slate-700 border-slate-200",
    dot: "bg-slate-400",
  },
  BOOKING_TRAVEL: {
    label: "ยืนยันการจองและการเดินทาง",
    short: "การจอง/เดินทาง",
    icon: Plane,
    badge: "bg-teal-50 text-teal-700 border-teal-200",
    dot: "bg-teal-500",
  },
  EVENT_INVITATION: {
    label: "เชิญสัมมนา / ฝึกอบรม",
    short: "สัมมนา/อบรม",
    icon: GraduationCap,
    badge: "bg-violet-50 text-violet-700 border-violet-200",
    dot: "bg-violet-500",
  },
  OTHER: {
    label: "อื่น ๆ",
    short: "อื่น ๆ",
    icon: Inbox,
    badge: "bg-zinc-50 text-zinc-600 border-zinc-200",
    dot: "bg-zinc-300",
  },
};

export const CATEGORY_ORDER = Object.keys(CATEGORY_META) as EmailCategory[];

export const PRIORITY_LABEL: Record<Priority, string> = { HIGH: "สำคัญสูง", NORMAL: "ปกติ", LOW: "ต่ำ" };

export const FILTER_LABEL: Record<EmailFilter, string> = {
  has_action: "มีรายการลงปฏิทิน",
  has_draft: "มีร่างรอตรวจ",
  needs_reply: "ต้องตอบกลับ",
  unread: "ยังไม่อ่าน",
  failed: "วิเคราะห์ไม่สำเร็จ",
};

export const INTENT_LABEL: Record<ReplyIntent, string> = {
  ACCEPT: "ตอบรับ",
  PROPOSE_TIME: "เสนอเวลาอื่น",
  DECLINE: "ปฏิเสธ",
  ANSWER: "ตอบคำขอ",
  ACKNOWLEDGE: "รับทราบ",
};

export const AVAILABILITY_META: Record<Availability, { label: string; className: string }> = {
  AVAILABLE: { label: "ตารางว่าง", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CONFLICT: { label: "ชนกับปฏิทิน", className: "bg-rose-50 text-rose-700 border-rose-200" },
  OUT_OF_WORKING_HOURS: { label: "นอกเวลาทำงาน", className: "bg-amber-50 text-amber-800 border-amber-200" },
  OUT_OF_WORK_DAYS: { label: "ไม่ใช่วันทำงาน", className: "bg-amber-50 text-amber-800 border-amber-200" },
  NOT_CHECKED: { label: "ยังไม่ได้ตรวจตาราง", className: "bg-slate-100 text-slate-600 border-slate-200" },
};

/** คำอธิบายของฟิลด์ที่ระบบไม่เดาให้ ผู้ใช้ต้องตรวจหรือเติมเอง */
export const MISSING_FIELD_TEXT: Record<string, string> = {
  start: "อีเมลไม่ได้ระบุวันที่ กรุณาเติมก่อนบันทึก",
  time: "อีเมลไม่ได้ระบุเวลา กรุณาเติมเวลา หรือเลือกเป็นกิจกรรมทั้งวัน",
  end: "อีเมลไม่ได้ระบุเวลาสิ้นสุด ระบบตั้งไว้ 60 นาที",
  evidence: "ไม่พบข้อความอ้างอิงในอีเมล กรุณาตรวจวันเวลากับเนื้อหาอีกครั้ง",
};
