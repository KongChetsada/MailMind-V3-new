"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, RefreshCw, Sparkles, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice, Spinner, EmptyState } from "@/components/common/Feedback";
import ActionItemCard from "./ActionItemCard";
import ReplyPanel from "./ReplyPanel";
import MessageBody from "./MessageBody";
import { api, errorMessage } from "@/lib/api";
import { CATEGORY_META, CATEGORY_ORDER, PRIORITY_LABEL } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import type { ActionItem, EmailCategory, EmailDetail as Detail, ReplyDraft } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  emailId: string;
  onBack: () => void;
  /** แจ้งรายการด้านซ้ายให้โหลดใหม่เมื่อสถานะของอีเมลเปลี่ยน */
  onChanged: () => void;
}

/** แผงรายละเอียดอีเมล: ผลวิเคราะห์ → รายการลงปฏิทิน → ร่างตอบกลับ → เนื้อหาต้นฉบับ */
export default function EmailDetail({ emailId, onBack, onChanged }: Props) {
  const [email, setEmail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await api.emails.get(emailId);
      setEmail(data);
      if (!data.isRead) {
        api.emails
          .update(emailId, { isRead: true })
          .then(onChanged)
          .catch(() => {});
      }
    } catch (e) {
      setLoadError(errorMessage(e, "โหลดอีเมลไม่สำเร็จ"));
    }
  }, [emailId, onChanged]);

  useEffect(() => {
    setEmail(null);
    setActionError(null);
    setExpanded({});
    load();
  }, [load]);

  const analyze = async () => {
    setAnalyzing(true);
    setActionError(null);
    try {
      setEmail(await api.emails.analyze(emailId));
    } catch (e) {
      setActionError(errorMessage(e));
      load();
    } finally {
      setAnalyzing(false);
      onChanged();
    }
  };

  const changeCategory = async (category: EmailCategory) => {
    setActionError(null);
    try {
      setEmail(await api.emails.update(emailId, { userCategory: category }));
      onChanged();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  const onActionChange = (updated: ActionItem) => {
    setEmail((prev) => prev && { ...prev, actionItems: prev.actionItems.map((a) => (a.id === updated.id ? updated : a)) });
    onChanged();
  };
  const onDraftChange = (draft: ReplyDraft) => {
    setEmail((prev) => prev && { ...prev, draft });
    onChanged();
  };

  if (loadError) {
    return (
      <div className="p-6">
        <Notice tone="error">{loadError}</Notice>
      </div>
    );
  }
  if (!email) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6 text-blue-600" />
      </div>
    );
  }

  const analysed = email.analysisStatus === "DONE";
  const waiting = email.analysisStatus === "PENDING" || email.analysisStatus === "PROCESSING";
  const corrected = email.category !== email.aiCategory && email.aiCategory !== null;
  const visibleItems = email.actionItems;

  return (
    <div className="flex h-full flex-col">
      {/* หัวอีเมล */}
      <div className="border-b border-slate-100 px-5 py-4">
        <button onClick={onBack} className="mb-2 flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 lg:hidden">
          <ArrowLeft className="h-3.5 w-3.5" /> กลับไปรายการ
        </button>
        <h2 className="text-lg font-black leading-snug tracking-tight text-slate-900">{email.subject || "(ไม่มีหัวข้อ)"}</h2>
        <p className="mt-1 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{email.fromName || email.fromAddress}</span>
          {email.fromName && email.fromAddress && <span> &lt;{email.fromAddress}&gt;</span>}
          <span className="mx-1.5 text-slate-300">•</span>
          {formatDateTime(email.receivedAt)}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            ประเภท
            <select
              value={email.category || ""}
              onChange={(e) => changeCategory(e.target.value as EmailCategory)}
              className={cn("h-7 rounded-lg border px-2 text-xs font-bold", email.category ? CATEGORY_META[email.category].badge : "border-slate-200 text-slate-500")}
            >
              {!email.category && <option value="">ยังไม่จัดประเภท</option>}
              {CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_META[c].label}
                </option>
              ))}
            </select>
          </label>
          {corrected && email.aiCategory && <span className="text-[11px] text-slate-400">(AI จัดเป็น: {CATEGORY_META[email.aiCategory].short})</span>}
          {analysed && (
            <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold", email.priority === "HIGH" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-500")}>
              {PRIORITY_LABEL[email.priority]}
            </span>
          )}
          <Button size="sm" variant="ghost" onClick={analyze} disabled={analyzing} className="ml-auto h-7 rounded-lg text-xs text-slate-500">
            {analyzing ? <Spinner className="mr-1.5 h-3 w-3" /> : <RefreshCw className="mr-1.5 h-3 w-3" />}
            {analysed ? "วิเคราะห์ใหม่" : "วิเคราะห์ตอนนี้"}
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {actionError && <Notice tone="error">{actionError}</Notice>}

        {/* ผลวิเคราะห์ */}
        {analyzing ? (
          <Notice>AI กำลังวิเคราะห์อีเมลนี้ โมเดลในเครื่องอาจใช้เวลาหลายสิบวินาที...</Notice>
        ) : email.analysisStatus === "FAILED" ? (
          <Notice tone="error">
            <p className="font-bold">วิเคราะห์อีเมลนี้ไม่สำเร็จ</p>
            <p>{email.analysisError}</p>
            <p className="mt-1 text-rose-700/80">ยังอ่าน ตอบกลับ และจัดประเภทเองได้ตามปกติ</p>
          </Notice>
        ) : waiting ? (
          <Notice>อีเมลนี้ยังรอวิเคราะห์ กด “วิเคราะห์ตอนนี้” เพื่อเริ่มทันที</Notice>
        ) : email.analysisStatus === "SKIPPED" ? (
          <Notice>ระบบข้ามการวิเคราะห์อีเมลนี้ เพราะผู้ให้บริการอีเมลจัดเป็นโปรโมชันหรือโซเชียล</Notice>
        ) : (
          email.summary && (
            <div className="rounded-2xl border border-purple-100 bg-purple-50/50 p-4">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-purple-700">
                <Sparkles className="h-3.5 w-3.5" /> สรุปโดย AI
              </p>
              <p className="text-sm leading-relaxed text-slate-700">{email.summary}</p>
              <p className="mt-2 text-[10px] text-slate-400">
                {email.aiProvider} · {email.aiModel} · ผลจาก AI อาจคลาดเคลื่อน โปรดตรวจกับเนื้อหาอีเมล
              </p>
            </div>
          )
        )}

        {/* รายการลงปฏิทิน */}
        {visibleItems.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">รายการที่ลงปฏิทินได้ ({visibleItems.length})</h3>
            <div className="space-y-3">
              {visibleItems.map((item) => (
                <ActionItemCard
                  key={`${item.id}-${item.status}-${item.startAt}-${item.endAt}`}
                  item={item}
                  canInviteSender={email.category === "APPOINTMENT"}
                  onChange={onActionChange}
                />
              ))}
            </div>
          </section>
        )}

        {/* ร่างตอบกลับ */}
        <section>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">ตอบกลับ</h3>
          <ReplyPanel emailId={email.id} recipient={email.fromAddress} draft={email.draft} needsReply={email.needsReply} onChange={onDraftChange} />
        </section>

        {/* เนื้อหาต้นฉบับ */}
        <section>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
            เนื้อหาอีเมล{email.messages.length > 1 ? ` (${email.messages.length} ข้อความในเธรด)` : ""}
          </h3>
          {email.threadError ? (
            <Notice tone="warn">
              {email.threadError}
              {email.snippet && <p className="mt-1 text-slate-600">ข้อความย่อ: {email.snippet}</p>}
            </Notice>
          ) : email.messages.length === 0 ? (
            <EmptyState title="ไม่พบเนื้อหาอีเมล" hint="อีเมลอาจถูกลบจากกล่องข้อความแล้ว" />
          ) : (
            <div className="space-y-2">
              {email.messages.map((m) => {
                const open = expanded[m.id] ?? m.isCurrent;
                return (
                  <div key={m.id} className={cn("rounded-2xl border", m.isCurrent ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50/60")}>
                    <button onClick={() => setExpanded({ ...expanded, [m.id]: !open })} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
                      {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                      <span className="truncate text-xs font-semibold text-slate-700">{m.from}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-slate-400">{formatDateTime(m.receivedAt)}</span>
                    </button>
                    {open && (
                      <div className="border-t border-slate-100 px-4 py-3">
                        <MessageBody html={m.html} text={m.text} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
