"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Sparkles, LogOut, Cpu, Cloud } from "lucide-react";
import { useAuth } from "@/provider/AuthProvider";
import { api } from "@/lib/api";
import type { SettingsResponse } from "@/lib/types";

const HIDDEN_ON = ["/login", "/login-success", "/privacy", "/terms"];

/** แถบบน: โลโก้ สถานะ AI ที่ใช้อยู่ และผู้ใช้ */
export default function Navbar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [settings, setSettings] = useState<SettingsResponse | null>(null);

  useEffect(() => {
    if (!user) return;
    api.settings
      .get()
      .then(setSettings)
      .catch(() => setSettings(null));
  }, [user, pathname]);

  if (HIDDEN_ON.some((p) => pathname.startsWith(p))) return null;

  const provider = settings?.providers.find((p) => p.id === settings.setting.aiProvider);
  const autoOn = settings?.setting.isAutoAnalyzeActive;

  return (
    <header className="sticky top-0 z-50 glass-nav shadow-xs">
      <div className="mx-auto max-w-screen-2xl px-4 sm:px-6">
        <div className="flex h-16 items-center justify-between">
          <Link href={user ? "/inbox" : "/"} className="group flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-bg text-white shadow-md shadow-blue-500/20 transition-transform group-hover:scale-105">
              <Sparkles className="h-5 w-5" />
            </div>
            <span className="text-xl font-extrabold tracking-tight text-slate-900">
              Mail<span className="gradient-text">Mind</span>
            </span>
          </Link>

          {user ? (
            <div className="flex items-center gap-3 sm:gap-4">
              {provider && (
                <Link
                  href="/settings"
                  title={provider.isLocal ? "ประมวลผลในเครื่อง เนื้อหาอีเมลไม่ถูกส่งออก" : "เนื้อหาอีเมลถูกส่งไปยังผู้ให้บริการ AI ภายนอก"}
                  className="hidden items-center gap-2 rounded-full border border-slate-200/80 bg-slate-100/80 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 sm:flex"
                >
                  {provider.isLocal ? <Cpu className="h-3.5 w-3.5 text-emerald-600" /> : <Cloud className="h-3.5 w-3.5 text-blue-600" />}
                  <span>{provider.label}</span>
                  <span className={`h-2 w-2 rounded-full ${autoOn ? "bg-emerald-500" : "bg-amber-400"}`} />
                  <span className={autoOn ? "text-emerald-700" : "text-slate-500"}>{autoOn ? "วิเคราะห์อัตโนมัติ" : "หยุดวิเคราะห์"}</span>
                </Link>
              )}

              <div className="flex items-center gap-3 border-l border-slate-200 pl-3">
                <Link href="/profile" className="flex items-center gap-3">
                  {user.picture ? (
                    <Image src={user.picture} alt="" width={36} height={36} className="rounded-full object-cover ring-2 ring-blue-500/20" />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700 ring-2 ring-blue-500/20">
                      {(user.name || user.email).charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="hidden text-left leading-tight md:block">
                    <p className="max-w-[150px] truncate text-xs font-bold text-slate-800">{user.name}</p>
                    <p className="max-w-[150px] truncate text-[11px] text-slate-500">{user.email}</p>
                  </div>
                </Link>
                <button onClick={logout} title="ออกจากระบบ" className="rounded-xl p-2 text-slate-500 transition-all hover:bg-rose-50 hover:text-rose-600">
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : (
            <Link href="/login" className="rounded-xl gradient-bg px-5 py-2 text-sm font-semibold text-white shadow-md shadow-blue-500/20 hover:opacity-95">
              เข้าสู่ระบบ
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
