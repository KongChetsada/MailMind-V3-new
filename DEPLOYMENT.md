# Deploy MailMind: Vercel + Railway

คู่มือนี้ใช้ frontend แบบ Next.js บน Vercel และ backend แบบ Docker บน Railway พร้อม PostgreSQL แยกบริการ ไม่ต้องย้ายโครงสร้าง repository

## ก่อนเริ่ม

- ใช้ Node.js **22.x** และ pnpm **10.33.0** ตาม `package.json` ทั้งสองฝั่ง
- ใช้ `pnpm-lock.yaml` ที่อยู่ใน Git และติดตั้งด้วย `--frozen-lockfile` เสมอ
- มี `package-lock.json` ที่ไม่ได้ track อยู่เดิมทั้งสองโฟลเดอร์ งานนี้ไม่ได้แก้หรือลบไฟล์เหล่านั้น ขั้นตอน deploy นี้ใช้ pnpm เท่านั้น
- นำไฟล์ที่เปลี่ยนไป commit/push เองเมื่อพร้อม งานเตรียม deploy ไม่ได้ commit, push หรือเชื่อมบัญชี cloud ให้
- ห้าม commit `.env` หรือ secrets; ใช้ `.env.production.example` เป็นรายการตัวแปรเท่านั้น
- ยังต้องมี Google OAuth credentials, URL production และค่าฐานข้อมูลจริงก่อนเปิดใช้งาน

## 1. เตรียมชื่อโดเมนและบริการ

สร้าง Vercel project โดยตั้ง Root Directory เป็น `Frontend` เพื่อทราบ production domain ที่จะใช้ หากระบบพยายาม build ก่อนตั้งตัวแปรแล้วล้มเหลว ให้ตั้งค่าตามด้านล่างแล้ว redeploy

สร้าง Railway project พร้อม PostgreSQL service และ backend service จาก GitHub repository เดียวกัน เลือก branch ที่ต้องการใช้งาน เช่น `deploy` อย่าเปิด deployment สาธารณะก่อนตั้งค่าครบ

สร้าง public domain ของ backend เพื่อใช้ใน OAuth และ Vercel สามารถกำหนดโดเมนทั้งสองฝั่งก่อน deploy สำเร็จ ไม่ต้องตั้ง localhost ชั่วคราวใน production

## 2. Railway backend

ตั้งค่า service ดังนี้:

| รายการ | ค่า |
| --- | --- |
| Root Directory | `/Backend` |
| Builder | Dockerfile ที่ `Backend/Dockerfile` (ภายใต้ build context คือ `Dockerfile`) |
| Build Command | ไม่ต้อง override; Dockerfile จัดการ install และ Prisma generate |
| Pre-deploy Command | `pnpm db:deploy` |
| Start Command | `node server.js` หรือปล่อยใช้ CMD ใน Dockerfile |
| Healthcheck Path | `/api/health` |
| Healthcheck Timeout | `120` วินาที |
| Replicas | `1` |
| Serverless / sleep | ปิดเมื่อใช้ background jobs |

Docker image เก็บ Prisma CLI ไว้สำหรับ migration และรัน server ด้วยผู้ใช้ `node` ไม่ใช่ root ไม่คัดลอก `.env` หรือ `node_modules` จากเครื่องผู้พัฒนา

Pre-deploy ต้องสำเร็จก่อน server เริ่ม ให้ Railway ส่ง `PORT` มาเองและกำหนด target port ของ public networking ให้ตรงกัน ไม่ต้องตั้ง `PORT=5000` เอง ค่า `EXPOSE 5000` เป็น metadata ไม่ได้บังคับพอร์ต runtime

`/api/health` ตรวจว่า HTTP server ทำงานเท่านั้น ไม่ได้ตรวจ Google, AI หรือสถานะ database แบบต่อเนื่อง

### Variables ที่ต้องตั้ง

ใช้ `Backend/.env.production.example` เป็นรายการตั้งต้น:

| ตัวแปร | ค่าที่ต้องใช้ |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Variable reference ไปยัง `DATABASE_URL` ของ PostgreSQL service เช่น `${{Postgres.DATABASE_URL}}` ถ้าชื่อบริการคือ `Postgres` |
| `FRONTEND_URL` | origin ของ production frontend เช่น `https://YOUR-FRONTEND.vercel.app` ไม่มี path |
| `JWT_SECRET` | ค่าสุ่มอย่างน้อย 32 ตัวอักษร |
| `ENCRYPTION_SECRET` | ค่าสุ่มอีกค่าหนึ่ง ต้องต่างจาก `JWT_SECRET` และอย่างน้อย 32 ตัวอักษร |
| `GOOGLE_CLIENT_ID` | OAuth Web client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth Web client secret |
| `GOOGLE_REDIRECT_URI` | `https://YOUR-BACKEND.up.railway.app/api/auth/google/callback` |
| `DEMO_MODE` | `false` |
| `LOG_SENSITIVE_CONTENT` | `false` |
| `LOG_LEVEL` | `info` |
| `JOBS_ENABLED` | `true` |
| `DB_POOL_MAX` | เริ่มต้น `5` แล้วปรับตาม connection limit ของฐานข้อมูล |

สร้าง secret สองค่าจาก password manager หรือรันคำสั่งนี้สองครั้งบนเครื่องตนเอง แล้วใส่ใน dashboard โดยตรง ไม่ส่งค่าจริงในแชต:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

**อย่าเปลี่ยน `ENCRYPTION_SECRET` ทุกครั้งที่ deploy** เพราะใช้ถอดรหัส Google tokens และ AI keys ที่บันทึกอยู่ ส่วนการเปลี่ยน `JWT_SECRET` จะทำให้ session เดิมใช้ไม่ได้

Production จะปฏิเสธการเริ่มทำงานหากตัวแปรสำคัญขาด, URL ไม่ใช่ HTTPS, callback path ผิด, secrets สั้น/ซ้ำ หรือเปิด demo mode

### ข้อจำกัด background jobs

ใช้เพียงหนึ่ง replica ก่อน ยังไม่ได้รับรองการรัน worker หลายตัวหรือการเปลี่ยนรุ่นที่มี worker เก่าและใหม่ซ้อนกัน ควร deploy ช่วงไม่มีงานค้าง หากต้องการ zero-downtime พร้อม jobs ต้องทดสอบการประสานงานและการหยุด worker เพิ่มก่อน ไม่ควรเปิด autoscaling โดยถือว่ารองรับแล้ว

## 3. Google OAuth

1. เปิด Gmail API และ Google Calendar API ใน Google Cloud project
2. ตั้ง OAuth consent screen และสร้าง OAuth client ชนิด Web application
3. ตั้ง Authorized redirect URI ให้ **ตรงกับ `GOOGLE_REDIRECT_URI` ทุกตัวอักษร**
4. หากแอปยังอยู่ในโหมด Testing ให้เพิ่มบัญชีที่จะใช้เป็น Test users
5. ตรวจข้อกำหนด verification ของ scopes ที่ร้องขอก่อนเปิดให้ผู้ใช้ทั่วไป
6. เมื่อเปลี่ยน backend domain ต้องปรับ redirect URI ทั้ง Google และ Railway

แอปนี้ใช้ backend เป็นผู้รับ callback ไม่ใช่หน้า `/login-success` บน Vercel ส่วน JWT จะกลับไป frontend ผ่าน URL fragment

## 4. Vercel frontend

| รายการ | ค่า |
| --- | --- |
| Root Directory | `Frontend` |
| Framework | Next.js |
| Node.js | `22.x` |
| Install Command | อ่านจาก `Frontend/vercel.json` |
| Build Command | อ่านจาก `Frontend/vercel.json` |
| Output Directory | ใช้ค่า default ของ Next.js ไม่ override |
| Environment Variable | `NEXT_PUBLIC_BACKEND_URL=https://YOUR-BACKEND.up.railway.app` |

ตัวแปรนี้ต้องไม่มี `/api` และต้องตั้งก่อน build เพราะค่าถูกฝังใน JavaScript ของ browser เปลี่ยน URL แล้วต้อง redeploy

ห้ามใส่ database URL, OAuth client secret, `JWT_SECRET` หรือ `ENCRYPTION_SECRET` ในตัวแปร `NEXT_PUBLIC_*`

ตั้งค่า Production ก่อน หากต้องการ Preview ที่ login และเรียก API ได้ ให้แยก staging backend/database และตั้ง `FRONTEND_URL` เป็น preview domain ที่แน่นอน ไม่เปิด wildcard CORS ให้ทุก Vercel preview ของทุกคน

Production backend อนุญาต CORS เฉพาะ `FRONTEND_URL` ไม่มี localhost ใน allowlist ส่วน authentication ใช้ Bearer token ไม่ใช่ cross-site cookie

## 5. ตั้ง AI ก่อนใช้งานจริง

ค่าเริ่มต้นของผู้ใช้ใหม่ยังเป็น Ollama บน localhost แต่ localhost ใน Railway คือ container ไม่ใช่เครื่องผู้พัฒนา

หลัง login ไปที่ Settings แล้วบันทึก Cloud AI key ของผู้ใช้ เลือก provider/model และทดสอบการเชื่อมต่อ หรือเตรียม Ollama endpoint ที่ backend เข้าถึงได้อย่างปลอดภัยก่อน แล้วตั้ง `LOCAL_AI_BASE_URL`

Cloud keys ของแอปนี้บันทึกผ่าน Settings และเข้ารหัสใน database ไม่ได้อ่าน `OPENAI_API_KEY` จาก Railway โดยอัตโนมัติ งานวิเคราะห์ที่ล้มเหลวก่อนตั้ง AI อาจต้องสั่งวิเคราะห์ใหม่หลังตั้งค่าเสร็จ

## 6. ตรวจหลัง deploy

- [ ] Railway migration สำเร็จและไม่มี migration ค้าง
- [ ] Backend `/api/health` ตอบ HTTP 200 และ `demoMode: false`
- [ ] Vercel build สำเร็จและเปิด `/login` ได้
- [ ] Google login กลับมายัง frontend production ที่ถูกต้อง
- [ ] เรียก API จาก browser ได้ ไม่มี CORS error และไม่มี request ไป localhost
- [ ] Refresh หน้า `/inbox`, `/settings`, `/calendar` ได้
- [ ] ตั้ง AI แล้วทดสอบวิเคราะห์อีเมลตัวอย่างที่ยินยอมให้ประมวลผล
- [ ] ตรวจการส่งอีเมล/สร้างกิจกรรมด้วยบัญชีทดสอบและการยืนยันของผู้ใช้
- [ ] ตรวจ logs ว่าไม่มี token, API key หรือเนื้อหาอีเมลที่ไม่ควรบันทึก
- [ ] เปิด backup ฐานข้อมูลและตรวจค่าใช้จ่ายก่อนรับผู้ใช้จริง

## ทดสอบในเครื่อง

```bash
cd Backend
pnpm install --frozen-lockfile
pnpm test
pnpm build

# ใช้เฉพาะฐานข้อมูลทดสอบแยก ห้ามชี้ test:db ไป production
pnpm db:deploy
pnpm test:db

cd ../Frontend
pnpm install --frozen-lockfile
pnpm test
pnpm lint
# ตั้ง NEXT_PUBLIC_BACKEND_URL เป็น HTTPS backend origin ก่อน build
pnpm build
pnpm typecheck
```

สำหรับทดสอบ build โดยไม่เชื่อมระบบจริง ใช้ `https://api.example.com` ได้เพื่อทดสอบการ compile เท่านั้น ไม่ใช่ endpoint ที่ใช้งานได้จริง

## Rollback

สำรองฐานข้อมูลก่อน migration บนระบบที่มีข้อมูลจริง Railway pre-deploy ใช้ `prisma migrate deploy` ไม่ใช้ `db push` หรือ `migrate dev` และไม่ reset ฐานข้อมูล

Rollback application ได้ด้วย deployment ก่อนหน้าเมื่อ schema ยัง compatible แต่ rollback code ไม่ย้อน migration ให้อัตโนมัติ หากต้องย้อน schema ต้องมีแผน migration/restore แยกพร้อมยอมรับผลต่อข้อมูล

## เอกสารผู้ให้บริการที่ใช้อ้างอิง

- Railway Dockerfiles: https://docs.railway.com/guides/dockerfiles
- Railway pre-deploy: https://docs.railway.com/deployments/pre-deploy-command
- Railway healthchecks: https://docs.railway.com/deployments/healthchecks
- Vercel package managers: https://vercel.com/docs/package-managers
- Vercel project configuration: https://vercel.com/docs/project-configuration

ใช้ Dockerfile และตั้ง deploy options ผ่าน Railway dashboard ไม่เพิ่ม legacy `railway.json` ให้บริการใหม่ เอกสาร Railway ที่ตรวจระหว่างเตรียมงานระบุว่า Config as Code เดิมถูกแทนด้วย Infrastructure as Code
