"use client";

import { useCallback, useEffect, useState } from "react";
import { Cpu, Cloud, KeyRound, PlugZap, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Notice, Spinner } from "@/components/common/Feedback";
import { api, errorMessage } from "@/lib/api";
import type { SettingsResponse } from "@/lib/types";

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

  const toggleAuto = async (value: boolean) => {
    try {
      onSaved(await api.settings.update({ isAutoAnalyzeActive: value }));
    } catch (e) {
      setMessage({ tone: "error", text: errorMessage(e) });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
        <div>
          <p className="text-sm font-bold text-slate-800">วิเคราะห์อีเมลใหม่อัตโนมัติ</p>
          <p className="text-xs text-slate-500">ปิดไว้ = อีเมลยังถูกดึงเข้ามา แต่จะวิเคราะห์เมื่อคุณกดเองทีละฉบับ</p>
        </div>
        <Switch checked={data.setting.isAutoAnalyzeActive} onCheckedChange={toggleAuto} />
      </div>

      <div>
        <Label className="text-xs font-bold text-slate-600">ผู้ให้บริการ AI</Label>
        <div className="mt-2 flex items-center gap-2">
          {provider.isLocal ? <Cpu className="h-4 w-4 shrink-0 text-emerald-600" /> : <Cloud className="h-4 w-4 shrink-0 text-blue-600" />}
          <select
            value={providerId}
            onChange={(e) => selectProvider(e.target.value)}
            aria-label="ผู้ให้บริการ AI"
            className="h-9 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800"
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
        {providerId !== data.setting.aiProvider && (
          <p className="mt-1 text-[11px] text-slate-500">
            ตอนนี้ใช้ {data.providers.find((p) => p.id === data.setting.aiProvider)?.label || data.setting.aiProvider} อยู่ — กด “ใช้ผู้ให้บริการและโมเดลนี้” ด้านล่างเพื่อเปลี่ยน
          </p>
        )}
      </div>

      {provider.isLocal ? (
        <Notice tone="success">เนื้อหาอีเมลถูกประมวลผลโดย Ollama บนเครื่องที่รัน Backend ไม่ถูกส่งให้ผู้ให้บริการ AI ภายนอก</Notice>
      ) : (
        <Notice tone="warn">
          เมื่อเลือก {provider.label} เนื้อหาอีเมลที่วิเคราะห์และร่างตอบจะถูกส่งไปยังเซิร์ฟเวอร์ของผู้ให้บริการรายนี้ ตรวจนโยบายข้อมูลขององค์กรก่อนใช้กับอีเมลงาน
        </Notice>
      )}

      {provider.requiresKey && (
        <div>
          <Label className="text-xs font-bold text-slate-600">API key ของ {provider.label}</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider.hasKey ? "บันทึกไว้แล้ว — พิมพ์เพื่อเปลี่ยน" : "วาง API key"}
              autoComplete="off"
              className="h-9 min-w-[220px] flex-1 rounded-xl text-sm"
            />
            <Button size="sm" onClick={saveKey} disabled={busy !== null || apiKey.trim().length < 8} className="h-9 rounded-xl bg-slate-800 text-xs hover:bg-slate-900">
              <KeyRound className="mr-1.5 h-3.5 w-3.5" /> บันทึก key
            </Button>
            {provider.hasKey && (
              <Button size="sm" variant="ghost" onClick={deleteKey} disabled={busy !== null} className="h-9 rounded-xl text-xs text-rose-600">
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> ลบ
              </Button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">key ถูกเข้ารหัสก่อนเก็บ และไม่ถูกส่งกลับมาที่หน้าเว็บอีก</p>
        </div>
      )}

      <div>
        <Label className="text-xs font-bold text-slate-600">โมเดล</Label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            list="ai-models"
            placeholder={provider.defaultModel ? `ค่าเริ่มต้น: ${provider.defaultModel}` : "ชื่อโมเดล"}
            className="h-9 min-w-[220px] flex-1 rounded-xl text-sm"
          />
          <datalist id="ai-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          {busy === "models" && <Spinner className="text-slate-400" />}
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          {models.length > 0 ? `พบ ${models.length} โมเดล เลือกจากรายการหรือพิมพ์ชื่อเอง` : "พิมพ์ชื่อโมเดลตามที่ผู้ให้บริการกำหนด"}
        </p>
      </div>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={test} disabled={busy !== null || (provider.requiresKey && !provider.hasKey && !apiKey)} className="rounded-xl text-xs">
          {busy === "test" ? <Spinner className="mr-1.5 h-3 w-3" /> : <PlugZap className="mr-1.5 h-3.5 w-3.5" />}
          ทดสอบการเชื่อมต่อ
        </Button>
        <Button size="sm" onClick={save} disabled={busy !== null || !dirty} className="rounded-xl bg-blue-600 text-xs font-bold hover:bg-blue-700">
          {busy === "save" && <Spinner className="mr-1.5 h-3 w-3" />} ใช้ผู้ให้บริการและโมเดลนี้
        </Button>
      </div>
    </div>
  );
}
