"use client";

import { Suspense } from "react";
import { Inbox } from "lucide-react";
import AppShell from "@/components/layout/AppShell";
import InboxView from "@/components/inbox/InboxView";

export default function InboxPage() {
  return (
    <AppShell title="กล่องข้อความ" description="อีเมลแยกตามประเภท พร้อมร่างตอบกลับและรายการที่ลงปฏิทินได้" icon={Inbox} bare>
      <Suspense>
        <InboxView />
      </Suspense>
    </AppShell>
  );
}
