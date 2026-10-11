"use client";

import { useEffect } from "react";
import { tokenStore } from "@/lib/api";

/** รับ token จากส่วน # ของ URL หลังเข้าสู่ระบบด้วย Google แล้วพาไปกล่องข้อความ */
export default function LoginSuccess() {
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (token) {
      tokenStore.set(token);
      window.location.replace("/inbox");
    } else {
      window.location.replace("/login?error=invalid_request");
    }
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="animate-pulse text-sm font-medium text-slate-500">กำลังเข้าสู่ระบบ...</p>
    </div>
  );
}
