import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  error: { box: "border-rose-200 bg-rose-50 text-rose-800", icon: AlertTriangle },
  warn: { box: "border-amber-200 bg-amber-50 text-amber-900", icon: AlertTriangle },
  success: { box: "border-emerald-200 bg-emerald-50 text-emerald-800", icon: CheckCircle2 },
  info: { box: "border-slate-200 bg-slate-50 text-slate-700", icon: Info },
} as const;

/** กล่องข้อความแจ้งผล ใช้รูปแบบเดียวกันทั้งแอป */
export function Notice({ tone = "info", children, className }: { tone?: keyof typeof TONES; children: ReactNode; className?: string }) {
  const { box, icon: Icon } = TONES[tone];
  return (
    <div className={cn("flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-relaxed", box, className)}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin", className)} />;
}

export function EmptyState({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-12 text-center">
      <p className="text-sm font-semibold text-slate-600">{title}</p>
      {hint && <p className="max-w-sm text-xs text-slate-400">{hint}</p>}
      {children}
    </div>
  );
}
