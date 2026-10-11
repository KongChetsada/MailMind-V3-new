"use client";

import { useEffect, useState } from "react";
import { Notice, Spinner } from "@/components/common/Feedback";
import { api, errorMessage } from "@/lib/api";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/labels";
import { formatDuration, formatPercent } from "@/lib/format";
import type { Stats } from "@/lib/types";

const RANGES = [7, 30, 90];

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4">
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black tracking-tight text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

/** แท่งแนวนอนสีเดียว: ความยาว = จำนวน ชื่อและตัวเลขเป็นข้อความกำกับโดยตรง */
function BarList({ rows }: { rows: { key: string; label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[130px_1fr_40px] items-center gap-3 text-xs" title={`${r.label}: ${r.value} ฉบับ`}>
          <span className="truncate text-slate-600">{r.label}</span>
          <div className="h-2.5 rounded-full bg-slate-100">
            {r.value > 0 && <div className="h-2.5 rounded-full bg-blue-600" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />}
          </div>
          <span className="text-right font-semibold tabular-nums text-slate-800">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** สถิติการใช้งาน คำนวณจากอีเมล ร่าง และรายการลงปฏิทินในช่วงที่เลือก */
export default function StatsPanel() {
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStats(null);
    setError(null);
    api.summary
      .stats(days)
      .then(setStats)
      .catch((e) => setError(errorMessage(e, "โหลดสถิติไม่สำเร็จ")));
  }, [days]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-800">สถิติการใช้งาน</h2>
        <div className="flex rounded-xl border border-slate-200 bg-slate-100 p-1">
          {RANGES.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-lg px-3 py-1 text-xs font-bold ${days === d ? "bg-white text-blue-600 shadow-sm" : "text-slate-500"}`}
            >
              {d} วัน
            </button>
          ))}
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {!stats && !error && (
        <div className="flex justify-center py-10">
          <Spinner className="h-6 w-6 text-blue-600" />
        </div>
      )}

      {stats && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="อีเมลที่รับเข้า" value={stats.emails.total} hint={`วิเคราะห์แล้ว ${stats.emails.DONE} · ข้าม ${stats.emails.SKIPPED}`} />
            <Tile label="ตอบกลับผ่านระบบ" value={stats.drafts.sent} hint={`แก้ข้อความก่อนส่ง ${stats.drafts.sentAfterEdit} · ทิ้ง ${stats.drafts.discarded}`} />
            <Tile label="บันทึกลงปฏิทิน" value={stats.actions.created} hint={`รอยืนยัน ${stats.actions.suggested} · ไม่ลง ${stats.actions.dismissed}`} />
            <Tile label="เวลาจากรับถึงตอบ (ค่ากลาง)" value={formatDuration(stats.drafts.medianResponseMinutes)} hint="เฉพาะอีเมลที่ตอบผ่านระบบ" />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-4">
              <h3 className="mb-3 text-xs font-bold text-slate-700">จำนวนอีเมลตามประเภท</h3>
              <BarList rows={CATEGORY_ORDER.map((c) => ({ key: c, label: CATEGORY_META[c].short, value: stats.byCategory[c] }))} />
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-white p-4">
              <h3 className="mb-3 text-xs font-bold text-slate-700">คุณภาพการวิเคราะห์ของ AI</h3>
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <dt className="text-slate-600">ผู้ใช้แก้ประเภทเอง</dt>
                  <dd className="font-semibold tabular-nums text-slate-800">
                    {stats.classification.corrected} จาก {stats.classification.analyzed} ({formatPercent(stats.classification.correctionRate)})
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-600">วิเคราะห์ไม่สำเร็จ</dt>
                  <dd className="font-semibold tabular-nums text-slate-800">
                    {stats.emails.FAILED} ฉบับ ({formatPercent(stats.classification.failureRate)})
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-600">รอวิเคราะห์</dt>
                  <dd className="font-semibold tabular-nums text-slate-800">{stats.emails.PENDING + stats.emails.PROCESSING} ฉบับ</dd>
                </div>
              </dl>
              {stats.models.length > 0 && (
                <>
                  <h4 className="mb-1.5 mt-4 text-[11px] font-bold text-slate-500">โมเดลที่ใช้</h4>
                  <ul className="space-y-1 text-xs text-slate-600">
                    {stats.models.map((m) => (
                      <li key={`${m.provider}-${m.model}`} className="flex justify-between">
                        <span>
                          {m.provider} · {m.model || "-"}
                        </span>
                        <span className="font-semibold tabular-nums text-slate-800">{m.analyzed} ฉบับ</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
                อัตราการแก้ประเภทนับเฉพาะอีเมลที่ผู้ใช้เปิดและแก้เอง อีเมลที่จัดผิดแต่ไม่ได้แก้จะไม่ถูกนับ ตัวเลขนี้จึงเป็นค่าต่ำสุดของความผิดพลาด
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
