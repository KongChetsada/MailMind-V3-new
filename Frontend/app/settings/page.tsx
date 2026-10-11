"use client";

import { useEffect, useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import AppShell from "@/components/layout/AppShell";
import AiSettings from "@/components/settings/AiSettings";
import ProfileSettings from "@/components/settings/ProfileSettings";
import { Notice, Spinner } from "@/components/common/Feedback";
import { api, errorMessage } from "@/lib/api";
import type { SettingsResponse } from "@/lib/types";

function Loader() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.settings
      .get()
      .then(setData)
      .catch((e) => setError(errorMessage(e, "โหลดการตั้งค่าไม่สำเร็จ")));
  }, []);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-blue-600" />
      </div>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
        <h2 className="mb-4 text-sm font-black text-slate-900">ข้อมูลผู้ใช้และเวลาทำงาน</h2>
        <ProfileSettings data={data} onSaved={setData} />
      </section>
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
        <h2 className="mb-4 text-sm font-black text-slate-900">โมเดล AI</h2>
        <AiSettings data={data} onSaved={setData} />
      </section>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <AppShell title="ตั้งค่า" description="ข้อมูลสำหรับร่างตอบกลับ เวลาทำงาน และโมเดล AI" icon={SettingsIcon} bare>
      <Loader />
    </AppShell>
  );
}
