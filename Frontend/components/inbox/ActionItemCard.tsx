"use client";

import { useState } from "react";
import { CalendarClock, Flag, MapPin, Quote, ExternalLink, CalendarCheck, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice, Spinner } from "@/components/common/Feedback";
import { api, ApiError, errorMessage } from "@/lib/api";
import { AVAILABILITY_META, MISSING_FIELD_TEXT } from "@/lib/labels";
import { formatSlot, formatWhen, fromInputs, toDateInput, toTimeInput } from "@/lib/format";
import type { ActionItem } from "@/lib/types";
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

  const [form, setForm] = useState({
    title: item.title,
    date: toDateInput(item.startAt),
    endDate: toDateInput(item.endAt || item.startAt),
    start: item.isTimeSpecified ? toTimeInput(item.startAt) : "",
    end: item.isTimeSpecified ? toTimeInput(item.endAt) : "",
    isAllDay: item.isAllDay,
    location: item.location || "",
  });

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

  const save = async () => {
    const timed = !form.isAllDay && Boolean(form.start);
    const startAt = fromInputs(form.date, timed ? form.start : "00:00");
    let endAt: string | null = null;
    if (!isDeadline) {
      if (form.isAllDay) endAt = fromInputs(form.endDate || form.date);
      else if (timed && form.end) endAt = fromInputs(form.date, form.end);
    }
    const ok = await run("save", () =>
      api.actions.update(item.id, {
        title: form.title,
        location: form.location || null,
        isAllDay: form.isAllDay || (isDeadline && !timed),
        startAt,
        endAt,
      })
    );
    if (ok) setEditing(false);
  };

  const confirm = (force = false) => run("confirm", () => api.actions.confirm(item.id, { force, inviteSender }));

  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        item.status === "CREATED" && "border-emerald-200 bg-emerald-50/40",
        item.status === "DISMISSED" && "border-slate-200 bg-slate-50 opacity-70",
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
            <Notice key={field} tone={field === "start" || field === "time" ? "warn" : "info"}>
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

      {editing && (
        <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-white p-3">
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="ชื่อรายการ" className="h-9 text-sm" />
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="h-9 w-40 text-sm" />
            {form.isAllDay && !isDeadline ? (
              <>
                <span className="text-xs text-slate-400">ถึง</span>
                <Input type="date" value={form.endDate} min={form.date} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="h-9 w-40 text-sm" />
              </>
            ) : (
              !form.isAllDay && (
                <>
                  <Input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} className="h-9 w-28 text-sm" />
                  {!isDeadline && (
                    <>
                      <span className="text-xs text-slate-400">ถึง</span>
                      <Input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} className="h-9 w-28 text-sm" />
                    </>
                  )}
                </>
              )
            )}
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={form.isAllDay} onChange={(e) => setForm({ ...form, isAllDay: e.target.checked })} />
              ทั้งวัน
            </label>
          </div>
          <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="สถานที่ (ไม่บังคับ)" className="h-9 text-sm" />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy !== null || !form.title.trim()} className="rounded-lg bg-blue-600 text-xs hover:bg-blue-700">
              {busy === "save" && <Spinner className="mr-1.5 h-3 w-3" />} บันทึกและตรวจตารางใหม่
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="rounded-lg text-xs">
              ยกเลิก
            </Button>
          </div>
        </div>
      )}

      {conflict && (
        <Notice tone="error" className="mt-3">
          <p>{conflict}</p>
          <button onClick={() => confirm(true)} disabled={busy !== null} className="mt-1 font-bold underline">
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
          <Button
            size="sm"
            onClick={() => confirm(false)}
            disabled={busy !== null || blocking.length > 0}
            title={blocking.length > 0 ? "กรุณาเติมวันเวลาก่อน" : undefined}
            className="rounded-lg bg-emerald-600 text-xs font-bold hover:bg-emerald-700"
          >
            {busy === "confirm" ? <Spinner className="mr-1.5 h-3 w-3" /> : <CalendarCheck className="mr-1.5 h-3.5 w-3.5" />}
            บันทึกลงปฏิทิน
          </Button>
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
    </div>
  );
}
