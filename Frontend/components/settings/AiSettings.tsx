"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Cpu, Cloud, KeyRound, PlugZap, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice, Spinner } from "@/components/common/Feedback";
import { api, errorMessage } from "@/lib/api";
import type { SettingsResponse } from "@/lib/types";
import SettingsSection, { Field } from "./SettingsSection";

interface Props {
  data: SettingsResponse;
  onSaved: (data: SettingsResponse) => void;
}

/** เลือกผู้ให้บริการ AI โมเดล และจัดการ API key */
export default function AiSettings({ data, onSaved }: Props) {
  const [providerId, setProviderId] = useState(data.setting.aiProvider);
  const [model, setModel] = useState(data.setting.aiModel || "");
  const [models, setModels] = useState<string[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "key" | "models" | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const provider = data.providers.find((p) => p.id === providerId) || data.providers[0];
  const active = data.providers.find((p) => p.id === data.setting.aiProvider);
  const activeModel = data.setting.aiModel || active?.defaultModel || "ค่าเริ่มต้น";
  const dirty = providerId !== data.setting.aiProvider || (model || null) !== (data.setting.aiModel || null);

  const loadModels = useCallback(async (id: string) => {
    setBusy("models");
    try {
      setModels((await api.settings.models(id)).models.map((m) => m.id));
    } catch {
      setModels([]); // ดึงรายชื่อไม่ได้ ผู้ใช้ยังพิมพ์ชื่อโมเดลเองได้
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    setModels([]);
    if (provider.hasKey) loadModels(provider.id);
  }, [provider.id, provider.hasKey, loadModels]);

  const act = async (kind: "save" | "test" | "key", fn: () => Promise<string>) => {
    setBusy(kind);
    setMessage(null);
    try {
      setMessage({ tone: "success", text: await fn() });
    } catch (e) {
      setMessage({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const selectProvider = (id: string) => {
    setProviderId(id);
    setModel(id === data.setting.aiProvider ? data.setting.aiModel || "" : "");
    setApiKey("");
    setMessage(null);
  };

  const saveKey = () =>
    act("key", async () => {
      onSaved(await api.settings.saveKey(provider.id, apiKey));
      setApiKey("");
      return `บันทึก API key ของ ${provider.label} แล้ว`;
    });

  const deleteKey = () =>
    act("key", async () => {
      onSaved(await api.settings.deleteKey(provider.id));
      return `ลบ API key ของ ${provider.label} แล้ว`;
    });

  const test = () =>
    act("test", async () => {
      const result = await api.settings.testAi({ provider: provider.id, model: model || undefined, apiKey: apiKey || undefined });
      return `เชื่อมต่อ ${provider.label} สำเร็จ (โมเดล ${result.model})`;
    });

  const save = () =>
    act("save", async () => {
      onSaved(await api.settings.update({ aiProvider: provider.id, aiModel: model || null }));
      return "บันทึกการตั้งค่า AI แล้ว";
    });

  const ProviderIcon = provider.isLocal ? Cpu : Cloud;

  return (
    <SettingsSection
      icon={Bot}
      title="ผู้ให้บริการ AI"
      description={
        <>
          ใช้อยู่: <span className="font-semibold text-slate-700">{active?.label || data.setting.aiProvider}</span> · {activeModel}
        </>
      }
      footer={
        <>
          <Button size="sm" variant="outline" onClick={test} disabled={busy !== null || (provider.requiresKey && !provider.hasKey && !apiKey)} className="rounded-xl bg-white text-xs">
            {busy === "test" ? <Spinner className="mr-1.5 h-3 w-3" /> : <PlugZap className="mr-1.5 h-3.5 w-3.5" />}
            ทดสอบการเชื่อมต่อ
          </Button>
          <Button size="sm" onClick={save} disabled={busy !== null || !dirty} className="ml-auto rounded-xl bg-blue-600 text-xs font-bold hover:bg-blue-700">
            {busy === "save" && <Spinner className="mr-1.5 h-3 w-3" />} ใช้ผู้ให้บริการและโมเดลนี้
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field
          label="ผู้ให้บริการ"
          hint={
            providerId !== data.setting.aiProvider
              ? `ยังไม่ได้เปลี่ยน — ตอนนี้ใช้ ${active?.label || data.setting.aiProvider} อยู่ กด “ใช้ผู้ให้บริการและโมเดลนี้” ด้านล่างเพื่อเปลี่ยน`
              : undefined
          }
        >
          <div className="relative">
            <ProviderIcon className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${provider.isLocal ? "text-emerald-600" : "text-blue-600"}`} />
            <select
              value={providerId}
              onChange={(e) => selectProvider(e.target.value)}
              aria-label="ผู้ให้บริการ AI"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold text-slate-800"
            >
              {data.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.isLocal ? " — ประมวลผลในเครื่อง" : p.hasKey ? " — มี API key แล้ว" : " — ต้องใส่ API key"}
                  {p.id === data.setting.aiProvider ? " (ใช้อยู่)" : ""}
                </option>
              ))}
            </select>
          </div>
        </Field>

        {provider.isLocal ? (
          <Notice tone="success">เนื้อหาอีเมลถูกประมวลผลโดย Ollama บนเครื่องที่รัน Backend ไม่ถูกส่งให้ผู้ให้บริการ AI ภายนอก</Notice>
        ) : (
          <Notice tone="warn">
            เมื่อเลือก {provider.label} เนื้อหาอีเมลที่วิเคราะห์และร่างตอบจะถูกส่งไปยังเซิร์ฟเวอร์ของผู้ให้บริการรายนี้ ตรวจนโยบายข้อมูลขององค์กรก่อนใช้กับอีเมลงาน
          </Notice>
        )}

        {provider.requiresKey && (
          <Field label={`API key ของ ${provider.label}`} hint="key ถูกเข้ารหัสก่อนเก็บ และไม่ถูกส่งกลับมาที่หน้าเว็บอีก">
            <div className="flex flex-wrap gap-2">
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider.hasKey ? "บันทึกไว้แล้ว — พิมพ์เพื่อเปลี่ยน" : "วาง API key"}
                autoComplete="off"
                className="h-10 min-w-[200px] flex-1 rounded-xl text-sm"
              />
              <Button size="sm" onClick={saveKey} disabled={busy !== null || apiKey.trim().length < 8} className="h-10 rounded-xl bg-slate-800 text-xs hover:bg-slate-900">
                <KeyRound className="mr-1.5 h-3.5 w-3.5" /> บันทึก key
              </Button>
              {provider.hasKey && (
                <Button size="sm" variant="ghost" onClick={deleteKey} disabled={busy !== null} className="h-10 rounded-xl text-xs text-rose-600 hover:bg-rose-50">
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> ลบ
                </Button>
              )}
            </div>
          </Field>
        )}

        <Field
          label="โมเดล"
          hint={models.length > 0 ? `พบ ${models.length} โมเดล เลือกจากรายการหรือพิมพ์ชื่อเอง` : "พิมพ์ชื่อโมเดลตามที่ผู้ให้บริการกำหนด"}
        >
          <div className="relative">
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              list="ai-models"
              placeholder={provider.defaultModel ? `ค่าเริ่มต้น: ${provider.defaultModel}` : "ชื่อโมเดล"}
              className="h-10 w-full rounded-xl pr-9 text-sm"
            />
            {busy === "models" && <Spinner className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />}
            <datalist id="ai-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
        </Field>

        {message && <Notice tone={message.tone}>{message.text}</Notice>}
      </div>
    </SettingsSection>
  );
}
