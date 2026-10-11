// งานวิเคราะห์: หยิบอีเมลที่รออยู่จากฐานข้อมูลมาวิเคราะห์ทีละชุด (ตาราง EmailMessage ทำหน้าที่เป็นคิว)
const { env } = require('../config/env');
const { getDeps } = require('../workflows/deps');
const { analyzeEmail } = require('../workflows/analyzeEmail');

const STALE_MS = 15 * 60 * 1000;
const BATCH_SIZE = 20;
let running = false;

/** คืนสถานะที่ค้างจากการที่เซิร์ฟเวอร์หยุดกลางคัน */
const recoverStale = async (deps = getDeps()) => {
  const { prisma, now } = deps;
  const cutoff = new Date(now().getTime() - STALE_MS);
  const [emails, drafts, actions] = await Promise.all([
    prisma.emailMessage.updateMany({
      where: { analysisStatus: 'PROCESSING', updatedAt: { lt: cutoff } },
      data: { analysisStatus: 'PENDING' },
    }),
    // ไม่รู้ว่าอีเมลออกไปแล้วหรือยัง จึงไม่ส่งใหม่เอง ให้ผู้ใช้ตรวจก่อน
    prisma.replyDraft.updateMany({
      where: { status: 'SENDING', updatedAt: { lt: cutoff } },
      data: { status: 'FAILED', errorMessage: 'ไม่ทราบผลการส่ง กรุณาตรวจกล่อง Sent ก่อนส่งใหม่' },
    }),
    // สร้างกิจกรรมซ้ำด้วยรหัสเดิมได้อย่างปลอดภัย จึงให้ผู้ใช้กดยืนยันใหม่ได้
    prisma.actionItem.updateMany({
      where: { status: 'CREATING', updatedAt: { lt: cutoff } },
      data: { status: 'FAILED', errorMessage: 'การบันทึกถูกขัดจังหวะ กรุณากดยืนยันอีกครั้ง' },
    }),
  ]);
  return { emails: emails.count, drafts: drafts.count, actions: actions.count };
};

/**
 * วิเคราะห์อีเมลที่รออยู่ทั้งหมดของผู้ใช้ที่เปิดการวิเคราะห์อัตโนมัติ
 * @param scope.accountIds  จำกัดเฉพาะบัญชีที่ระบุ (ใช้ในการทดสอบ เพื่อไม่แตะข้อมูลของบัญชีอื่นในฐานข้อมูลเดียวกัน)
 */
const runAnalyzeJob = async (deps = getDeps(), scope = {}) => {
  if (running) return { status: 'already_running' };
  running = true;
  const { prisma } = deps;
  const logger = deps.logger.child({}, 'ANALYZE_JOB');
  const totals = { processed: 0, ok: 0, failed: 0 };
  const attempted = new Set();

  try {
    await recoverStale(deps);
    for (;;) {
      const batch = await prisma.emailMessage.findMany({
        where: {
          id: { notIn: [...attempted] },
          OR: [
            { analysisStatus: 'PENDING' },
            { analysisStatus: 'FAILED', analysisAttempts: { lt: env.jobs.analyzeMaxAttempts } },
          ],
          mailAccount: {
            ...(scope.accountIds ? { id: { in: scope.accountIds } } : {}),
            status: 'ACTIVE',
            user: { OR: [{ setting: null }, { setting: { isAutoAnalyzeActive: true } }] },
          },
        },
        orderBy: { receivedAt: 'desc' },
        take: BATCH_SIZE,
        select: { id: true },
      });
      if (batch.length === 0) break;

      const queue = batch.map((b) => b.id);
      const worker = async () => {
        for (let id = queue.shift(); id; id = queue.shift()) {
          attempted.add(id);
          const result = await analyzeEmail(id, {}, deps);
          if (!result.claimed) continue;
          totals.processed += 1;
          if (result.ok) totals.ok += 1;
          else totals.failed += 1;
        }
      };
      await Promise.all(Array.from({ length: env.jobs.analyzeConcurrency }, worker));
    }
    if (totals.processed > 0) logger.info('JOB_END', 'Analyze job finished', totals);
    return { status: 'completed', ...totals };
  } catch (error) {
    logger.error('JOB_ERROR', 'Analyze job failed', error);
    return { status: 'failed', ...totals };
  } finally {
    running = false;
  }
};

module.exports = { runAnalyzeJob, recoverStale };
