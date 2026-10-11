import { AlertTriangle, CalendarPlus, CalendarCheck, PenLine, Send, Clock3 } from "lucide-react";
import CategoryBadge from "./CategoryBadge";
import { formatListTime } from "@/lib/format";
import type { EmailListItem as Email } from "@/lib/types";
import { cn } from "@/lib/utils";

/** หนึ่งแถวในรายการอีเมล: ผู้ส่ง หัวข้อ สรุปจาก AI และตัวบ่งชี้สิ่งที่ต้องทำ */
export default function EmailListItem({ email, selected, onSelect }: { email: Email; selected: boolean; onSelect: () => void }) {
  const pending = email.analysisStatus === "PENDING" || email.analysisStatus === "PROCESSING";

  return (
    <button
      onClick={onSelect}
      className={cn(
        "relative block w-full border-b border-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-50",
        selected && "bg-blue-50/70 hover:bg-blue-50/70",
        email.suggestedActions > 0 && !selected && "bg-amber-50/40"
      )}
    >
      {selected && <span className="absolute bottom-0 left-0 top-0 w-1 bg-blue-600" />}

      <div className="flex items-center justify-between gap-2">
        <span className={cn("truncate text-sm", email.isRead ? "font-medium text-slate-600" : "font-bold text-slate-900")}>
          {!email.isRead && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-blue-600 align-middle" />}
          {email.fromName || email.fromAddress || "ไม่ทราบผู้ส่ง"}
        </span>
        <span className="shrink-0 text-[11px] text-slate-400">{formatListTime(email.receivedAt)}</span>
      </div>

      <p className={cn("mt-0.5 truncate text-[13px]", email.isRead ? "text-slate-600" : "font-semibold text-slate-800")}>
        {email.priority === "HIGH" && <span className="mr-1 font-bold text-rose-600">!</span>}
        {email.subject || "(ไม่มีหัวข้อ)"}
      </p>

      <p className="mt-0.5 line-clamp-1 text-xs text-slate-400">{email.summary || email.snippet}</p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <CategoryBadge category={email.category} />
        {pending && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400">
            <Clock3 className="h-3 w-3" /> รอวิเคราะห์
          </span>
        )}
        {email.analysisStatus === "FAILED" && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600">
            <AlertTriangle className="h-3 w-3" /> วิเคราะห์ไม่สำเร็จ
          </span>
        )}
        {email.suggestedActions > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
            <CalendarPlus className="h-3 w-3" /> ลงปฏิทินได้
          </span>
        )}
        {email.createdActions > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
            <CalendarCheck className="h-3 w-3" /> ลงปฏิทินแล้ว
          </span>
        )}
        {email.draftStatus === "PENDING" && (
          <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
            <PenLine className="h-3 w-3" /> มีร่างรอตรวจ
          </span>
        )}
        {email.draftStatus === "SENT" && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
            <Send className="h-3 w-3" /> ตอบแล้ว
          </span>
        )}
        {email.draftStatus === "FAILED" && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600">
            <AlertTriangle className="h-3 w-3" /> ส่งไม่สำเร็จ
          </span>
        )}
      </div>
    </button>
  );
}
