"use client";

import { Calendar } from "lucide-react";
import AppShell from "@/components/layout/AppShell";
import CalendarView from "@/components/calendar/CalendarView";

export default function CalendarPage() {
  return (
    <AppShell title="ปฏิทิน" description="กิจกรรมในปฏิทิน และรายการจากอีเมลที่รอยืนยัน" icon={Calendar} bare>
      <CalendarView />
    </AppShell>
  );
}
