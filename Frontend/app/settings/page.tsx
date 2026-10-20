"use client";

import { useEffect, useState } from "react";
import { Settings as SettingsIcon, UserRound } from "lucide-react";
import AppShell from "@/components/layout/AppShell";
import AiSettings from "@/components/settings/AiSettings";
import AutomationSettings from "@/components/settings/AutomationSettings";
import ProfileSettings from "@/components/settings/ProfileSettings";
import SettingsSection from "@/components/settings/SettingsSection";
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
    <div className="grid items-start gap-5 xl:grid-cols-2">
      <SettingsSection icon={UserRound} title="ข้อมูลผู้ใช้และเวลาทำงาน" description="ใช้ในร่างตอบกลับ และใช้ตรวจว่านัดหมายอยู่ในเวลาทำงานหรือไม่">
        <ProfileSettings data={data} onSaved={setData} />
      </SettingsSection>
      <div className="space-y-5">
        <AutomationSettings data={data} onSaved={setData} />
        <AiSettings data={data} onSaved={setData} />
      </div>
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
