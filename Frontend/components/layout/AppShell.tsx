"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/provider/AuthProvider";
import { SideNavbar } from "./SideNavbar";

interface Props {
  title: string;
  description?: string;
  icon: LucideIcon;
  actions?: ReactNode;
  /** true = เนื้อหาใช้พื้นที่เต็มโดยไม่มีกรอบการ์ด (หน้าที่จัดเลย์เอาต์เอง) */
  bare?: boolean;
  children: ReactNode;
}

/** โครงของทุกหน้าหลังเข้าสู่ระบบ: ตรวจสิทธิ์ + เมนูด้านข้าง + หัวหน้า */
export default function AppShell({ title, description, icon: Icon, actions, bare, children }: Props) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <div className="h-9 w-9 animate-spin rounded-full border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-screen-2xl px-0 py-0 sm:px-6 md:py-6">
      <div className="items-start md:flex md:gap-5">
        <SideNavbar />
        <main className="min-w-0 flex-1 px-3 pb-10 sm:px-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-black tracking-tight text-slate-900">{title}</h1>
                {description && <p className="text-xs text-slate-500">{description}</p>}
              </div>
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
          {bare ? children : <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs sm:p-6">{children}</section>}
        </main>
      </div>
    </div>
  );
}
