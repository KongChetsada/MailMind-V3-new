"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Sparkles, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/common/Feedback";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { SummaryType } from "@/lib/types";
import { cn } from "@/lib/utils";

const TABS: { type: SummaryType; label: string }[] = [
  { type: "DAILY", label: "วันนี้" },
  { type: "WEEKLY", label: "สัปดาห์นี้" },
  { type: "MONTHLY", label: "เดือนนี้" },
];

/** แสดงข้อความสรุปที่ใช้หัวข้อ (#, ##) และรายการ (-) แบบ markdown อย่างง่าย */
function SummaryText({ content }: { content: string }) {
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-slate-700">
      {content.split("\n").map((line, i) => {
        if (line.startsWith("## ")) return <h4 key={i} className="pt-3 text-xs font-bold uppercase tracking-wider text-slate-500">{line.slice(3)}</h4>;
        if (line.startsWith("# ")) return <h3 key={i} className="text-base font-black text-slate-900">{line.slice(2)}</h3>;
        if (line.startsWith("- ")) return <p key={i} className="flex gap-2 pl-1"><span className="text-slate-400">•</span><span>{line.slice(2)}</span></p>;
        return line.trim() ? <p key={i}>{line}</p> : null;
      })}
    </div>
  );
}

/** สรุปตารางงานจากปฏิทินและรายการที่รอยืนยัน (เก็บผลไว้ต่อช่วงเวลา กดสร้างใหม่ได้) */
export default function SummaryPanel() {
  const [type, setType] = useState<SummaryType>("DAILY");
  const [content, setContent] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (t: SummaryType, force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.summary.get(t, force);
      setContent(data.content);
      setGeneratedAt(data.generatedAt);
    } catch (e) {
      setContent(null);
      setError(errorMessage(e, "สร้างสรุปไม่สำเร็จ"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(type, false);
  }, [type, load]);

  const copy = () => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-xl border border-slate-200 bg-slate-100 p-1">
          {TABS.map((tab) => (
            <button
              key={tab.type}
              onClick={() => setType(tab.type)}
              className={cn("rounded-lg px-4 py-1.5 text-xs font-bold", type === tab.type ? "bg-white text-blue-600 shadow-sm" : "text-slate-500")}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {content && (
            <Button variant="outline" size="sm" onClick={copy} className="rounded-xl text-xs">
              {copied ? <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-600" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
              {copied ? "คัดลอกแล้ว" : "คัดลอก"}
            </Button>
          )}
          <Button size="sm" onClick={() => load(type, true)} disabled={loading} className="rounded-xl bg-blue-600 text-xs font-bold hover:bg-blue-700">
            {loading ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
            สร้างสรุปใหม่
          </Button>
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="min-h-[220px] rounded-2xl border border-slate-200/80 bg-slate-50/70 p-5">
        {loading ? (
          <p className="animate-pulse py-10 text-center text-sm font-semibold text-slate-500">กำลังสรุปตารางงาน...</p>
        ) : content ? (
          <>
            <SummaryText content={content} />
            <p className="mt-4 text-[11px] text-slate-400">สร้างเมื่อ {formatDateTime(generatedAt)} · รายการมาจากปฏิทินและอีเมลโดยตรง ย่อหน้าภาพรวมเขียนโดย AI</p>
          </>
        ) : (
          !error && <p className="py-10 text-center text-sm text-slate-400">ยังไม่มีสรุปสำหรับช่วงเวลานี้</p>
        )}
      </div>
    </div>
  );
}
