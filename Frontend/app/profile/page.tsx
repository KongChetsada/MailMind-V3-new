"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { User, Mail, LogOut, Repeat, CheckCircle2, AlertTriangle } from "lucide-react";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/common/Feedback";
import { useAuth } from "@/provider/AuthProvider";
import { api, API_BASE, tokenStore } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { MailAccount } from "@/lib/types";

const PROVIDER_LABEL = { GOOGLE: "Gmail / Google Workspace", MICROSOFT: "Outlook / Microsoft 365" };

function ProfileContent() {
  const { user, logout } = useAuth();
  const [accounts, setAccounts] = useState<MailAccount[]>([]);

  useEffect(() => {
    api
      .accounts()
      .then((data) => setAccounts(data.items))
      .catch(() => setAccounts([]));
  }, []);

  if (!user) return null;

  // เปลี่ยนบัญชี / เชื่อมใหม่ = ออกจากระบบแล้วไปหน้าเลือกบัญชีของ Google
  const reconnect = () => {
    tokenStore.clear();
    window.location.href = `${API_BASE}/api/auth/google`;
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <section className="flex flex-col items-center gap-5 rounded-2xl border border-slate-200/80 bg-white p-6 text-center shadow-xs sm:flex-row sm:text-left">
        {user.picture ? (
          <Image src={user.picture} alt="" width={88} height={88} className="shrink-0 rounded-full object-cover ring-4 ring-blue-500/20" />
        ) : (
          <div className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-full gradient-bg text-3xl font-black text-white">
            {(user.name || user.email).charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1">
          <h2 className="text-xl font-black tracking-tight text-slate-900">{user.name || "ไม่ระบุชื่อ"}</h2>
          <p className="text-sm text-slate-500">{user.email}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
            <Button size="sm" variant="outline" onClick={reconnect} className="rounded-xl text-xs">
              <Repeat className="mr-1.5 h-3.5 w-3.5" /> เปลี่ยนบัญชี
            </Button>
            <Button size="sm" variant="outline" onClick={logout} className="rounded-xl border-rose-200 text-xs text-rose-700 hover:bg-rose-50">
              <LogOut className="mr-1.5 h-3.5 w-3.5" /> ออกจากระบบ
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">บัญชีอีเมลที่เชื่อม</h3>
        <div className="space-y-3">
          {accounts.map((a) => (
            <div key={a.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-800">{a.emailAddress}</p>
                    <p className="text-[11px] text-slate-500">
                      {PROVIDER_LABEL[a.provider]} · อ่าน ส่งอีเมล และปฏิทิน
                    </p>
                  </div>
                </div>
                {a.status === "ACTIVE" ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-emerald-600">
                    <CheckCircle2 className="h-4 w-4" /> เชื่อมต่ออยู่
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-rose-600">
                    <AlertTriangle className="h-4 w-4" /> ต้องเชื่อมใหม่
                  </span>
                )}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">ซิงก์ล่าสุด: {a.lastSyncAt ? formatDateTime(a.lastSyncAt) : "ยังไม่เคยซิงก์"}</p>
              {a.lastSyncError && (
                <Notice tone="error" className="mt-2">
                  ซิงก์ครั้งล่าสุดไม่สำเร็จ: {a.lastSyncError}
                </Notice>
              )}
              {a.status === "NEEDS_REAUTH" && (
                <Button size="sm" onClick={reconnect} className="mt-3 rounded-xl bg-blue-600 text-xs font-bold hover:bg-blue-700">
                  เชื่อมบัญชีนี้ใหม่
                </Button>
              )}
            </div>
          ))}
          {accounts.length === 0 && <p className="text-xs text-slate-400">ยังไม่มีบัญชีอีเมลที่เชื่อม</p>}
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-slate-400">ขณะนี้รองรับ Gmail และโดเมนองค์กรที่ใช้ Google Workspace การเชื่อม Outlook / Microsoft 365 อยู่ในแผนรอบถัดไป</p>
      </section>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <AppShell title="โปรไฟล์" description="บัญชีผู้ใช้และบัญชีอีเมลที่เชื่อม" icon={User} bare>
      <ProfileContent />
    </AppShell>
  );
}
