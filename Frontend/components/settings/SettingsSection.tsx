import type { ComponentType, ReactNode } from "react";
import { Label } from "@/components/ui/label";

/** การ์ดหนึ่งบล็อกของหน้าตั้งค่า: หัวการ์ด + เนื้อหา + แถบปุ่มด้านล่าง (ถ้ามี) */
export default function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
  footer,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
      <header className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-black text-slate-900">{title}</h2>
          {description && <div className="mt-0.5 text-xs text-slate-500">{description}</div>}
        </div>
      </header>
      <div className="px-5 py-5">{children}</div>
      {footer && <footer className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">{footer}</footer>}
    </section>
  );
}

/** ช่องกรอกหนึ่งช่อง: ป้ายชื่อ + ตัวควบคุม + คำอธิบาย ชิดซ้ายแนวเดียวกันทุกช่อง */
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-bold text-slate-700">{label}</Label>
      {children}
      {hint && <div className="text-[11px] leading-relaxed text-slate-400">{hint}</div>}
    </div>
  );
}
