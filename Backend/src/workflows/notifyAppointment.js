// แจ้งเตือนผู้ใช้ทางอีเมลเมื่อพบนัดหมายใหม่รอยืนยัน (ขั้นเสริมหลังวิเคราะห์ ล้มเหลวได้โดยไม่กระทบผลวิเคราะห์)
const { getDeps } = require('./deps');
const { env } = require('../config/env');
const { normalizeTimeZone } = require('../core/time');
const { pickNotifiableItems, buildAppointmentNotification } = require('../core/notifications');

/**
 * ส่งครั้งเดียวต่ออีเมลหนึ่งฉบับ (จองด้วย notifiedAt) และไม่แจ้งอีเมลที่ได้รับก่อนเชื่อมบัญชี
 * (ฉบับย้อนหลังที่ดึงมาตอนเชื่อมครั้งแรก)
 * คืน { sent: boolean, reason? }
 */
const notifyAppointment = async (emailId, deps = getDeps()) => {
  const { prisma, getMail, now } = deps;
  const logger = deps.logger.child({ emailId }, 'NOTIFY');

  const email = await prisma.emailMessage.findUnique({
    where: { id: emailId },
    include: {
      actionItems: { orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }] },
      replyDraft: true,
      mailAccount: { include: { user: { include: { setting: true } } } },
    },
  });
  if (!email) return { sent: false, reason: 'not_found' };
  const account = email.mailAccount;
  const settings = account.user.setting || {};
  const timezone = normalizeTimeZone(settings.timezone);

  if (settings.notifyNewAppointments === false) return { sent: false, reason: 'disabled' };
  if (email.notifiedAt) return { sent: false, reason: 'already_sent' };
  if (email.removedAt) return { sent: false, reason: 'removed' };
  if (email.receivedAt < account.createdAt) return { sent: false, reason: 'before_connected' };

  const items = pickNotifiableItems({ category: email.category, items: email.actionItems, now: now(), timezone });
  if (items.length === 0) return { sent: false, reason: 'nothing_to_notify' };

  const mail = getMail(account);
  if (typeof mail.sendNotification !== 'function') return { sent: false, reason: 'unsupported' };

  // จองก่อนส่ง: งานสองตัวจะไม่ส่งฉบับเดียวกันซ้ำ
  const claim = await prisma.emailMessage.updateMany({
    where: { id: emailId, notifiedAt: null },
    data: { notifiedAt: now() },
  });
  if (claim.count === 0) return { sent: false, reason: 'already_sent' };

  const hasDraft = Boolean(email.replyDraft && email.replyDraft.status === 'PENDING');
  const { subject, html } = buildAppointmentNotification({
    email,
    items,
    timezone,
    inboxUrl: `${env.frontendUrl}/inbox?email=${email.id}`,
    hasDraft,
  });

  try {
    const res = await mail.sendNotification({ to: account.emailAddress, subject, html });
    logger.info('NOTIFY_SENT', 'Appointment notification sent', {
      items: items.length,
      hasDraft,
      providerMessageId: res?.id,
      recipient: logger.protect(account.emailAddress),
    });
    return { sent: true };
  } catch (error) {
    // คืนสถานะ ให้การวิเคราะห์ครั้งถัดไปส่งได้อีก
    await prisma.emailMessage.updateMany({ where: { id: emailId }, data: { notifiedAt: null } });
    logger.warn('NOTIFY_FAILED', 'Appointment notification failed', { error: error.message });
    return { sent: false, reason: 'send_failed', error: error.message, code: error.code };
  }
};

module.exports = { notifyAppointment };
