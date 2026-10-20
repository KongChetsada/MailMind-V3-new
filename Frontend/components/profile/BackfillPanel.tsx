"use client";

import { useEffect, useState } from "react";
import { History, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice, Spinner } from "@/components/common/Feedback";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { MailAccount } from "@/lib/types";

const POLL_MS = 3000;

/** ดึงอีเมลย้อนหลังทั้งหมดของบัญชีหนึ่งบัญชี พร้อมความคืบหน้า */
export default function BackfillPanel({ account, onChange }: { account: MailAccount; onChange: (account: MailAccount) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { status, count, oldestAt } = account.backfill;
  const running = status === "running";

  // ระหว่างทำงาน โหลดสถานะซ้ำจนเสร็จหรือหยุด
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      try {
        const fresh = (await api.accounts()).items.find((a) => a.id === account.id);
        if (fresh) onChange(fresh);
      } catch {
        // ลองใหม่รอบถัดไป
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, account.id, onChange]);

  const run = async (fn: () => Promise<{ account: MailAccount }>) => {
    setBusy(true);
    setError(null);
    try {
      onChange((await fn()).account);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const progress =
    count > 0
      ? `ดึงเพิ่มแล้ว ${count.toLocaleString("th-TH")} ฉบับ${oldestAt ? ` · ย้อนถึง ${formatDate(oldestAt)}` : ""}`
      : status === "done" && oldestAt
        ? `ไม่มีอีเมลที่เก่ากว่า ${formatDate(oldestAt)}`
        : "";

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <History className="h-3.5 w-3.5 text-slate-400" /> อีเมลย้อนหลัง
          </p>
          <p className="text-[11px] text-slate-500">
            {status === "idle" && "ตอนเชื่อมบัญชีระบบดึงมาแค่ 7 วันล่าสุด กดเพื่อดึงอีเมลเก่าในกล่องขาเข้าทั้งหมด"}
            {status === "running" && (progress || "กำลังเริ่มดึง...")}
            {status === "paused" && `หยุดไว้ · ${progress}`}
            {status === "failed" && (progress ? `หยุดเพราะเกิดข้อผิดพลาด · ${progress}` : "หยุดเพราะเกิดข้อผิดพลาด")}
            {status === "done" && `ดึงครบแล้ว${progress ? ` · ${progress}` : ""}`}
          </p>
        </div>
        {running ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => api.backfill.stop(account.id))} className="h-8 rounded-lg text-xs">
            <Spinner className="mr-1.5 h-3 w-3" /> <Pause className="mr-1 h-3 w-3" /> หยุด
          </Button>
        ) : status !== "done" ? (
          <Button
            size="sm"
            disabled={busy || account.status !== "ACTIVE"}
            onClick={() => run(() => api.backfill.start(account.id))}
            className="h-8 rounded-lg bg-blue-600 text-xs font-bold hover:bg-blue-700"
          >
            <Play className="mr-1 h-3 w-3" /> {status === "idle" ? "ดึงอีเมลย้อนหลังทั้งหมด" : "ทำต่อ"}
          </Button>
        ) : null}
      </div>
      {status !== "idle" && <p className="mt-1 text-[11px] text-slate-400">อีเมลย้อนหลังไม่ถูกวิเคราะห์อัตโนมัติ เปิดฉบับที่ต้องการแล้วกด “วิเคราะห์ตอนนี้”</p>}
      {status === "failed" && account.backfill.error && (
        <Notice tone="error" className="mt-2">
          {account.backfill.error}
        </Notice>
      )}
      {error && (
        <Notice tone="error" className="mt-2">
          {error}
        </Notice>
      )}
    </div>
  );
}
