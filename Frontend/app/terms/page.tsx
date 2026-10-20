"use client";

export default function TermsOfUsePage() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        

        {/* กล่องเนื้อหา */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 sm:p-12">
          
          <div className="flex items-center gap-4 mb-8 pb-8 border-b border-slate-100">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">ข้อตกลงการใช้งานและนโยบายความเป็นส่วนตัว</h1>
              <p className="text-slate-500 mt-1">อัปเดตล่าสุด: {new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
          </div>

          <div className="space-y-8 text-slate-600 leading-relaxed text-sm sm:text-base">
            <section>
              <h2 className="text-lg font-bold text-slate-900 mb-3">1. บทนำ (Introduction)</h2>
              <p>
                ยินดีต้อนรับสู่แอปพลิเคชัน <strong>MailMind</strong> ข้อตกลงนี้กำหนดเงื่อนไขการใช้งานระหว่างคุณ (ผู้ใช้งาน) 
                และระบบของเรา การเข้าสู่ระบบถือว่าคุณรับทราบและยินยอมตามข้อกำหนดที่ระบุไว้ในเอกสารฉบับนี้อย่างครบถ้วน
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-slate-900 mb-3">2. การขอสิทธิ์และเข้าถึงข้อมูล (Data Access & OAuth)</h2>
              <p className="mb-2">แอปพลิเคชันของเราใช้มาตรฐานการยืนยันตัวตน Google OAuth 2.0 โดยต้องการสิทธิ์ต่อไปนี้:</p>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong>สิทธิ์การอ่านอีเมล (Gmail Read-Only/Modify):</strong> เพื่อดึงข้อมูลอีเมลมาวิเคราะห์และเปลี่ยนสถานะการอ่าน</li>
                <li><strong>สิทธิ์การจัดการปฏิทิน (Google Calendar):</strong> เพื่อสร้าง อัปเดต และลบการนัดหมายที่สกัดได้จากอีเมล</li>
              </ul>
              <p className="mt-2 text-slate-500 text-sm bg-slate-50 p-3 rounded-lg border border-slate-100">
                *ระบบของเราไม่ได้ดาวน์โหลดหรือคัดลอกอีเมลของคุณไปเก็บไว้ในฐานข้อมูลถาวรของเรา การประมวลผลเกิดขึ้นแบบ Real-time
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-slate-900 mb-3">3. การประมวลผลด้วย AI</h2>
              <p>ผู้ใช้เลือกได้ว่าจะให้โมเดลใดประมวลผลเนื้อหาอีเมล: หากเลือก Ollama เนื้อหาจะถูกประมวลผลบนเครื่องที่ติดตั้งระบบและไม่ถูกส่งให้ผู้ให้บริการ AI ภายนอก หากเลือกผู้ให้บริการ AI ภายนอก (เช่น OpenAI, Google Gemini, KKU IntelSphere, OpenRouter) เนื้อหาอีเมลที่วิเคราะห์และร่างตอบจะถูกส่งไปยังผู้ให้บริการรายนั้นตามนโยบายของผู้ให้บริการ ระบบจะไม่สลับผู้ให้บริการเองโดยที่ผู้ใช้ไม่ได้เลือก</p>
              <p className="mt-2 font-medium text-slate-700">
                การปฏิเสธความรับผิดชอบ: ระบบ AI อาจให้ข้อมูลที่ไม่แม่นยำหรือผิดพลาดได้ (Hallucination) 
                ผู้ใช้มีหน้าที่ตรวจสอบข้อความร่าง หรือตารางนัดหมายก่อนกดยืนยันทุกครั้ง
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-slate-900 mb-3">4. ความปลอดภัยของข้อมูล (Data Security)</h2>
              <p>
                Google OAuth Access Token และ Refresh Token ของคุณจะถูกเข้ารหัสผ่านอัลกอริทึมมาตรฐานขั้นสูง (AES-256-GCM) 
                ก่อนบันทึกลงฐานข้อมูล เราไม่มีนโยบายนำโทเค็นของคุณไปใช้เพื่อการอื่นนอกเหนือจากการทำงานของระบบที่คุณสั่งการ 
                และจะไม่แบ่งปันข้อมูลนี้ให้กับบุคคลที่สาม
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-slate-900 mb-3">5. สิทธิของผู้ใช้งาน (User Rights)</h2>
              <p>
                คุณมีสิทธิควบคุมข้อมูลของคุณอย่างเต็มที่ คุณสามารถลบ API Key ออกจากระบบของเราได้ตลอดเวลาผ่านหน้าการตั้งค่า 
                และสามารถเพิกถอนสิทธิ์การเข้าถึง Gmail และ Calendar ของแอปพลิเคชันเราได้โดยตรงผ่านเมนู 
                <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline mx-1">
                  Google Account Security
                </a>
                ของคุณ
              </p>
            </section>
          </div>
          
        </div>
      </div>
    </div>
  );
}