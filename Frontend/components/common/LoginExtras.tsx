"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { Notice } from "./Feedback";
import { API_BASE } from "@/lib/api";

const ERROR_TEXT: Record<string, string> = {
  reauth: "การเชื่อมต่อกับบัญชีอีเมลหมดอายุหรือถูกเพิกถอน กรุณาเข้าสู่ระบบใหม่",
  expired: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่",
  auth_failed: "เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองใหม่",
  invalid_request: "คำขอเข้าสู่ระบบไม่ถูกต้อง กรุณาลองใหม่",
};

/** ส่วนเสริมของหน้าเข้าสู่ระบบ: ข้อความแจ้งสาเหตุที่ถูกพากลับมา และปุ่มโหมดสาธิต (แสดงเมื่อ Backend เปิด DEMO_MODE) */
export default function LoginExtras() {
  const error = useSearchParams().get("error");
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((r) => r.json())
      .then((d) => setDemo(Boolean(d.demoMode)))
      .catch(() => setDemo(false));
  }, []);

  return (
    <>
      {error && <Notice tone="warn">{ERROR_TEXT[error] || "กรุณาเข้าสู่ระบบใหม่"}</Notice>}
      {demo && (
        <a
          href={`${API_BASE}/api/auth/demo`}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-amber-300 bg-amber-50 px-6 py-3 text-sm font-semibold text-amber-800 hover:bg-amber-100"
        >
          <FlaskConical className="h-4 w-4" />
          ทดลองด้วยอีเมลตัวอย่าง (โหมดสาธิต)
        </a>
      )}
    </>
  );
}
