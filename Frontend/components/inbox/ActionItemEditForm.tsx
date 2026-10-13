"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/common/Feedback";
import { addDaysToDateInput, daysBetweenDateInputs, formatWhen, fromInputs, toDateInput, toTimeInput } from "@/lib/format";
import type { ActionItem } from "@/lib/types";

export interface ActionItemPatch {
  title: string;
  location: string | null;
  isAllDay: boolean;
  startAt: string | null;
  endAt: string | null;
  repeatDays: number;
}

/** วิธีตีความกิจกรรมหลายวันที่มีเวลา */
type MultiDayMode = "daily" | "continuous";

interface Props {
  item: ActionItem;
  saving: boolean;
  onSave: (patch: ActionItemPatch) => void;
  onCancel: () => void;
}

/** วันสุดท้ายของรายการตามข้อมูลที่เก็บไว้ (ว่าง = จบในวันเดียวกับวันเริ่ม) */
const initialEndDate = (item: ActionItem) => {
  const first = toDateInput(item.startAt);
  if (!first) return "";
  if (!item.isAllDay && item.repeatDays > 1) return addDaysToDateInput(first, item.repeatDays - 1);
  const last = toDateInput(item.endAt);
  return last && last !== first ? last : "";
};

/**
 * แบบฟอร์มแก้รายการลงปฏิทิน
 * วันเดียวเป็นค่าเริ่มต้น กด "+ เพิ่มวันสิ้นสุด" เพื่อทำเป็นหลายวันได้เสมอ แม้อีเมลจะระบุมาแค่วันเดียว
 */
export default function ActionItemEditForm({ item, saving, onSave, onCancel }: Props) {
  const isDeadline = item.kind === "DEADLINE";
  const [title, setTitle] = useState(item.title);
  const [date, setDate] = useState(toDateInput(item.startAt));
  const [start, setStart] = useState(item.isTimeSpecified ? toTimeInput(item.startAt) : "");
  const [end, setEnd] = useState(item.isTimeSpecified ? toTimeInput(item.endAt) : "");
  const [isAllDay, setIsAllDay] = useState(item.isAllDay);
  const [endDate, setEndDate] = useState(initialEndDate(item));
  const [showEndDate, setShowEndDate] = useState(initialEndDate(item) !== "");
  const [mode, setMode] = useState<MultiDayMode>(item.repeatDays > 1 || !initialEndDate(item) ? "daily" : "continuous");
  const [location, setLocation] = useState(item.location || "");

  const extraDays = showEndDate && date && endDate ? daysBetweenDateInputs(date, endDate) : 0;
  const multiDay = !isDeadline && extraDays > 0;
  const timed = !isAllDay && Boolean(start);
  // "ทุกวัน" ใช้ได้เมื่อเวลาจบอยู่หลังเวลาเริ่มในวันเดียวกัน (22:00–02:00 เป็นกิจกรรมข้ามคืน)
  const dailyPossible = timed && Boolean(end) && end > start;
  const effectiveMode: MultiDayMode = multiDay && timed && dailyPossible ? mode : "continuous";

  const buildPatch = (): ActionItemPatch => {
    const base = { title: title.trim(), location: location.trim() || null };
    if (isDeadline) {
      return { ...base, isAllDay: !timed, startAt: fromInputs(date, timed ? start : "00:00"), endAt: null, repeatDays: 1 };
    }
    // หลายวันแต่ไม่ระบุเวลา = ทั้งวันหลายวัน
    if (isAllDay || (multiDay && !timed)) {
      return { ...base, isAllDay: true, startAt: fromInputs(date), endAt: fromInputs(multiDay ? endDate : date), repeatDays: 1 };
    }
    if (!timed) return { ...base, isAllDay: false, startAt: fromInputs(date), endAt: null, repeatDays: 1 };
    if (!multiDay) return { ...base, isAllDay: false, startAt: fromInputs(date, start), endAt: end ? fromInputs(date, end) : null, repeatDays: 1 };
    if (effectiveMode === "daily") {
      return { ...base, isAllDay: false, startAt: fromInputs(date, start), endAt: fromInputs(date, end), repeatDays: extraDays + 1 };
    }
    return { ...base, isAllDay: false, startAt: fromInputs(date, start), endAt: fromInputs(endDate, end || start), repeatDays: 1 };
  };

  const patch = buildPatch();
  const preview = formatWhen({ ...patch, isTimeSpecified: !patch.isAllDay && timed });
  const endBeforeStart = Boolean(patch.startAt && patch.endAt && !patch.isAllDay && patch.endAt <= patch.startAt);
  const canSave = Boolean(title.trim()) && Boolean(date) && !endBeforeStart;

  return (
    <div className="mt-3 space-y-2.5 rounded-xl border border-slate-200 bg-white p-3">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ชื่อรายการ" className="h-9 text-sm" />

      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="วันที่เริ่ม" className="h-9 w-40 text-sm" />
        {!isAllDay && (
          <>
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="เวลาเริ่ม" className="h-9 w-28 text-sm" />
            {!isDeadline && (
              <>
                <span className="text-xs text-slate-400">ถึง</span>
                <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="เวลาสิ้นสุด" className="h-9 w-28 text-sm" />
              </>
            )}
          </>
        )}
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={isAllDay} onChange={(e) => setIsAllDay(e.target.checked)} />
          ทั้งวัน
        </label>
      </div>

      {!isDeadline &&
        (showEndDate ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">ถึงวันที่</span>
            <Input type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} aria-label="วันที่สิ้นสุด" className="h-9 w-40 text-sm" />
            <button
              type="button"
              onClick={() => {
                setShowEndDate(false);
                setEndDate("");
              }}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
            >
              <X className="h-3 w-3" /> เอาวันสิ้นสุดออก
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setShowEndDate(true);
              setEndDate(date ? addDaysToDateInput(date, 1) : "");
            }}
            className="flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" /> เพิ่มวันสิ้นสุด (กิจกรรมหลายวัน)
          </button>
        ))}

      {multiDay && timed && (
        <div className="space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <label className={`flex items-center gap-2 ${dailyPossible ? "" : "opacity-50"}`}>
            <input type="radio" name={`mode-${item.id}`} checked={effectiveMode === "daily"} disabled={!dailyPossible} onChange={() => setMode("daily")} />
            ทุกวันในช่วงเวลานี้ ({extraDays + 1} วัน วันละ {start}–{end || "?"})
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name={`mode-${item.id}`} checked={effectiveMode === "continuous"} onChange={() => setMode("continuous")} />
            ต่อเนื่องข้ามวัน (เริ่มวันแรก {start} จบวันสุดท้าย {end || start})
          </label>
          {!dailyPossible && <p className="text-slate-500">เลือก “ทุกวัน” ได้เมื่อเวลาสิ้นสุดอยู่หลังเวลาเริ่ม</p>}
        </div>
      )}

      <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="สถานที่ (ไม่บังคับ)" className="h-9 text-sm" />

      <p className="text-xs text-slate-500">
        จะบันทึกเป็น: <span className="font-semibold text-slate-700">{preview}</span>
      </p>
      {endBeforeStart && <p className="text-xs font-semibold text-rose-600">เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม</p>}

      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSave(patch)} disabled={saving || !canSave} className="rounded-lg bg-blue-600 text-xs hover:bg-blue-700">
          {saving && <Spinner className="mr-1.5 h-3 w-3" />} บันทึกและตรวจตารางใหม่
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} className="rounded-lg text-xs">
          ยกเลิก
        </Button>
      </div>
    </div>
  );
}
