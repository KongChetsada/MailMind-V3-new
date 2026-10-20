"use client";

import { useState } from "react";
import { Zap } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Notice } from "@/components/common/Feedback";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/provider/AuthProvider";
import type { SettingsResponse } from "@/lib/types";
import SettingsSection from "./SettingsSection";

type ToggleField = "isAutoAnalyzeActive" | "notifyNewAppointments";

function ToggleRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-bold text-slate-800">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}

/** สวิตช์การทำงานอัตโนมัติ: วิเคราะห์อีเมลใหม่ และอีเมลแจ้งเตือนนัดหมาย */
export default function AutomationSettings({ data, onSaved }: { data: SettingsResponse; onSaved: (data: SettingsResponse) => void }) {
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const toggle = async (field: ToggleField, value: boolean) => {
    setError(null);
    try {
      onSaved(await api.settings.update({ [field]: value }));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <SettingsSection icon={Zap} title="การทำงานอัตโนมัติ" description="สิ่งที่ระบบทำเองเมื่อมีอีเมลใหม่เข้ามา">
      <div className="divide-y divide-slate-100">
        <ToggleRow
          title="วิเคราะห์อีเมลใหม่อัตโนมัติ"
          description="ปิดไว้ = อีเมลยังถูกดึงเข้ามา แต่จะวิเคราะห์เมื่อคุณกดเองทีละฉบับ"
          checked={data.setting.isAutoAnalyzeActive}
          onChange={(v) => toggle("isAutoAnalyzeActive", v)}
        />
        <ToggleRow
          title="แจ้งเตือนทางอีเมลเมื่อพบนัดหมายใหม่"
          description={`ส่งไปที่ ${user?.email || "อีเมลบัญชีที่เชื่อมไว้"} ครั้งเดียวต่ออีเมลหนึ่งฉบับ เฉพาะนัดหมาย/เลื่อนนัดที่รอยืนยัน`}
          checked={data.setting.notifyNewAppointments}
          onChange={(v) => toggle("notifyNewAppointments", v)}
        />
      </div>
      {error && (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      )}
    </SettingsSection>
  );
}
