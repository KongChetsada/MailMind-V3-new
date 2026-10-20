// ตั้งเวลางานเบื้องหลัง
const cron = require('node-cron');
const { env } = require('../config/env');
const { createLogger } = require('../utils/logger');
const { runSyncJob } = require('./syncJob');
const { runAnalyzeJob } = require('./analyzeJob');
const { resumeBackfills } = require('./backfillJob');

const startJobs = () => {
  const logger = createLogger('JOBS');
  if (!env.jobs.enabled) {
    logger.info('JOBS_DISABLED', 'Background jobs are disabled (JOBS_ENABLED=false)');
    return;
  }
  cron.schedule(env.jobs.syncCron, () => runSyncJob());
  logger.info('JOBS_REGISTERED', 'Background jobs registered', {
    syncCron: env.jobs.syncCron,
    analyzeConcurrency: env.jobs.analyzeConcurrency,
  });
  // เก็บงานที่ค้างจากรอบก่อนทันทีที่เซิร์ฟเวอร์เริ่ม
  runAnalyzeJob().catch(() => {});
  resumeBackfills().catch((error) => logger.warn('BACKFILL_RESUME_FAILED', 'Could not resume backfill', { error: error.message }));
};

module.exports = { startJobs };
