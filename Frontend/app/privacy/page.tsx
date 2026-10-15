"use client";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        
        {/* กล่องเนื้อหา */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 sm:p-12">
          
          <div className="flex items-center gap-4 mb-8 pb-8 border-b border-slate-100">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">นโยบายความเป็นส่วนตัว (Privacy Policy)</h1>
              <p className="text-slate-500 mt-1">
                อัปเดตล่าสุด: {new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>

          <div className="space-y-8 text-slate-600 leading-relaxed text-sm sm:text-base">
            <section>
              <h2 className="text-lg font-bold text-slate-900 mb-3">1. ข้อมูลที่เรารวบรวม (Information We Collect)</h2>
              <p className="mb-2">เมื่อคุณเข้าใช้งานแอปพลิเคชัน <strong>MailMind</strong> เรารวบรวมข้อมูลที่จำเป็นต่อการให้บริการดังนี้:</p>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong>ข้อมูลบัญชีพื้นฐาน:</strong> ชื่อ, ที่อยู่อีเมล, และรูปโปรไฟล์ที่ได้รับอนุญาตผ่านระบบ Google OAuth</li>
                <li><strong>ข้อมูลการตั้งค่า (User Settings):</strong> รูปแบบการตอบกลับ, ลายเซ็นอีเมล, และเวลาทำการที่คุณกำหนดไว้</li>
                <li><strong>ข้อมูลการยืนยันตัวตน (OAuth Tokens):</strong> โทเค็นสำหรับการเชื่อมต่อ Google API ซึ่งจะถูกเข้ารหัสขั้นสูงก่อนจัดเก็บ</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold text-slate-900 mb-3">2. การเข้าถึงและการใช้งานข้อมูลอีเมล (Email Data Access)</h2>
              <p>
                เราเข้าถึงข้อมูลอีเมลของคุณแบบอ่านอย่างเดียว (Read-Only) หรือเปลี่ยนสถานะการอ่านเฉพาะเพื่อนำเนื้อหามาให้ AI ประมวลผลและสกัดข้อมูลการนัดหมาย 
                <strong> เราไม่ได้ดาวน์โหลด คัดลอก หรือจัดเก็บเนื้อหาอีเมลแบบข้อความเต็ม (Full Text) ไว้ในฐานข้อมูลของเราอย่างถาวร </strong> 
                ข้อมูลจะถูกประมวลผลในหน่วยความจำชั่วคราวและลบทิ้งทันทีเมื่อการทำงานของระบบเสร็จสิ้น
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-slate-900 mb-3">3. การประมวลผลด้วย AI</h2>
              <p>ผู้ใช้เลือกได้ว่าจะให้โมเดลใดประมวลผลเนื้อหาอีเมล: หากเลือก Ollama เนื้อหาจะถูกประมวลผลบนเครื่องที่ติดตั้งระบบและไม่ถูกส่งให้ผู้ให้บริการ AI ภายนอก หากเลือกผู้ให้บริการ AI ภายนอก (เช่น OpenAI, Google Gemini, KKU IntelSphere, OpenRouter) เนื้อหาอีเมลที่วิเคราะห์และร่างตอบจะถูกส่งไปยังผู้ให้บริการรายนั้นตามนโยบายของผู้ให้บริการ ระบบจะไม่สลับผู้ให้บริการเองโดยที่ผู้ใช้ไม่ได้เลือก</p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-slate-900 mb-3">4. การรักษาความปลอดภัยของข้อมูล (Data Security)</h2>
              <p>
                เราให้ความสำคัญกับความปลอดภัยของข้อมูลคุณอย่างสูงสุด ข้อมูลที่มีความละเอียดอ่อนโดยเฉพาะ <strong>OAuth Access & Refresh Token</strong> 
                จะถูกเข้ารหัสผ่านอัลกอริทึมมาตรฐาน <code>AES-256-GCM</code> พร้อมกับ IV และ Auth Tag แยกส่วนกัน ทำให้ไม่สามารถอ่านค่าได้หากไม่มีกุญแจถอดรหัสฝั่งเซิร์ฟเวอร์ 
                นอกจากนี้ การรับส่งข้อมูลทั้งหมดจะผ่านเครือข่ายที่เข้ารหัส (HTTPS/TLS)
              </p>
            </section>

            <section>
              <h2 className="text-lg font-bold text-slate-900 mb-3">5. การจัดการและการลบข้อมูล (Data Retention & Deletion)</h2>
              <p className="mb-2">คุณมีสิทธิโดยชอบธรรมในการจัดการข้อมูลของตนเอง:</p>
              <ul className="list-disc pl-5 space-y-2">
                <li>คุณสามารถลบข้อมูล API Key และการตั้งค่าส่วนตัวออกจากระบบได้ตลอดเวลา</li>
                <li>ระบบส่งอีเมลแจ้งเตือนเมื่อพบนัดหมายใหม่ถึงที่อยู่อีเมลของคุณเองผ่านบัญชี Gmail ที่เชื่อมไว้ ไม่ส่งถึงบุคคลอื่น และปิดได้ในหน้าตั้งค่า</li>
                <li>
                  คุณสามารถยกเลิกการเชื่อมต่อและเพิกถอนสิทธิ์ที่ให้ไว้กับแอปพลิเคชันได้ทันที ผ่านหน้า 
                  <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline mx-1">
                    Google Account Security
                  </a>
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-bold text-slate-900 mb-3">6. การติดต่อเรา (Contact Us)</h2>
              <p>
                หากคุณมีข้อสงสัยเกี่ยวกับนโยบายความเป็นส่วนตัวนี้ หรือต้องการแจ้งลบข้อมูลออกจากระบบอย่างถาวร 
                สามารถติดต่อผู้พัฒนาและดูแลระบบได้โดยตรง
              </p>
            </section>
          </div>
          
        </div>
      </div>
    </div>
  );
}