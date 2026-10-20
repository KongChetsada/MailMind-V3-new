// ดึงอีเมลย้อนหลัง (ผู้ใช้สั่งเอง) — ทำทีละช่วงจากใหม่ไปเก่า เรียกซ้ำได้อย่างปลอดภัย
// อีเมลที่ได้มาเป็นสถานะ MANUAL: งานวิเคราะห์อัตโนมัติไม่หยิบ ผู้ใช้กดวิเคราะห์เองรายฉบับ
const { getDeps } = require('./deps');
const { toEmailRow } = require('./emailRow');

const CHUNK_SIZE = 200;
const FETCH_BATCH = 5;

/**
 * ดึงหนึ่งช่วง (ไม่เกิน CHUNK_SIZE ฉบับ) ที่เก่ากว่าตำแหน่งล่าสุด แล้วเลื่อนตำแหน่ง
 * คืน { done, created, cursor }
 */
const backfillChunk = async (accountId, deps = getDeps()) => {
  const { prisma, getMail, now } = deps;
  const account = await prisma.mailAccount.findUnique({ where: { id: accountId } });
  if (!account || account.status !== 'ACTIVE') return { done: true, created: 0, cursor: account?.backfillCursor ?? null, stopped: true };

  const finish = async (cursor, created = 0) => {
    await prisma.mailAccount.update({
      where: { id: accountId },
      data: { backfillCursor: cursor, backfillDoneAt: now(), backfillError: null, backfillCount: { increment: created } },
    });
    return { done: true, created, cursor };
  };

  // เริ่มจากฉบับที่เก่าที่สุดที่มีอยู่แล้ว (ซิงก์ปกติดึงช่วงล่าสุดไว้แล้ว)
  let cursor = account.backfillCursor;
  if (!cursor) {
    const oldest = await prisma.emailMessage.findFirst({
      where: { mailAccountId: accountId },
      orderBy: { receivedAt: 'asc' },
      select: { receivedAt: true },
    });
    cursor = oldest?.receivedAt || now();
  }

  const mail = getMail(account);
  if (typeof mail.listMessageIdsBefore !== 'function') return finish(cursor);

  const { ids } = await mail.listMessageIdsBefore({ before: cursor, maxMessages: CHUNK_SIZE });
  if (ids.length === 0) return finish(cursor);

  const known = await prisma.emailMessage.findMany({
    where: { mailAccountId: accountId, providerMessageId: { in: ids } },
    select: { providerMessageId: true, receivedAt: true },
  });
  const knownIds = new Set(known.map((k) => k.providerMessageId));
  const times = known.map((k) => k.receivedAt.getTime());

  let created = 0;
  const newIds = ids.filter((id) => !knownIds.has(id));
  for (let i = 0; i < newIds.length; i += FETCH_BATCH) {
    const metas = await Promise.all(newIds.slice(i, i + FETCH_BATCH).map((id) => mail.getMessageMeta(id)));
    for (const meta of metas) {
      await prisma.emailMessage.upsert({
        where: { mailAccountId_providerMessageId: { mailAccountId: accountId, providerMessageId: meta.providerMessageId } },
        update: {},
        create: { mailAccountId: accountId, providerMessageId: meta.providerMessageId, ...toEmailRow(meta, 'MANUAL') },
      });
      created += 1;
      times.push(new Date(meta.receivedAt).getTime());
    }
  }

  const oldest = new Date(Math.min(...times));
  // ตำแหน่งไม่ขยับ = ไม่มีฉบับที่เก่ากว่านี้แล้ว (กันวนไม่จบ)
  if (!(oldest < cursor)) return finish(cursor, created);

  await prisma.mailAccount.update({
    where: { id: accountId },
    data: { backfillCursor: oldest, backfillError: null, backfillCount: { increment: created } },
  });
  return { done: false, created, cursor: oldest };
};

module.exports = { backfillChunk, CHUNK_SIZE };
