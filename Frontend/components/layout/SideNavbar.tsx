"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, Calendar, BarChart3, Settings, User, type LucideIcon } from "lucide-react";

// เพิ่มหน้าใหม่ในเมนู: เพิ่มรายการที่นี่
const ITEMS: { label: string; path: string; icon: LucideIcon }[] = [
  { label: "กล่องข้อความ", path: "/inbox", icon: Inbox },
  { label: "สรุปและสถิติ", path: "/summary", icon: BarChart3 },
  { label: "ปฏิทิน", path: "/calendar", icon: Calendar },
  { label: "ตั้งค่า", path: "/settings", icon: Settings },
  { label: "โปรไฟล์", path: "/profile", icon: User },
];

export function SideNavbar() {
  const pathname = usePathname();

  return (
    <>
      {/* มือถือ: แถบเมนูแนวนอน */}
      <nav className="sticky top-16 z-30 mb-4 flex gap-1 overflow-x-auto border-b border-slate-200/80 bg-white/90 px-2 py-2 backdrop-blur-md md:hidden">
        {ITEMS.map(({ label, path, icon: Icon }) => (
          <Link
            key={path}
            href={path}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
              pathname === path ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Link>
        ))}
      </nav>

      {/* จอใหญ่: แถบด้านซ้าย */}
      <aside className="hidden w-52 shrink-0 md:block">
        <nav className="sticky top-20 space-y-1 rounded-2xl border border-slate-200/80 bg-white/90 p-2.5 shadow-sm">
          {ITEMS.map(({ label, path, icon: Icon }) => {
            const active = pathname === path;
            return (
              <Link
                key={path}
                href={path}
                className={`relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all ${
                  active ? "bg-blue-50/80 font-semibold text-blue-600" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {active && <span className="absolute bottom-2 left-0 top-2 w-1 rounded-r-full bg-blue-600" />}
                <Icon className={`h-4 w-4 ${active ? "text-blue-600" : "text-slate-400"}`} />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
