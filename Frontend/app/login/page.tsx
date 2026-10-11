"use client";

import { Suspense, useEffect, useState } from 'react';
import LoginExtras from '@/components/common/LoginExtras';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/provider/AuthProvider';
import { ShieldAlert, X, Sparkles } from 'lucide-react';

import Link from 'next/link';

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // State สำหรับควบคุมหน้าต่าง Terms of Use
  const [showTerms, setShowTerms] = useState(false);
  const [isAgreed, setIsAgreed] = useState(false);

  useEffect(() => {
    if (user && !loading) {
      router.replace('/inbox');
    }
  }, [user, loading, router]);

  // ฟังก์ชันแสดงหน้าต่างข้อตกลง
  const handleInitiateLogin = () => {
    setShowTerms(true);
  };

  // ฟังก์ชันส่งไปล็อกอินจริงๆ
  const handleProceedLogin = () => {
    window.location.href = `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/auth/google`;
  };

  if (loading || user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-blue-50 to-indigo-100">
        <p className="text-gray-500 font-medium animate-pulse">กำลังตรวจสอบสถานะ...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-blue-50 via-slate-50 to-indigo-100 p-4 relative overflow-hidden">

      
      {/* Background Subtle Glows */}
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-400/20 rounded-full blur-3xl" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-indigo-400/20 rounded-full blur-3xl" />

      {/* =========================================
          หน้าต่าง Login หลัก
      ========================================= */}
      <div className="max-w-md w-full bg-white/90 backdrop-blur-xl rounded-3xl border border-slate-200/80 shadow-2xl p-8 sm:p-10 relative z-10">
        
        <div className="text-center mb-8">
          <div className="w-14 h-14 gradient-bg text-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/25">
            <Sparkles className="w-7 h-7" />
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900 mb-2">
            Mail<span className="gradient-text">Mind</span>
          </h1>
          <p className="text-sm text-slate-500">ผู้ช่วยแยกประเภทอีเมล ร่างตอบกลับ และบันทึกลงปฏิทิน</p>
        </div>

        <div className="space-y-5">
          <button
            onClick={handleInitiateLogin}
            type="button"
            className="w-full flex items-center justify-center gap-3 bg-white border border-slate-200/90 rounded-2xl px-6 py-3.5 text-slate-700 font-semibold text-sm hover:bg-slate-50 hover:border-slate-300 transition-all shadow-xs cursor-pointer group"
          >
            <svg className="w-5 h-5 group-hover:scale-110 transition-transform" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            เข้าสู่ระบบด้วยบัญชี Google
          </button>

          <Suspense>
            <LoginExtras />
          </Suspense>

          <div className="text-center text-xs text-slate-500 mt-6 pt-6 border-t border-slate-100 leading-relaxed">
            <p>โดยการเข้าสู่ระบบ คุณยินยอมให้แอปพลิเคชันเข้าถึงข้อมูล Gmail</p>
            <p className="mt-1">
              และยอมรับ{' '}
              <Link 
                href="/terms" 
                target="_blank" 
                className="text-blue-600 hover:text-blue-700 hover:underline font-semibold transition-colors"
              >
                ข้อตกลงการใช้งาน
              </Link>
              {' '}และ{' '}
              <Link 
                href="/privacy" 
                target="_blank" 
                className="text-blue-600 hover:text-blue-700 hover:underline font-semibold transition-colors"
              >
                นโยบายความเป็นส่วนตัว
              </Link>
            </p>
          </div>
        </div>
      </div>

      {/* =========================================
          Modal ข้อตกลงการใช้งาน (Terms of Use)
      ========================================= */}
      {showTerms && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2 text-slate-800">
                <ShieldAlert className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-bold">ข้อตกลงการใช้งานและนโยบายความเป็นส่วนตัว</h2>
              </div>
              <button 
                onClick={() => setShowTerms(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body (Scrollable Text) */}
            <div className="px-6 py-6 overflow-y-auto flex-1 text-sm text-slate-600 space-y-4">
              <p>ยินดีต้อนรับสู่ <strong>MailMind</strong> โปรดอ่านและทำความเข้าใจข้อตกลงต่อไปนี้ก่อนเข้าใช้งานระบบ:</p>
              
              <div className="space-y-3 pl-4 border-l-2 border-blue-100">
                <div>
                  <h3 className="font-semibold text-slate-800">1. การเข้าถึงข้อมูล (Data Access)</h3>
                  <p className="mt-1">แอปพลิเคชันต้องการสิทธิ์การเข้าถึงแบบอ่านและเขียน (Read & Write) สำหรับ <strong>Gmail</strong> และ <strong>Google Calendar</strong> ของคุณ เพื่อใช้ในการแสดงผลเนื้อหาอีเมลและสร้างกิจกรรมลงปฏิทิน</p>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800">2. การประมวลผลด้วย AI (AI Processing)</h3>
                  <p className="mt-1">ผู้ใช้เลือกได้ว่าจะให้โมเดลใดประมวลผลเนื้อหาอีเมล: หากเลือก Ollama เนื้อหาจะถูกประมวลผลบนเครื่องที่ติดตั้งระบบและไม่ถูกส่งให้ผู้ให้บริการ AI ภายนอก หากเลือกผู้ให้บริการ AI ภายนอก (เช่น OpenAI, Google Gemini, OpenRouter) เนื้อหาอีเมลที่วิเคราะห์และร่างตอบจะถูกส่งไปยังผู้ให้บริการรายนั้นตามนโยบายของผู้ให้บริการ ระบบจะไม่สลับผู้ให้บริการเองโดยที่ผู้ใช้ไม่ได้เลือก</p>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800">3. ความปลอดภัยของโทเค็น (Token Security)</h3>
                  <p className="mt-1">OAuth Token สำหรับการเชื่อมต่อ Google API จะถูกเข้ารหัสความปลอดภัยระดับสูง (AES-256-GCM) ก่อนบันทึกลงฐานข้อมูล และจะไม่ถูกเปิดเผยต่อบุคคลภายนอก</p>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800">4. การเพิกถอนสิทธิ์ (Revoking Access)</h3>
                  <p className="mt-1">คุณสามารถยกเลิกการเชื่อมต่อและเพิกถอนสิทธิ์การเข้าถึงบัญชี Google ของคุณได้ตลอดเวลาผ่านหน้าการตั้งค่าความปลอดภัยของ Google Account</p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-5 border-t border-slate-100 bg-slate-50 space-y-4">
              <label className="flex items-start gap-3 cursor-pointer group">
                <div className="mt-0.5 relative flex items-center justify-center">
                  <input 
                    type="checkbox" 
                    className="peer sr-only"
                    checked={isAgreed}
                    onChange={(e) => setIsAgreed(e.target.checked)}
                  />
                  <div className="w-5 h-5 border-2 border-slate-300 rounded bg-white peer-checked:bg-blue-600 peer-checked:border-blue-600 transition-colors flex items-center justify-center">
                    {isAgreed && (
                      <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </div>
                <span className="text-sm text-slate-700 select-none group-hover:text-slate-900">
                  ฉันได้อ่านและยอมรับ{' '}
                  <Link 
                    href="/terms" 
                    target="_blank"
                    onClick={(e) => e.stopPropagation()} // ป้องกันการกดลิงก์แล้วไปกระทบ checkbox
                    className="font-semibold text-blue-600 hover:text-blue-700 hover:underline transition-colors"
                  >
                    ข้อตกลงการใช้งาน
                  </Link> 
                  {' '}และ{' '}
                  <Link 
                    href="/privacy" 
                    target="_blank"
                    onClick={(e) => e.stopPropagation()} // ป้องกันการกดลิงก์แล้วไปกระทบ checkbox
                    className="font-semibold text-blue-600 hover:text-blue-700 hover:underline transition-colors"
                  >
                    นโยบายความเป็นส่วนตัว
                  </Link> 
                  {' '}ของ MailMind แล้ว
                </span>
              </label>

              <div className="flex gap-3 justify-end pt-2">
                <button 
                  onClick={() => setShowTerms(false)}
                  className="px-5 py-2.5 text-sm font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors"
                >
                  ยกเลิก
                </button>
                <button 
                  onClick={handleProceedLogin}
                  disabled={!isAgreed}
                  className={`px-6 py-2.5 text-sm font-semibold text-white rounded-xl transition-all shadow-sm flex items-center gap-2 ${
                    isAgreed 
                      ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-200' 
                      : 'bg-slate-300 cursor-not-allowed opacity-70'
                  }`}
                >
                  ยินยอมและเข้าสู่ระบบ
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}