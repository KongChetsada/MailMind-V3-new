// งานซิงก์: ดึงอีเมลใหม่ของทุกบัญชีที่ใช้งานได้ แล้วส่งต่อให้งานวิเคราะห์
const { getDeps } = require('../workflows/deps');
const { syncAccount } = require('../workflows/syncAccount');
const { runAnalyzeJob } = require('./analyzeJob');

let running = false;

const runSyncJob = async (deps = getDeps()) => {
  if (running) return { status: 'already_running' };
  running = true;
  const logger = deps.logger.child({}, 'SYNC_JOB');
  try {
    const accounts = await deps.prisma.mailAccount.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    const results = [];
    for (const { id } of accounts) {
      try {
        results.push(await syncAccount(id, deps));
      } catch (error) {
        results.push({ status: 'failed', error: error.message }); // บัญชีหนึ่งล้มเหลวไม่หยุดบัญชีอื่น
      }
    }
    logger.info('JOB_END', 'Sync job finished', { accounts: accounts.length, results });
    return { status: 'completed', accounts: accounts.length };
  } catch (error) {
    logger.error('JOB_ERROR', 'Sync job failed', error);
    return { status: 'failed' };
  } finally {
    running = false;
    runAnalyzeJob(deps).catch(() => {});
  }
};

module.exports = { runSyncJob };
