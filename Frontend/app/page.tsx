"use client";

import Link from "next/link";
import { ArrowRight, Bot, CalendarCheck, Zap, Sparkles, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/provider/AuthProvider";

export default function Home() {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-slate-50/50 flex flex-col selection:bg-blue-500 selection:text-white">
      <main className="grow">
        
        {/* Hero Section */}
        <section className="relative py-20 lg:py-32 overflow-hidden">
          {/* Subtle Background Glows */}
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-linear-to-tr from-blue-400/20 via-indigo-400/20 to-purple-400/10 rounded-full blur-3xl pointer-events-none" />
          
          <div className="container mx-auto px-6 relative z-10 text-center max-w-5xl">
            
            {/* Top Pill Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 border border-blue-200/80 text-blue-700 text-xs font-semibold mb-8 shadow-xs animate-bounce-short">
              <Sparkles className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
              <span>เลือกใช้ AI ในเครื่อง (Ollama) หรือ Cloud API ได้</span>
            </div>

            {/* Main Headline */}
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black text-slate-900 tracking-tight mb-8 leading-[1.1]">
              จัดการอีเมลและตารางงาน <br className="hidden sm:block" />
              <span className="gradient-text">ด้วยผู้ช่วย AI อัจฉริยะ</span>
            </h1>

            {/* Subtitle */}
            <p className="text-lg sm:text-xl text-slate-600 mb-12 max-w-3xl mx-auto leading-relaxed font-normal">
              MailMind แยกประเภทอีเมล สรุปใจความ ร่างข้อความตอบกลับตามโทนของคุณ และเสนอรายการที่ลงปฏิทินได้ คุณเป็นผู้ตรวจและกดยืนยันเองทุกครั้งก่อนส่งหรือบันทึก
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-md mx-auto mb-16">
              <Link 
                href={user ? "/inbox" : "/login"} 
                className="w-full sm:w-auto px-8 py-4 gradient-bg hover:opacity-95 text-white font-bold rounded-2xl shadow-xl shadow-blue-500/25 transition-all flex items-center justify-center gap-2.5 group cursor-pointer"
              >
                {user ? "ไปที่กล่องข้อความ" : "เริ่มต้นใช้งานฟรี"} 
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link 
                href="#features" 
                className="w-full sm:w-auto px-8 py-4 bg-white/80 hover:bg-white text-slate-700 hover:text-blue-600 font-bold rounded-2xl shadow-sm border border-slate-200/80 transition-all text-center"
              >
                เรียนรู้ฟีเจอร์
              </Link>
            </div>

            {/* Visual Feature Preview Box */}
            <div className="relative max-w-4xl mx-auto rounded-3xl border border-slate-200/80 bg-white/80 backdrop-blur-xl shadow-2xl p-4 sm:p-6 text-left">
              <div className="flex items-center gap-2 pb-4 border-b border-slate-100 mb-4">
                <div className="w-3 h-3 rounded-full bg-rose-400" />
                <div className="w-3 h-3 rounded-full bg-amber-400" />
                <div className="w-3 h-3 rounded-full bg-emerald-400" />
                <span className="ml-2 text-xs font-mono text-slate-400">MailMind Live AI Dashboard Preview</span>
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-100 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>📩 อีเมลขาเข้า</span>
                    <span className="text-blue-600 font-semibold">10:30 น.</span>
                  </div>
                  <p className="text-sm font-bold text-slate-800">นัดประชุมอัปเดตงานโครงการ MailMind V2</p>
                  <p className="text-xs text-slate-500 line-clamp-2">เรียนทีมงาน ขอเชิญประชุมเพื่อสรุปแบบ UX/UI ใหม่วันพรุ่งนี้ เวลา 14:00 น. ผ่าน Google Meet...</p>
                </div>

                <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100/80 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs text-blue-700 font-bold">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AI วิเคราะห์และร่างคำตอบ</span>
                  </div>
                  <p className="text-xs text-slate-700 font-medium leading-relaxed bg-white p-2.5 rounded-xl border border-blue-100">
                    &quot;ตารางว่าง: ร่างคำตอบรับการประชุมวันพรุ่งนี้เวลา 14:00 น. รอคุณตรวจก่อนส่ง&quot;
                  </p>
                </div>

                <div className="p-4 bg-emerald-50/50 rounded-2xl border border-emerald-100/80 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-bold">
                    <CalendarCheck className="w-3.5 h-3.5" />
                    <span>Google Calendar Sync</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border border-emerald-100 text-xs space-y-1">
                    <p className="font-bold text-slate-800">📅 ประชุม MailMind V2</p>
                    <p className="text-slate-500 text-[11px]">พรุ่งนี้ • 14:00 - 15:00 น.</p>
                    <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded-full">รอยืนยัน</span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="py-24 bg-white relative">
          <div className="container mx-auto px-6 max-w-7xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mb-4 tracking-tight">
                ทำไมต้องเลือก <span className="gradient-text">MailMind</span>?
              </h2>
              <p className="text-slate-500 text-base max-w-2xl mx-auto">
                ยกระดับประสิทธิภาพการทำงานของคุณด้วยฟีเจอร์ AI ที่คิดค้นมาเพื่อตอบโจทย์คนวัยทำงานยุคใหม่
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {/* Feature 1 */}
              <div className="bg-slate-50/80 p-8 rounded-3xl border border-slate-100 hover:border-blue-200 card-hover">
                <div className="w-14 h-14 gradient-bg text-white rounded-2xl flex items-center justify-center mb-6 shadow-md shadow-blue-500/20">
                  <Bot className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">เลือกโมเดล AI ได้</h3>
                <p className="text-slate-600 text-sm leading-relaxed">
                  ใช้ Ollama เพื่อให้เนื้อหาอีเมลอยู่ในเครื่อง หรือเลือก Cloud API เมื่อต้องการโมเดลที่ใหญ่กว่า
                </p>
              </div>

              {/* Feature 2 */}
              <div className="bg-slate-50/80 p-8 rounded-3xl border border-slate-100 hover:border-emerald-200 card-hover">
                <div className="w-14 h-14 bg-linear-to-br from-emerald-500 to-teal-600 text-white rounded-2xl flex items-center justify-center mb-6 shadow-md shadow-emerald-500/20">
                  <CalendarCheck className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">เสนอรายการลงปฏิทิน</h3>
                <p className="text-slate-600 text-sm leading-relaxed">
                  สกัดวัน เวลา และสถานที่จากอีเมล ตรวจตารางว่างด้วยกฎ แล้วให้คุณยืนยันก่อนบันทึกลง Google Calendar
                </p>
              </div>

              {/* Feature 3 */}
              <div className="bg-slate-50/80 p-8 rounded-3xl border border-slate-100 hover:border-purple-200 card-hover">
                <div className="w-14 h-14 bg-linear-to-br from-indigo-500 to-purple-600 text-white rounded-2xl flex items-center justify-center mb-6 shadow-md shadow-purple-500/20">
                  <Zap className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">ปรับแต่งโทนการตอบ</h3>
                <p className="text-slate-600 text-sm leading-relaxed">
                  เลือกระดับความเป็นทางการ (Formal / Casual) คำสรรพนาม และลายเซ็นส่วนตัวเพื่อผลลัพธ์ที่สมบูรณ์แบบ
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Call to Action Footer Section */}
        <section className="py-20 bg-slate-900 text-white relative overflow-hidden">
          <div className="absolute inset-0 bg-linear-to-r from-blue-600/20 to-purple-600/20 opacity-50" />
          <div className="container mx-auto px-6 text-center max-w-4xl relative z-10">
            <h2 className="text-3xl sm:text-5xl font-black mb-6 tracking-tight">
              พร้อมเปลี่ยนวิธีจัดการอีเมลของคุณหรือยัง?
            </h2>
            <p className="text-slate-300 mb-10 text-lg max-w-2xl mx-auto">
              เชื่อมต่อบัญชี Google แล้วให้ AI ช่วยคัดแยกและร่างคำตอบ โดยคุณเป็นผู้ตัดสินใจขั้นสุดท้าย
            </p>
            <Link 
              href="/login" 
              className="inline-flex items-center gap-2.5 px-9 py-4 gradient-bg hover:opacity-95 text-white font-bold rounded-2xl transition-all shadow-xl shadow-blue-500/30 text-lg cursor-pointer"
            >
              <CheckCircle2 className="w-5 h-5" />
              เชื่อมต่อ Gmail เข้าใช้งานทันที
            </Link>
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="bg-white py-10 border-t border-slate-200/80">
        <div className="container mx-auto px-6 flex flex-col items-center justify-center">
          <div className="flex flex-wrap justify-center gap-6 text-sm font-medium text-slate-600 mb-6">
            <Link href="/terms" className="hover:text-blue-600 transition-colors">
              Terms of Use
            </Link>
            <span className="text-slate-300">•</span>
            <Link href="/privacy" className="hover:text-blue-600 transition-colors">
              Privacy Policy
            </Link>
          </div>
          
          <div className="text-center text-slate-500 text-sm">
            <p>© {new Date().getFullYear()} MailMind. All rights reserved.</p>
            <p className="mt-1 text-xs text-slate-400">AI-Powered Email Management and Calendar Automation.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}