// ตามการเปลี่ยนแปลงที่เกิดนอกระบบ (ผู้ใช้ลบ ย้ายลงถังขยะ กู้คืน หรืออ่านอีเมลใน Gmail โดยตรง)
// ใช้บันทึกการเปลี่ยนแปลงของผู้ให้บริการ: หนึ่งคำขอต่อรอบซิงก์ ไม่ต้องถามสถานะทีละฉบับ
//
// อีเมลที่ถูกลบฝั่งผู้ให้บริการไม่ถูกลบออกจากฐานข้อมูล แต่ถูกซ่อน (removedAt) —
// ประวัติการตอบ รายการที่ลงปฏิทินแล้ว และสถิติยังอยู่ครบ
const { SKIP_PROVIDER_LABELS } = require('../core/categories');

const RESTORE_LIMIT = 50;
const EMPTY = { removed: 0, restored: 0, readChanged: 0 };

/**
 * @returns { cursor, removed, restored, readChanged } — cursor คือค่าที่ต้องเก็บไว้ใช้รอบถัดไป
 * ตัวเชื่อมที่ไม่มี getChanges (เช่น โหมดสาธิต) ถูกข้าม
 */
const applyProviderChanges = async ({ account, mail, prisma, now, logger }) => {
  if (typeof mail.getChanges !== 'function') return { cursor: account.changeCursor, ...EMPTY };

  const scope = { mailAccountId: account.id };
  let removedIds = [];
  let restoredIds = [];
  let readIds = [];
  let unreadIds = [];
  let cursor = account.changeCursor;

  const changes = cursor ? await mail.getChanges({ cursor }) : { expired: true };
  if (changes.expired) {
    // ครั้งแรก หรือ cursor เก่าเกินไป: ตั้งจุดเริ่มใหม่ แล้วตรวจย้อนหลังจากถังขยะ/สแปมแทน
    cursor = await mail.getChangeCursor();
    removedIds = await mail.listRemovedIds({ days: 30 });
    logger?.info('CHANGES_BASELINE', 'Provider change cursor (re)initialised', { removedCandidates: removedIds.length });
  } else {
    ({ cursor, removedIds, restoredIds, readIds, unreadIds } = changes);
  }

  const removed = removedIds.length
    ? await prisma.emailMessage.updateMany({
        where: { ...scope, providerMessageId: { in: removedIds }, removedAt: null },
        data: { removedAt: now() },
      })
    : { count: 0 };

  // กู้คืน: ฉบับที่เคยซ่อนให้กลับมา ส่วนฉบับที่ระบบไม่เคยรู้จักให้ดึงเข้ามาใหม่ถ้าอยู่ในกล่องขาเข้า
  let restored = 0;
  if (restoredIds.length) {
    const back = await prisma.emailMessage.updateMany({
      where: { ...scope, providerMessageId: { in: restoredIds }, removedAt: { not: null } },
      data: { removedAt: null },
    });
    restored += back.count;
    const known = await prisma.emailMessage.findMany({
      where: { ...scope, providerMessageId: { in: restoredIds } },
      select: { providerMessageId: true },
    });
    const knownIds = new Set(known.map((k) => k.providerMessageId));
    for (const id of restoredIds.filter((x) => !knownIds.has(x)).slice(0, RESTORE_LIMIT)) {
      try {
        const meta = await mail.getMessageMeta(id);
        const labels = meta.labels || [];
        if (!labels.includes('INBOX') || labels.includes('TRASH') || labels.includes('SENT')) continue;
        const skip = labels.some((label) => SKIP_PROVIDER_LABELS.includes(label));
        await prisma.emailMessage.upsert({
          where: { mailAccountId_providerMessageId: { mailAccountId: account.id, providerMessageId: id } },
          update: { removedAt: null },
          create: {
            mailAccountId: account.id,
            providerMessageId: id,
            providerThreadId: meta.providerThreadId,
            fromName: meta.fromName,
            fromAddress: meta.fromAddress,
            subject: meta.subject,
            snippet: meta.snippet,
            receivedAt: meta.receivedAt,
            isRead: meta.isRead,
            ...(skip ? { analysisStatus: 'SKIPPED', category: 'OTHER', priority: 'LOW' } : {}),
          },
        });
        restored += 1;
      } catch (error) {
        if (error.code === 'REAUTH_REQUIRED') throw error;
        // ข้อความอาจถูกลบอีกรอบระหว่างนั้น — ข้ามได้
      }
    }
  }

  let readChanged = 0;
  for (const [ids, isRead] of [[readIds, true], [unreadIds, false]]) {
    if (!ids.length) continue;
    const result = await prisma.emailMessage.updateMany({
      where: { ...scope, providerMessageId: { in: ids }, isRead: !isRead },
      data: { isRead },
    });
    readChanged += result.count;
  }

  return { cursor, removed: removed.count, restored, readChanged };
};

module.exports = { applyProviderChanges };
