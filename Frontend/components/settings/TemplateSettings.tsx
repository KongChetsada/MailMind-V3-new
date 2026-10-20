"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Notice, Spinner } from "@/components/common/Feedback";
import { api, errorMessage } from "@/lib/api";
import { CATEGORY_META, CATEGORY_ORDER, INTENT_LABEL } from "@/lib/labels";
import type { EmailCategory, ReplyIntent, ReplyTemplate, ReplyTemplateInput } from "@/lib/types";
import { cn } from "@/lib/utils";
import SettingsSection, { Field } from "./SettingsSection";

const INTENTS = Object.keys(INTENT_LABEL) as ReplyIntent[];
const EMPTY: ReplyTemplateInput = { name: "", category: null, intent: null, whenToUse: "", body: "" };
const selectClass = "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800";

/** ฟอร์มสร้าง / แก้ template */
function TemplateForm({ initial, onSave, onCancel }: { initial: ReplyTemplateInput; onSave: (input: ReplyTemplateInput) => Promise<void>; onCancel: () => void }) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ReplyTemplateInput>(key: K, value: ReplyTemplateInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...form, whenToUse: form.whenToUse?.trim() || null });
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="ชื่อ template">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={80} placeholder="เช่น ตอบรับนัดประชุม" className="h-10 rounded-xl bg-white text-sm" />
        </Field>
        <Field label="ใช้เมื่อ" hint="ช่วยให้ระบบค้นหา template ได้ตรงกรณี">
          <Input value={form.whenToUse || ""} onChange={(e) => set("whenToUse", e.target.value)} maxLength={500} placeholder="เช่น อีกฝ่ายขอเลื่อนนัดเดิม และวันใหม่ว่าง" className="h-10 rounded-xl bg-white text-sm" />
        </Field>
        <Field label="ประเภทอีเมล">
          <select value={form.category || ""} onChange={(e) => set("category", (e.target.value || null) as EmailCategory | null)} className={selectClass}>
            <option value="">ทุกประเภท</option>
            {CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_META[c].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="เจตนาของคำตอบ">
          <select value={form.intent || ""} onChange={(e) => set("intent", (e.target.value || null) as ReplyIntent | null)} className={selectClass}>
            <option value="">ทุกเจตนา</option>
            {INTENTS.map((i) => (
              <option key={i} value={i}>
                {INTENT_LABEL[i]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field
        label="เนื้อหา"
        hint="ใส่ข้อความใน [ ] เป็นตัวยึด เช่น [ชื่อผู้ส่ง] [วันเวลา] [สถานที่] — AI จะแทนด้วยข้อมูลจริง ไม่ต้องใส่สรรพนาม คำลงท้าย และลายเซ็น ระบบเติมจากโปรไฟล์ให้"
      >
        <Textarea value={form.body} onChange={(e) => set("body", e.target.value)} rows={7} maxLength={4000} className="rounded-xl bg-white text-sm leading-relaxed" />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving} className="rounded-xl text-xs">
          ยกเลิก
        </Button>
        <Button size="sm" onClick={save} disabled={saving || !form.name.trim() || !form.body.trim()} className="rounded-xl bg-blue-600 text-xs font-bold hover:bg-blue-700">
          {saving && <Spinner className="mr-1.5 h-3 w-3" />} บันทึก template
        </Button>
      </div>
    </div>
  );
}

/** คลัง template ตอบกลับ — AI ค้นหาอันที่ใกล้กับอีเมลที่สุดมาเป็นฐานตอนร่าง */
export default function TemplateSettings() {
  const [items, setItems] = useState<ReplyTemplate[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.templates
      .list()
      .then((data) => setItems(data.items))
      .catch((e) => setError(errorMessage(e, "โหลด template ไม่สำเร็จ")));
  }, []);

  // จัดกลุ่มตามประเภทอีเมล ตามลำดับแถบประเภทใน Inbox ("ทุกประเภท" อยู่ท้าย)
  const groups = useMemo(() => {
    const order = [...CATEGORY_ORDER, null] as (EmailCategory | null)[];
    return order
      .map((category) => ({ category, items: (items || []).filter((t) => t.category === category) }))
      .filter((g) => g.items.length > 0);
  }, [items]);

  const replace = (t: ReplyTemplate) => setItems((list) => (list || []).map((x) => (x.id === t.id ? t : x)));

  const create = async (input: ReplyTemplateInput) => {
    const { template } = await api.templates.create(input);
    setItems((list) => [...(list || []), template]);
    setEditing(null);
  };

  const update = async (id: string, input: Partial<ReplyTemplateInput>) => {
    replace((await api.templates.update(id, input)).template);
    setEditing(null);
  };

  const toggle = async (t: ReplyTemplate, isActive: boolean) => {
    setError(null);
    try {
      replace((await api.templates.update(t.id, { isActive })).template);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const remove = async (t: ReplyTemplate) => {
    if (!window.confirm(`ลบ template "${t.name}"?`)) return;
    setError(null);
    try {
      await api.templates.remove(t.id);
      setItems((list) => (list || []).filter((x) => x.id !== t.id));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <SettingsSection
      icon={FileText}
      title="Template ตอบกลับ"
      description="ตอนร่างคำตอบ AI ค้นหา template ที่ตรงกับประเภท เจตนา และเนื้อหาอีเมลที่สุด แล้วใช้เป็นฐานของสำนวน — แก้ให้เป็นสำนวนของคุณได้"
      footer={
        <Button size="sm" onClick={() => setEditing("new")} disabled={editing !== null} className="rounded-xl bg-blue-600 text-xs font-bold hover:bg-blue-700">
          <Plus className="mr-1 h-3.5 w-3.5" /> เพิ่ม template
        </Button>
      }
    >
      {error && (
        <Notice tone="error" className="mb-4">
          {error}
        </Notice>
      )}
      {editing === "new" && (
        <div className="mb-5">
          <TemplateForm initial={EMPTY} onSave={create} onCancel={() => setEditing(null)} />
        </div>
      )}
      {!items ? (
        <div className="flex justify-center py-8">
          <Spinner className="h-5 w-5 text-blue-600" />
        </div>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">ยังไม่มี template — AI จะร่างจากคำสั่งกลางของระบบ</p>
      ) : (
        <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
          {groups.map((g) => {
            const meta = g.category ? CATEGORY_META[g.category] : null;
            const Icon = meta?.icon || FileText;
            return (
              <div key={g.category || "any"}>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-500">
                  <Icon className="h-3.5 w-3.5" /> {meta?.label || "ทุกประเภท"}
                </p>
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {g.items.map((t) =>
                    editing === t.id ? (
                      <div key={t.id} className="p-2">
                        <TemplateForm
                          initial={{ name: t.name, category: t.category, intent: t.intent, whenToUse: t.whenToUse, body: t.body }}
                          onSave={(input) => update(t.id, input)}
                          onCancel={() => setEditing(null)}
                        />
                      </div>
                    ) : (
                      <div key={t.id} className={cn("flex items-start gap-3 px-4 py-3", !t.isActive && "opacity-55")}>
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-800">
                            {t.name}
                            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{t.intent ? INTENT_LABEL[t.intent] : "ทุกเจตนา"}</span>
                          </p>
                          {t.whenToUse && <p className="mt-0.5 text-xs text-slate-500">ใช้เมื่อ: {t.whenToUse}</p>}
                          <p className="mt-1 line-clamp-2 text-xs text-slate-400">{t.body.replace(/\s*\n+\s*/g, " ")}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Switch checked={t.isActive} onCheckedChange={(v) => toggle(t, v)} aria-label={`ใช้ template ${t.name}`} />
                          <button onClick={() => setEditing(t.id)} disabled={editing !== null} title="แก้ไข" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40">
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button onClick={() => remove(t)} disabled={editing !== null} title="ลบ" className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 disabled:opacity-40">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SettingsSection>
  );
}
