"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Notice, Spinner } from "@/components/common/Feedback";
import { api, errorMessage } from "@/lib/api";
import type { SettingsResponse, UserSetting } from "@/lib/types";
import { cn } from "@/lib/utils";

const DAYS = [
  { id: "mon", label: "จ" },
  { id: "tue", label: "อ" },
  { id: "wed", label: "พ" },
  { id: "thu", label: "พฤ" },
  { id: "fri", label: "ศ" },
  { id: "sat", label: "ส" },
  { id: "sun", label: "อา" },
];
const TIMEZONES = ["Asia/Bangkok", "Asia/Tokyo", "Asia/Singapore", "Europe/London", "America/New_York"];
const selectClass = "h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <Label className="text-xs font-bold text-slate-600">{label}</Label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

/** ข้อมูลที่ใช้ร่างตอบกลับ (ชื่อ สรรพนาม โทน ลายเซ็น) และเวลาทำงานที่ใช้ตรวจตาราง */
export default function ProfileSettings({ data, onSaved }: { data: SettingsResponse; onSaved: (data: SettingsResponse) => void }) {
  const [form, setForm] = useState<UserSetting>(data.setting);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const set = <K extends keyof UserSetting>(key: K, value: UserSetting[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggleDay = (id: string) => set("workDays", form.workDays.includes(id) ? form.workDays.filter((d) => d !== id) : [...form.workDays, id]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      onSaved(
        await api.settings.update({
          firstName: form.firstName || null,
          lastName: form.lastName || null,
          position: form.position || null,
          signature: form.signature || null,
          gender: form.gender,
          tone: form.tone,
          startTime: form.startTime,
          endTime: form.endTime,
          workDays: form.workDays,
          timezone: form.timezone,
        })
      );
      setMessage({ tone: "success", text: "บันทึกแล้ว" });
    } catch (e) {
      setMessage({ tone: "error", text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="ชื่อ">
          <Input value={form.firstName || ""} onChange={(e) => set("firstName", e.target.value)} className="h-9 rounded-xl text-sm" />
        </Field>
        <Field label="นามสกุล">
          <Input value={form.lastName || ""} onChange={(e) => set("lastName", e.target.value)} className="h-9 rounded-xl text-sm" />
        </Field>
        <Field label="ตำแหน่ง" hint="แสดงใต้ชื่อในลายเซ็น">
          <Input value={form.position || ""} onChange={(e) => set("position", e.target.value)} className="h-9 rounded-xl text-sm" />
        </Field>
        <Field label="สรรพนามในคำตอบ">
          <select value={form.gender || ""} onChange={(e) => set("gender", (e.target.value || null) as UserSetting["gender"])} className={selectClass}>
            <option value="">ฉัน / ครับ/ค่ะ</option>
            <option value="MALE">ผม / ครับ</option>
            <option value="FEMALE">ดิฉัน / ค่ะ</option>
          </select>
        </Field>
        <Field label="โทนการเขียน">
          <select value={form.tone} onChange={(e) => set("tone", e.target.value as UserSetting["tone"])} className={selectClass}>
            <option value="formal">เป็นทางการ</option>
            <option value="casual">เป็นกันเอง</option>
          </select>
        </Field>
        <Field label="เขตเวลา">
          <select value={form.timezone} onChange={(e) => set("timezone", e.target.value)} className={selectClass}>
            {[...new Set([form.timezone, ...TIMEZONES])].map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="คำลงท้าย" hint="เช่น ขอแสดงความนับถือ — ระบบจะต่อด้วยชื่อและตำแหน่ง">
        <Textarea value={form.signature || ""} onChange={(e) => set("signature", e.target.value)} rows={2} placeholder="ขอแสดงความนับถือ" className="rounded-xl text-sm" />
      </Field>

      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
        <p className="text-sm font-bold text-slate-800">เวลาทำงาน</p>
        <p className="mb-3 text-xs text-slate-500">ใช้ตัดสินว่านัดหมายอยู่ในเวลาที่รับได้หรือไม่ และใช้หาเวลาว่างเพื่อเสนอกลับ</p>
        <div className="flex flex-wrap items-center gap-3">
          <Input type="time" value={form.startTime} onChange={(e) => set("startTime", e.target.value)} className="h-9 w-28 rounded-xl bg-white text-sm" />
          <span className="text-xs text-slate-400">ถึง</span>
          <Input type="time" value={form.endTime} onChange={(e) => set("endTime", e.target.value)} className="h-9 w-28 rounded-xl bg-white text-sm" />
          <div className="flex gap-1">
            {DAYS.map((d) => (
              <button
                key={d.id}
                onClick={() => toggleDay(d.id)}
                className={cn(
                  "h-9 w-9 rounded-xl border text-xs font-bold",
                  form.workDays.includes(d.id) ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-500"
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Button size="sm" onClick={save} disabled={saving || form.workDays.length === 0} className="rounded-xl bg-blue-600 text-xs font-bold hover:bg-blue-700">
        {saving && <Spinner className="mr-1.5 h-3 w-3" />} บันทึก
      </Button>
    </div>
  );
}
