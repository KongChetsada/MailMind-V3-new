// ขั้น (A) ซิงก์: ดึงอีเมลใหม่ของบัญชีหนึ่งบัญชีมาเก็บเป็นแถวรอวิเคราะห์
// เรียกซ้ำได้อย่างปลอดภัย — อีเมลฉบับเดิมไม่ถูกสร้างซ้ำ และตำแหน่งซิงก์เลื่อนเมื่อดึงครบเท่านั้น
const { getDeps } = require('./deps');
const { env } = require('../config/env');
const { applyProviderChanges } = require('./applyProviderChanges');
const { toEmailRow, isSkippedByRule } = require('./emailRow');

const OVERLAP_MS = 5 * 60 * 1000;
const FETCH_BATCH = 5;

const syncAccount = async (accountId, deps = getDeps()) => {
  const { prisma, getMail, now } = deps;
  const logger = deps.logger.child({ accountId }, 'SYNC');

  const account = await prisma.mailAccount.findUnique({ where: { id: accountId } });
  if (!account || account.status !== 'ACTIVE') {
    return { status: 'skipped', reason: account ? account.status : 'not_found' };
  }

  const startedAt = now();
  const since = account.syncCursor
    ? new Date(account.syncCursor.getTime() - OVERLAP_MS)
    : new Date(startedAt.getTime() - env.jobs.initialSyncDays * 24 * 60 * 60 * 1000);

  try {
    const mail = getMail(account);
    const { ids, truncated } = await mail.listMessageIdsSince({ since, maxMessages: env.jobs.syncMaxMessages });

    const known = await prisma.emailMessage.findMany({
      where: { mailAccountId: account.id, providerMessageId: { in: ids } },
      select: { providerMessageId: true },
    });
    const knownIds = new Set(known.map((k) => k.providerMessageId));
    const newIds = ids.filter((id) => !knownIds.has(id));

    let created = 0;
    let skippedByRule = 0;
    for (let i = 0; i < newIds.length; i += FETCH_BATCH) {
      const metas = await Promise.all(newIds.slice(i, i + FETCH_BATCH).map((id) => mail.getMessageMeta(id)));
      for (const meta of metas) {
        const skip = isSkippedByRule(meta);
        const data = toEmailRow(meta, 'PENDING');
        // upsert ป้องกันแถวซ้ำเมื่อมีการซิงก์สองรอบซ้อนกัน
        await prisma.emailMessage.upsert({
          where: {
            mailAccountId_providerMessageId: { mailAccountId: account.id, providerMessageId: meta.providerMessageId },
          },
          update: { isRead: meta.isRead },
          create: { mailAccountId: account.id, providerMessageId: meta.providerMessageId, ...data },
        });
        created += 1;
        if (skip) skippedByRule += 1;
      }
    }

    // การเปลี่ยนแปลงที่เกิดนอกระบบ: ลบ / ถังขยะ / กู้คืน / อ่านแล้ว
    // ขั้นนี้ล้มเหลวได้โดยไม่ทำให้อีเมลใหม่ที่ดึงมาแล้วเสียไป: คงตำแหน่งเดิมไว้ลองใหม่รอบหน้า
    let changes = { cursor: account.changeCursor, removed: 0, restored: 0, readChanged: 0 };
    try {
      changes = await applyProviderChanges({ account, mail, prisma, now, logger });
    } catch (error) {
      if (error.code === 'REAUTH_REQUIRED') throw error;
      logger.warn('CHANGES_FAILED', 'Could not read provider changes; will retry on the next sync', { error: error.message });
    }

    await prisma.mailAccount.update({
      where: { id: account.id },
      data: { syncCursor: startedAt, lastSyncAt: startedAt, lastSyncError: null, changeCursor: changes.cursor },
    });

    const summary = {
      status: 'completed',
      found: ids.length,
      created,
      skippedByRule,
      truncated,
      removed: changes.removed,
      restored: changes.restored,
      readChanged: changes.readChanged,
    };
    logger.info('SYNC_END', 'Account synchronization finished', summary);
    return summary;
  } catch (error) {
    const reauth = error.code === 'REAUTH_REQUIRED';
    await prisma.mailAccount.update({
      where: { id: account.id },
      data: {
        lastSyncError: String(error.message || error).slice(0, 300),
        ...(reauth ? { status: 'NEEDS_REAUTH' } : {}),
      },
    });
    logger.error('SYNC_ERROR', 'Account synchronization failed', error);
    throw error;
  }
};

module.exports = { syncAccount };
