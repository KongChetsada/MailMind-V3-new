"use client";

import { useEffect, useState } from "react";
import { Send, Sparkles, Trash2, PenLine, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Notice, Spinner } from "@/components/common/Feedback";
import { api, errorMessage } from "@/lib/api";
import { INTENT_LABEL } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import type { ReplyDraft, ReplyIntent } from "@/lib/types";

interface Props {
  emailId: string;
  recipient: string | null;
  draft: ReplyDraft | null;
  needsReply: boolean;
  onChange: (draft: ReplyDraft) => void;
}

const INTENTS = Object.keys(INTENT_LABEL) as ReplyIntent[];

/** ร่างตอบกลับ: ให้ AI ร่างหรือเขียนเอง ผู้ใช้ตรวจแก้ แล้วกดส่งด้วยตัวเอง (การส่งไม่แตะปฏิทิน) */
export default function ReplyPanel({ emailId, recipient, draft, needsReply, onChange }: Props) {
  const [body, setBody] = useState(draft?.body || "");
  const [intent, setIntent] = useState<ReplyIntent | "">("");
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState<"generate" | "send" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBody(draft?.body || "");
    setWriting(false);
    setError(null);
  }, [emailId, draft?.id, draft?.updatedAt, draft?.body]);

  const run = async (kind: "generate" | "send" | "discard", fn: () => Promise<{ draft: ReplyDraft }>) => {
    setBusy(kind);
    setError(null);
    try {
      onChange((await fn()).draft);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const generate = () => run("generate", () => api.emails.createDraft(emailId, intent ? { intent } : {}));
  const active = draft && (draft.status === "PENDING" || draft.status === "FAILED");

  const send = async () => {
    if (active) return run("send", () => api.drafts.send(draft.id, body));
    // เขียนเอง: บันทึกเป็นร่างก่อนแล้วส่ง เพื่อให้มีสถานะติดตามได้เหมือนร่างจาก AI
    setBusy("send");
    setError(null);
    try {
      const created = await api.emails.createDraft(emailId, { body });
      onChange(created.draft);
      onChange((await api.drafts.send(created.draft.id)).draft);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const generator = (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={intent}
        onChange={(e) => setIntent(e.target.value as ReplyIntent | "")}
        className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700"
      >
        <option value="">ให้ระบบเลือกแนวคำตอบ</option>
        {INTENTS.map((i) => (
          <option key={i} value={i}>
            {INTENT_LABEL[i]}
          </option>
        ))}
      </select>
      <Button size="sm" variant="outline" onClick={generate} disabled={busy !== null} className="rounded-lg text-xs">
        {busy === "generate" ? <Spinner className="mr-1.5 h-3 w-3" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5 text-purple-600" />}
        {active ? "ให้ AI ร่างใหม่" : "ให้ AI ร่างคำตอบ"}
      </Button>
    </div>
  );

  if (draft?.status === "SENT" || draft?.status === "SENDING") {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
        <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {draft.status === "SENT" ? `ตอบกลับแล้ว ${formatDateTime(draft.sentAt)}` : "กำลังส่ง..."}
        </p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{draft.body}</p>
      </div>
    );
  }

  if (!active && !writing) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
        <p className="mb-3 text-xs text-slate-500">
          {draft?.status === "DISCARDED" ? "ทิ้งร่างก่อนหน้าแล้ว" : needsReply ? "อีเมลนี้น่าจะต้องตอบกลับ แต่ยังไม่มีร่าง" : "ยังไม่มีร่างตอบกลับ"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {generator}
          <Button size="sm" variant="ghost" onClick={() => setWriting(true)} className="rounded-lg text-xs">
            <PenLine className="mr-1.5 h-3.5 w-3.5" /> เขียนเอง
          </Button>
        </div>
        {error && (
          <Notice tone="error" className="mt-3">
            {error}
          </Notice>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/30 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          ถึง <span className="font-semibold text-slate-700">{recipient || "ผู้ส่งเดิม"}</span>
          {active && (
            <span className="ml-2 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold text-blue-700 ring-1 ring-blue-200">
              {draft.source === "AI" ? `AI ร่าง: ${INTENT_LABEL[draft.intent]}` : "เขียนเอง"}
            </span>
          )}
        </p>
        {active && generator}
      </div>

      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={9}
        placeholder="พิมพ์ข้อความตอบกลับ..."
        className="resize-y rounded-xl bg-white text-sm leading-relaxed"
      />

      {draft?.status === "FAILED" && draft.errorMessage && !error && (
        <Notice tone="error" className="mt-2">
          ส่งครั้งก่อนไม่สำเร็จ: {draft.errorMessage}
        </Notice>
      )}
      {error && (
        <Notice tone="error" className="mt-2">
          {error}
        </Notice>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={send} disabled={busy !== null || !body.trim()} className="rounded-lg bg-blue-600 text-xs font-bold hover:bg-blue-700">
          {busy === "send" ? <Spinner className="mr-1.5 h-3 w-3" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
          ส่งอีเมลตอบกลับ
        </Button>
        {active ? (
          <Button size="sm" variant="ghost" onClick={() => run("discard", () => api.drafts.discard(draft.id))} disabled={busy !== null} className="rounded-lg text-xs text-slate-500">
            <Trash2 className="mr-1.5 h-3 w-3" /> ทิ้งร่าง
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setWriting(false)} className="rounded-lg text-xs">
            ยกเลิก
          </Button>
        )}
        <span className="ml-auto text-[11px] text-slate-400">ตรวจข้อความก่อนส่งทุกครั้ง</span>
      </div>
    </div>
  );
}
