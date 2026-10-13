"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, Search, MailOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice, Spinner, EmptyState } from "@/components/common/Feedback";
import EmailListItem from "./EmailListItem";
import EmailDetail from "./EmailDetail";
import { api, errorMessage } from "@/lib/api";
import { CATEGORY_META, CATEGORY_ORDER, FILTER_LABEL } from "@/lib/labels";
import type { EmailCategory, EmailCounts, EmailFilter, EmailListItem as Email } from "@/lib/types";
import { cn } from "@/lib/utils";

const FILTERS = Object.keys(FILTER_LABEL) as EmailFilter[];
const POLL_MS = 15000;

/** หน้า Inbox: แถบประเภท + รายการอีเมล + แผงรายละเอียด */
export default function InboxView() {
  const router = useRouter();
  const selectedId = useSearchParams().get("email");

  const [category, setCategory] = useState<EmailCategory | null>(null);
  const [filter, setFilter] = useState<EmailFilter | "">("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  const [emails, setEmails] = useState<Email[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [counts, setCounts] = useState<EmailCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const requestId = useRef(0);

  const select = useCallback(
    (id: string | null) => router.replace(id ? `/inbox?email=${id}` : "/inbox", { scroll: false }),
    [router]
  );

  /** โหลดหน้าแรกของรายการตามตัวกรองปัจจุบัน (silent = ไม่แสดงตัวหมุน ใช้ตอนรีเฟรชเบื้องหลัง) */
  const reload = useCallback(
    async (silent = false) => {
      const id = ++requestId.current;
      if (!silent) setLoading(true);
      try {
        const [list, c] = await Promise.all([
          api.emails.list({ category: category || undefined, filter: filter || undefined, q: query || undefined }),
          api.emails.counts(),
        ]);
        if (id !== requestId.current) return; // มีคำขอใหม่กว่าแล้ว
        setEmails(list.items);
        setNextCursor(list.nextCursor);
        setCounts(c);
      } catch (e) {
        if (!silent) setMessage({ tone: "error", text: errorMessage(e, "โหลดรายการอีเมลไม่สำเร็จ") });
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [category, filter, query]
  );

  useEffect(() => {
    reload();
  }, [reload]);

  // ระหว่างที่ยังมีอีเมลรอวิเคราะห์ ให้รีเฟรชเป็นระยะเพื่อให้เห็นผลทันทีที่เสร็จ
  useEffect(() => {
    if (!counts || counts.pending === 0) return;
    const timer = setInterval(() => reload(true), POLL_MS);
    return () => clearInterval(timer);
  }, [counts, reload]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const list = await api.emails.list({ category: category || undefined, filter: filter || undefined, q: query || undefined, cursor: nextCursor });
      setEmails((prev) => [...prev, ...list.items]);
      setNextCursor(list.nextCursor);
    } catch (e) {
      setMessage({ tone: "error", text: errorMessage(e) });
    } finally {
      setLoadingMore(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const { created, removed, restored } = await api.emails.sync();
      const parts = [
        created + restored > 0 ? `พบอีเมลใหม่ ${created + restored} ฉบับ กำลังวิเคราะห์เบื้องหลัง` : "ไม่มีอีเมลใหม่",
        ...(removed > 0 ? [`นำออก ${removed} ฉบับที่ถูกลบในกล่องจดหมาย`] : []),
      ];
      setMessage({ tone: created + restored + removed > 0 ? "success" : "info", text: parts.join(" · ") });
      // อีเมลที่เปิดค้างอยู่อาจเพิ่งถูกนำออก: ปิดแผงรายละเอียดถ้าไม่อยู่ในรายการแล้ว
      if (removed > 0 && selectedId) select(null);
      await reload(true);
    } catch (e) {
      setMessage({ tone: "error", text: errorMessage(e, "ซิงก์อีเมลไม่สำเร็จ") });
    } finally {
      setSyncing(false);
    }
  };

  const onDetailChanged = useCallback(() => reload(true), [reload]);

  const chip = (active: boolean) =>
    cn(
      "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
      active ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
    );

  return (
    <div className="space-y-3">
      {/* แถบเครื่องมือ */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาผู้ส่ง หัวข้อ" className="h-9 rounded-xl bg-white pl-9 text-sm" />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as EmailFilter | "")}
          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600"
        >
          <option value="">ทุกสถานะ</option>
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {FILTER_LABEL[f]}
              {counts && f === "has_action" ? ` (${counts.hasAction})` : ""}
              {counts && f === "has_draft" ? ` (${counts.hasDraft})` : ""}
              {counts && f === "failed" ? ` (${counts.failed})` : ""}
              {counts && f === "unread" ? ` (${counts.unread})` : ""}
            </option>
          ))}
        </select>
        <Button onClick={sync} disabled={syncing} size="sm" className="h-9 rounded-xl bg-blue-600 text-xs font-bold hover:bg-blue-700">
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", syncing && "animate-spin")} />
          {syncing ? "กำลังซิงก์" : "ซิงก์อีเมล"}
        </Button>
      </div>

      {/* แถบประเภท */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <button onClick={() => setCategory(null)} className={chip(category === null)}>
          ทั้งหมด {counts && <span className="opacity-70">{counts.total}</span>}
        </button>
        {CATEGORY_ORDER.map((c) => {
          const { short, icon: Icon } = CATEGORY_META[c];
          return (
            <button key={c} onClick={() => setCategory(c)} className={chip(category === c)}>
              <Icon className="h-3.5 w-3.5" />
              {short}
              {counts && <span className="opacity-70">{counts.categories[c]}</span>}
            </button>
          );
        })}
      </div>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {counts && counts.pending > 0 && <Notice>กำลังวิเคราะห์อีเมลอีก {counts.pending} ฉบับเบื้องหลัง รายการจะอัปเดตเอง</Notice>}

      {/* รายการ + รายละเอียด */}
      <div className="grid overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs lg:h-[calc(100vh-17rem)] lg:min-h-[480px] lg:grid-cols-[380px_1fr]">
        <div className={cn("flex min-h-0 flex-col border-slate-100 lg:border-r", selectedId && "hidden lg:flex")}>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-16">
                <Spinner className="h-6 w-6 text-blue-600" />
              </div>
            ) : emails.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title={counts?.total === 0 ? "ยังไม่มีอีเมลในระบบ" : "ไม่มีอีเมลตรงกับตัวกรองนี้"}
                  hint={counts?.total === 0 ? "กด “ซิงก์อีเมล” เพื่อดึงอีเมลจากกล่องข้อความของคุณ" : undefined}
                />
              </div>
            ) : (
              <>
                {emails.map((email) => (
                  <EmailListItem key={email.id} email={email} selected={email.id === selectedId} onSelect={() => select(email.id)} />
                ))}
                {nextCursor && (
                  <div className="p-3 text-center">
                    <Button variant="ghost" size="sm" onClick={loadMore} disabled={loadingMore} className="rounded-lg text-xs">
                      {loadingMore && <Spinner className="mr-1.5 h-3 w-3" />} โหลดเพิ่ม
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className={cn("min-h-0", !selectedId && "hidden lg:block")}>
          {selectedId ? (
            <EmailDetail key={selectedId} emailId={selectedId} onBack={() => select(null)} onChanged={onDetailChanged} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
              <MailOpen className="h-10 w-10" />
              <p className="text-sm font-medium">เลือกอีเมลเพื่อดูรายละเอียด</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
