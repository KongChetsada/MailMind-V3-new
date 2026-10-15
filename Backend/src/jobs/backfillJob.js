// งานดึงอีเมลย้อนหลังในเบื้องหลัง: วนดึงทีละช่วงจนครบ หยุดได้ และทำต่อเมื่อเซิร์ฟเวอร์เริ่มใหม่
const { getDeps } = require('../workflows/deps');
const { backfillChunk } = require('../workflows/backfillAccount');

// พักระหว่างช่วง เพื่อไม่ใช้โควตา Gmail API จนการซิงก์ปกติสะดุด
const PAUSE_MS = 1000;

const running = new Set();
const stopRequested = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isBackfillRunning = (accountId) => running.has(accountId);

/** วนจนจบ หยุดเมื่อถูกสั่ง หรือเกิดข้อผิดพลาด (บันทึกไว้ให้ผู้ใช้เห็น) */
const runBackfill = async (accountId, deps = getDeps()) => {
  if (running.has(accountId)) return { status: 'already_running' };
  running.add(accountId);
  const logger = deps.logger.child({ accountId }, 'BACKFILL');
  let total = 0;
  try {
    for (;;) {
      if (stopRequested.has(accountId)) {
        logger.info('BACKFILL_STOPPED', 'Backfill stopped by the user', { created: total });
        return { status: 'stopped', created: total };
      }
      const result = await backfillChunk(accountId, deps);
      total += result.created;
      if (result.done) {
        logger.info('BACKFILL_END', 'Backfill finished', { created: total, oldest: result.cursor });
        return { status: result.stopped ? 'stopped' : 'done', created: total };
      }
      await sleep(deps.backfillPauseMs ?? PAUSE_MS);
    }
  } catch (error) {
    const reauth = error.code === 'REAUTH_REQUIRED';
    // ล้าง backfillStartedAt: ไม่ทำต่อเองตอนรีสตาร์ต ผู้ใช้กด "ทำต่อ" เมื่อพร้อม
    await deps.prisma.mailAccount.update({
      where: { id: accountId },
      data: {
        backfillError: String(error.message || error).slice(0, 300),
        backfillStartedAt: null,
        ...(reauth ? { status: 'NEEDS_REAUTH' } : {}),
      },
    });
    logger.error('BACKFILL_ERROR', 'Backfill failed', error, { created: total });
    return { status: 'failed', created: total, error: error.message };
  } finally {
    running.delete(accountId);
    stopRequested.delete(accountId);
  }
};

/** เริ่มหรือทำต่อจากตำแหน่งเดิม — คืนทันที งานทำในเบื้องหลัง (wait = true สำหรับการทดสอบ) */
const startBackfill = async (accountId, { wait = false } = {}, deps = getDeps()) => {
  stopRequested.delete(accountId); // กดเริ่มใหม่ระหว่างที่งานเดิมกำลังจะหยุด
  await deps.prisma.mailAccount.update({
    where: { id: accountId },
    data: { backfillStartedAt: deps.now(), backfillDoneAt: null, backfillError: null },
  });
  const job = runBackfill(accountId, deps);
  if (wait) return job;
  job.catch(() => {});
  return { status: 'started' };
};

/** หยุดหลังจบช่วงที่กำลังดึง — ตำแหน่งยังอยู่ กดทำต่อได้ */
const stopBackfill = async (accountId, deps = getDeps()) => {
  if (running.has(accountId)) stopRequested.add(accountId);
  await deps.prisma.mailAccount.update({ where: { id: accountId }, data: { backfillStartedAt: null } });
};

/** ตอนเซิร์ฟเวอร์เริ่ม: ทำต่องานที่ค้างจากรอบก่อน */
const resumeBackfills = async (deps = getDeps()) => {
  const accounts = await deps.prisma.mailAccount.findMany({
    where: { status: 'ACTIVE', backfillStartedAt: { not: null }, backfillDoneAt: null },
    select: { id: true },
  });
  for (const { id } of accounts) runBackfill(id, deps).catch(() => {});
  return accounts.length;
};

module.exports = { startBackfill, stopBackfill, runBackfill, resumeBackfills, isBackfillRunning };
