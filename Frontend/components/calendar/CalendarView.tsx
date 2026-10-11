"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek, subMonths } from "date-fns";
import { th } from "date-fns/locale";
import { ChevronLeft, ChevronRight, MapPin, ExternalLink, Clock, CalendarPlus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/common/Feedback";
import { api, errorMessage } from "@/lib/api";
import { formatWhen } from "@/lib/format";
import type { ActionItem, CalendarEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];
const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false }) : "");

/** ปฏิทินรายเดือน: กิจกรรมจากผู้ให้บริการ (เขียว) และรายการจากอีเมลที่รอยืนยัน (เหลือง) */
export default function CalendarView() {
  const [month, setMonth] = useState(new Date());
  const [selected, setSelected] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [pending, setPending] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // โหลดสองแหล่งแยกกัน: ปฏิทินล่มก็ยังเห็นรายการที่รอยืนยัน
    const [cal, actions] = await Promise.allSettled([api.calendar(), api.actions.list("SUGGESTED")]);
    if (cal.status === "fulfilled") setEvents(cal.value.items);
    else setError(errorMessage(cal.reason, "โหลดปฏิทินไม่สำเร็จ"));
    if (actions.status === "fulfilled") setPending(actions.value.items.filter((a) => a.startAt));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const days = useMemo(() => {
    const list: Date[] = [];
    const last = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    for (let d = startOfWeek(startOfMonth(month), { weekStartsOn: 1 }); d <= last; d = addDays(d, 1)) list.push(d);
    return list;
  }, [month]);

  const eventsOn = (day: Date) => events.filter((e) => e.start && isSameDay(new Date(e.start), day));
  const pendingOn = (day: Date) => pending.filter((a) => a.startAt && isSameDay(new Date(a.startAt), day));
  const today = new Date();
  const dayEvents = eventsOn(selected);
  const dayPending = pendingOn(selected);

  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_0.6fr]">
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs lg:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <h2 className="text-lg font-black tracking-tight text-slate-900">{format(month, "MMMM yyyy", { locale: th })}</h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setMonth((m) => subMonths(m, 1))} className="h-9 w-9 rounded-xl p-0" aria-label="เดือนก่อนหน้า">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setMonth((m) => addMonths(m, 1))} className="h-9 w-9 rounded-xl p-0" aria-label="เดือนถัดไป">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setMonth(new Date());
                setSelected(new Date());
              }}
              className="rounded-xl bg-blue-600 text-xs font-bold hover:bg-blue-700"
            >
              วันนี้
            </Button>
          </div>
        </div>

        <div className="mb-2 flex items-center gap-4 px-1 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> อยู่ในปฏิทินแล้ว
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border border-dashed border-amber-500 bg-amber-200" /> จากอีเมล รอยืนยัน
          </span>
          {loading && <span className="animate-pulse">กำลังโหลด...</span>}
        </div>

        {error && (
          <Notice tone="error" className="mb-2">
            {error}
          </Notice>
        )}

        <div className="grid grid-cols-7 py-1 text-center text-xs font-bold text-slate-400">
          {WEEKDAYS.map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((day) => {
            const ev = eventsOn(day);
            const pe = pendingOn(day);
            const more = ev.length + pe.length - 2;
            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelected(day)}
                className={cn(
                  "flex min-h-[84px] flex-col rounded-xl border border-slate-100 p-1.5 text-left transition-colors hover:border-blue-200 hover:bg-blue-50/50",
                  !isSameMonth(day, month) && "bg-slate-50/50 text-slate-300",
                  isSameDay(day, selected) && "border-blue-500 bg-blue-50/80 ring-2 ring-blue-500/20"
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                    isSameDay(day, today) ? "bg-blue-600 text-white" : isSameMonth(day, month) ? "text-slate-700" : "text-slate-400"
                  )}
                >
                  {format(day, "d")}
                </span>
                <div className="mt-1 flex w-full flex-col gap-0.5">
                  {pe.slice(0, 1).map((a) => (
                    <span key={a.id} className="truncate rounded-md border border-dashed border-amber-300 bg-amber-50 px-1 text-[10px] font-bold text-amber-800">
                      {a.title}
                    </span>
                  ))}
                  {ev.slice(0, pe.length > 0 ? 1 : 2).map((e) => (
                    <span key={e.id} className="truncate rounded-md border border-emerald-100 bg-emerald-50 px-1 text-[10px] font-bold text-emerald-700">
                      {e.title}
                    </span>
                  ))}
                  {more > 0 && <span className="pl-1 text-[9px] font-bold text-slate-400">+{more} รายการ</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex max-h-[80vh] flex-col gap-4 overflow-y-auto rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
        <h3 className="text-base font-black text-slate-900">{format(selected, "EEEE d MMMM yyyy", { locale: th })}</h3>

        {dayPending.length > 0 && (
          <section className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-bold text-amber-700">
              <CalendarPlus className="h-3.5 w-3.5" /> จากอีเมล รอยืนยัน ({dayPending.length})
            </p>
            {dayPending.map((a) => (
              <div key={a.id} className="space-y-1.5 rounded-2xl border border-amber-200 bg-amber-50/40 p-3">
                <p className="text-sm font-bold text-slate-900">{a.title}</p>
                <p className="text-xs text-slate-600">{formatWhen(a)}</p>
                {a.availability === "CONFLICT" && <p className="text-[11px] font-bold text-rose-600">{a.availabilityReason}</p>}
                <Link href={`/inbox?email=${a.emailId}`} className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline">
                  เปิดอีเมลเพื่อตรวจและยืนยัน <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            ))}
          </section>
        )}

        <section className="space-y-2">
          <p className="text-xs font-bold text-slate-600">ในปฏิทิน ({dayEvents.length})</p>
          {dayEvents.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 py-8 text-center text-xs text-slate-400">ไม่มีกิจกรรมในวันนี้</p>
          ) : (
            dayEvents.map((e) => (
              <div key={e.id} className="space-y-1.5 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-3">
                <p className="text-sm font-bold text-slate-900">{e.title}</p>
                <p className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  {e.isAllDay ? "ทั้งวัน" : `${timeOf(e.start)} – ${timeOf(e.end)} น.`}
                </p>
                {e.location && (
                  <p className="flex items-center gap-1.5 truncate text-xs text-slate-500">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" /> {e.location}
                  </p>
                )}
                {e.htmlLink && (
                  <a href={e.htmlLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline">
                    เปิดในปฏิทิน <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
