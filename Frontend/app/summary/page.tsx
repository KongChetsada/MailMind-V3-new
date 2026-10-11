"use client";

import { BarChart3 } from "lucide-react";
import AppShell from "@/components/layout/AppShell";
import SummaryPanel from "@/components/summary/SummaryPanel";
import StatsPanel from "@/components/summary/StatsPanel";

export default function SummaryPage() {
  return (
    <AppShell title="สรุปและสถิติ" description="สรุปตารางงานและตัวเลขการใช้งานระบบ" icon={BarChart3} bare>
      <div className="space-y-6">
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <SummaryPanel />
        </section>
        <StatsPanel />
      </div>
    </AppShell>
  );
}
