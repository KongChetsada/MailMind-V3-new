// สถิติการใช้งาน คำนวณจากตารางหลักโดยตรง (ไม่มีตารางสถิติแยก)
const prisma = require('../../config/prisma');
const { CATEGORY_CODES, effectiveCategory } = require('../../core/categories');
const { normalizeTimeZone, zonedParts } = require('../../core/time');

const pad = (n) => String(n).padStart(2, '0');
const countBy = (rows, key) => rows.reduce((acc, row) => ({ ...acc, [row[key]]: row._count }), {});

const getStats = async (userId, days = 30) => {
  const setting = await prisma.userSetting.findUnique({ where: { userId } });
  const timezone = normalizeTimeZone(setting?.timezone);
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const scope = { mailAccount: { userId }, receivedAt: { gte: from } };

  const [emails, draftGroups, actionGroups, sentDrafts, modelGroups] = await Promise.all([
    prisma.emailMessage.findMany({
      where: scope,
      select: { receivedAt: true, category: true, userCategory: true, analysisStatus: true },
    }),
    prisma.replyDraft.groupBy({ by: ['status'], where: { email: scope }, _count: true }),
    prisma.actionItem.groupBy({ by: ['status'], where: { email: scope }, _count: true }),
    prisma.replyDraft.findMany({
      where: { email: scope, status: 'SENT', sentAt: { not: null } },
      select: { sentAt: true, source: true, email: { select: { receivedAt: true } } },
    }),
    prisma.emailMessage.groupBy({
      by: ['aiProvider', 'aiModel'],
      where: { ...scope, analysisStatus: 'DONE' },
      _count: true,
    }),
  ]);

  const byStatus = Object.fromEntries(['PENDING', 'PROCESSING', 'DONE', 'FAILED', 'SKIPPED', 'MANUAL'].map((s) => [s, 0]));
  const byCategory = Object.fromEntries(CATEGORY_CODES.map((c) => [c, 0]));
  const perDay = new Map();
  let corrected = 0;

  for (const e of emails) {
    byStatus[e.analysisStatus] += 1;
    const category = effectiveCategory(e);
    if (category) byCategory[category] += 1;
    if (e.userCategory && e.userCategory !== e.category) corrected += 1;
    const p = zonedParts(e.receivedAt, timezone);
    const key = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    perDay.set(key, (perDay.get(key) || 0) + 1);
  }

  const responseMinutes = sentDrafts
    .map((d) => (d.sentAt - d.email.receivedAt) / 60000)
    .filter((m) => m >= 0)
    .sort((a, b) => a - b);
  const median = responseMinutes.length ? responseMinutes[Math.floor(responseMinutes.length / 2)] : null;

  const drafts = countBy(draftGroups, 'status');
  const actions = countBy(actionGroups, 'status');
  const analyzed = byStatus.DONE;
  const attempted = byStatus.DONE + byStatus.FAILED;

  return {
    days,
    from,
    emails: { total: emails.length, ...byStatus },
    byCategory,
    perDay: [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
    classification: {
      analyzed,
      corrected,
      // สัดส่วนที่ผู้ใช้ต้องแก้ประเภทเอง (ยิ่งต่ำยิ่งดี) — null เมื่อยังไม่มีข้อมูล
      correctionRate: analyzed ? corrected / analyzed : null,
      failureRate: attempted ? byStatus.FAILED / attempted : null,
    },
    drafts: {
      pending: drafts.PENDING || 0,
      sent: drafts.SENT || 0,
      discarded: drafts.DISCARDED || 0,
      failed: drafts.FAILED || 0,
      sentAfterEdit: sentDrafts.filter((d) => d.source === 'USER').length,
      medianResponseMinutes: median === null ? null : Math.round(median),
    },
    actions: {
      suggested: actions.SUGGESTED || 0,
      created: actions.CREATED || 0,
      dismissed: actions.DISMISSED || 0,
      merged: actions.MERGED || 0,
      failed: actions.FAILED || 0,
    },
    models: modelGroups
      .filter((m) => m.aiProvider)
      .map((m) => ({ provider: m.aiProvider, model: m.aiModel, analyzed: m._count })),
  };
};

module.exports = { getStats };
