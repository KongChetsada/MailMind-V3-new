"use client";

import { useState } from "react";
import { CalendarClock, Flag, MapPin, Quote, ExternalLink, CalendarCheck, CalendarSync, Link2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice, Spinner } from "@/components/common/Feedback";
import { api, ApiError, errorMessage } from "@/lib/api";
import { AVAILABILITY_META, MISSING_FIELD_TEXT } from "@/lib/labels";
import { formatSlot, formatWhen } from "@/lib/format";
import ActionItemEditForm, { type ActionItemPatch } from "./ActionItemEditForm";
import type { ActionItem, ConfirmMode } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  item: ActionItem;
  /** แสดงตัวเลือกส่งคำเชิญให้ผู้ส่ง (ใช้กับนัดหมายระหว่างบุคคล) */
  canInviteSender: boolean;
  onChange: (item: ActionItem) => void;
}

/** รายการที่ลงปฏิทินได้หนึ่งรายการ: แสดงหลักฐาน ผลตรวจตาราง และให้ผู้ใช้แก้/ยืนยันเอง */
export default function ActionItemCard({ item, canInviteSender, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"save" | "confirm" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [inviteSender, setInviteSender] = useState(false);
  // โหมดที่ผู้ใช้กดล่าสุด — ใช้เมื่อกด "บันทึกทับ" หลังพบว่าชนกับกิจกรรมอื่น
  const [lastMode, setLastMode] = useState<ConfirmMode>("CREATE");

  const isDeadline = item.kind === "DEADLINE";
  const editable = item.status === "SUGGESTED" || item.status === "FAILED";
  const blocking = item.missingFields.filter((f) => f === "start" || f === "time");
  const availability = AVAILABILITY_META[item.availability];

  const run = async (kind: "save" | "confirm" | "dismiss", fn: () => Promise<{ action: ActionItem }>) => {
    setBusy(kind);
    setError(null);
    try {
      const { action } = await fn();
      setConflict(null);
      onChange(action);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === "CALENDAR_CONFLICT") setConflict(e.message);
      else setError(errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const save = async (patch: ActionItemPatch) => {
    const ok = await run("save", () => api.actions.update(item.id, patch));
    if (ok) setEditing(false);
  };

  const confirm = (mode: ConfirmMode, force = false) => {
    setLastMode(mode);
    return run("confirm", () => api.actions.confirm(item.id, { force, mode, inviteSender: mode === "CREATE" && inviteSender }));
  };

  // รายการเดิมในเธรดเดียวกันที่ยังแก้ได้ → เสนอทางเลือก "แก้กิจกรรมเดิม" คู่กับ "เพิ่มเป็นรายการแยก"
  const related = item.related && ["SUGGESTED", "FAILED", "CREATED"].includes(item.related.status) ? item.related : null;
  const isReschedule = item.relation === "RESCHEDULE";

  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        item.status === "CREATED" && "border-emerald-200 bg-emerald-50/40",
        item.status === "DISMISSED" && "border-slate-200 bg-slate-50 opacity-70",
        item.status === "MERGED" && "border-indigo-200 bg-indigo-50/40",
        editable && "border-amber-200 bg-amber-50/40"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", isDeadline ? "bg-rose-100 text-rose-600" : "bg-blue-100 text-blue-600")}>
            {isDeadline ? <Flag className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{isDeadline ? "กำหนดส่ง" : "กิจกรรม"}</p>
            <p className="text-sm font-bold text-slate-900">{item.title}</p>
            <p className="mt-0.5 text-xs font-medium text-slate-600">{formatWhen(item)}</p>
            {item.location && (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                <MapPin className="h-3 w-3 shrink-0" /> {item.location}
              </p>
            )}
          </div>
        </div>
        {item.kind === "EVENT" && item.status !== "CREATED" && item.status !== "DISMISSED" && (
          <span className={cn("shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold", availability.className)}>{availability.label}</span>
        )}
      </div>

      {item.related && item.status !== "MERGED" && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 px-3 py-2 text-xs text-indigo-900">
          <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <p className="font-bold">{isReschedule ? "อีเมลนี้ขอเปลี่ยนวันเวลาของกิจกรรมเดิมในเธรด" : "เกี่ยวข้องกับกิจกรรมเดิมในเธรดนี้"}</p>
            <p>
              {item.related.title} · {formatWhen(item.related)}
              {item.related.status === "CREATED" ? " · อยู่ในปฏิทินแล้ว" : item.related.status === "SUGGESTED" ? " · ยังรอยืนยัน" : ""}
            </p>
          </div>
        </div>
      )}

      {item.evidence && (
        <p className="mt-3 flex gap-1.5 rounded-lg bg-white/70 px-2.5 py-1.5 text-xs italic text-slate-600">
          <Quote className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
          <span>{item.evidence}</span>
        </p>
      )}

      {editable && (
        <div className="mt-3 space-y-1.5">
          {item.availabilityReason && item.availability !== "AVAILABLE" && <Notice tone="warn">{item.availabilityReason}</Notice>}
          {item.missingFields.map((field) => (
            <Notice key={field} tone={field === "start" || field === "time" || field === "date" ? "warn" : "info"}>
              {MISSING_FIELD_TEXT[field] || field}
            </Notice>
          ))}
          {item.suggestedSlots.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-600">
              <p className="font-semibold text-slate-700">เวลาว่างที่ใกล้ที่สุด</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {item.suggestedSlots.map((slot) => (
                  <li key={slot.start}>{formatSlot(slot)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {editing && <ActionItemEditForm item={item} saving={busy === "save"} onSave={save} onCancel={() => setEditing(false)} />}

      {conflict && (
        <Notice tone="error" className="mt-3">
          <p>{conflict}</p>
          <button onClick={() => confirm(lastMode, true)} disabled={busy !== null} className="mt-1 font-bold underline">
            บันทึกทับลงปฏิทินต่อไป
          </button>
        </Notice>
      )}
      {error && (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      )}
      {item.status === "FAILED" && item.errorMessage && !error && (
        <Notice tone="error" className="mt-3">
          บันทึกครั้งก่อนไม่สำเร็จ: {item.errorMessage}
        </Notice>
      )}

      {editable && !editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(() => {
            const disabled = busy !== null || blocking.length > 0;
            const title = blocking.length > 0 ? "กรุณาเติมวันเวลาก่อน" : undefined;
            const createButton = (primary: boolean) => (
              <Button
                key="create"
                size="sm"
                variant={primary ? "default" : "outline"}
                onClick={() => confirm("CREATE")}
                disabled={disabled}
                title={title}
                className={cn("rounded-lg text-xs font-bold", primary && "bg-emerald-600 hover:bg-emerald-700")}
              >
                {busy === "confirm" && lastMode === "CREATE" ? <Spinner className="mr-1.5 h-3 w-3" /> : <CalendarCheck className="mr-1.5 h-3.5 w-3.5" />}
                {related ? "เพิ่มเป็นรายการแยก" : "บันทึกลงปฏิทิน"}
              </Button>
            );
            if (!related) return createButton(true);
            const updateButton = (primary: boolean) => (
              <Button
                key="update"
                size="sm"
                variant={primary ? "default" : "outline"}
                onClick={() => confirm("UPDATE_RELATED")}
                disabled={disabled}
                title={title || "ย้ายกิจกรรมเดิมมาเป็นวันเวลานี้ ชื่อกิจกรรมเดิมคงไว้"}
                className={cn("rounded-lg text-xs font-bold", primary && "bg-indigo-600 hover:bg-indigo-700")}
              >
                {busy === "confirm" && lastMode === "UPDATE_RELATED" ? <Spinner className="mr-1.5 h-3 w-3" /> : <CalendarSync className="mr-1.5 h-3.5 w-3.5" />}
                แก้กิจกรรมเดิมเป็นวันเวลานี้
              </Button>
            );
            // เลื่อนนัดชัดเจน → ปุ่มหลักคือแก้กิจกรรมเดิม · รายละเอียดเพิ่ม → ปุ่มหลักคือเพิ่มแยก
            return isReschedule ? [updateButton(true), createButton(false)] : [createButton(true), updateButton(false)];
          })()}
          <Button size="sm" variant="outline" onClick={() => setEditing(true)} className="rounded-lg text-xs">
            <Pencil className="mr-1.5 h-3 w-3" /> แก้ไข
          </Button>
          <Button size="sm" variant="ghost" onClick={() => run("dismiss", () => api.actions.dismiss(item.id))} disabled={busy !== null} className="rounded-lg text-xs text-slate-500">
            <X className="mr-1 h-3 w-3" /> ไม่ต้องลง
          </Button>
          {canInviteSender && item.kind === "EVENT" && (
            <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-500" title="Google Calendar จะส่งคำเชิญทางอีเมลให้ผู้ส่ง">
              <input type="checkbox" checked={inviteSender} onChange={(e) => setInviteSender(e.target.checked)} />
              ส่งคำเชิญปฏิทินให้ผู้ส่ง
            </label>
          )}
        </div>
      )}

      {item.status === "CREATED" && (
        <p className="mt-3 flex items-center gap-2 text-xs font-bold text-emerald-700">
          <CalendarCheck className="h-3.5 w-3.5" /> อยู่ในปฏิทินแล้ว
          {item.externalLink && (
            <a href={item.externalLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline">
              เปิดดู <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </p>
      )}
      {item.status === "CREATING" && <p className="mt-3 text-xs text-slate-500">กำลังบันทึกลงปฏิทิน...</p>}
      {item.status === "DISMISSED" && <p className="mt-3 text-xs text-slate-500">เลือกไม่ลงปฏิทิน</p>}
      {item.status === "MERGED" && (
        <p className="mt-3 flex items-center gap-2 text-xs font-bold text-indigo-700">
          <CalendarSync className="h-3.5 w-3.5" />
          ใช้วันเวลานี้แก้กิจกรรมเดิมแล้ว{item.related ? `: ${item.related.title} · ${formatWhen(item.related)}` : ""}
        </p>
      )}
    </div>
  );
}
