// สรุปตารางงานรายวัน / สัปดาห์ / เดือน จากกิจกรรมในปฏิทินและรายการที่รอยืนยัน
// รายการกิจกรรมจัดรูปแบบด้วยโค้ดจากข้อมูลจริง — AI เขียนเฉพาะย่อหน้าภาพรวม
const { getDeps } = require('../../workflows/deps');
const { requireActiveAccount } = require('../accounts/accounts.service');
const { buildScheduleOverviewPrompt } = require('../../core/analysis/prompts');
const { normalizeTimeZone, zonedParts, zonedToUtc, formatThaiDate, formatThaiRange } = require('../../core/time');

const TITLES = { DAILY: 'ตารางงานวันนี้', WEEKLY: 'ตารางงานสัปดาห์นี้', MONTHLY: 'ตารางงานเดือนนี้' };

/** ช่วงเวลาของสรุป ตามปฏิทินใน timezone ของผู้ใช้ (สัปดาห์เริ่มวันจันทร์) */
const getPeriod = (type, now, tz) => {
  const p = zonedParts(now, tz);
  const day = (offset) => zonedToUtc({ year: p.year, month: p.month, day: p.day + offset }, tz);
  if (type === 'WEEKLY') {
    const sinceMonday = (p.weekday + 6) % 7;
    return { start: day(-sinceMonday), end: day(7 - sinceMonday) };
  }
  if (type === 'MONTHLY') {
    return {
      start: zonedToUtc({ year: p.year, month: p.month, day: 1 }, tz),
      end: zonedToUtc({ year: p.year, month: p.month + 1, day: 1 }, tz),
    };
  }
  return { start: day(0), end: day(1) };
};

/** ข้อความรายการกิจกรรม (markdown) จากข้อมูลจริง */
const buildScheduleSections = ({ calendarEvents, pendingItems, tz }) => {
  const when = (startAt, endAt, dateOnly) =>
    dateOnly
      ? `${formatThaiDate(new Date(startAt), tz)} (ทั้งวัน)`
      : formatThaiRange(new Date(startAt), endAt ? new Date(endAt) : null, tz);

  const eventLines = calendarEvents.map(
    (e) => `- ${when(e.start, e.end, e.isAllDay)} — ${e.title}${e.location ? ` (${e.location})` : ''}`
  );
  const pendingLines = pendingItems.map(
    (a) =>
      `- ${when(a.startAt, a.endAt, a.isAllDay || !a.isTimeSpecified)} — ${a.kind === 'DEADLINE' ? '[กำหนดส่ง] ' : ''}${a.title}`
  );

  const lines = ['## ในปฏิทิน', ...(eventLines.length ? eventLines : ['- ไม่มีกิจกรรมที่บันทึกไว้'])];
  if (pendingLines.length) lines.push('', '## จากอีเมล รอการยืนยัน', ...pendingLines);
  return { text: lines.join('\n'), count: eventLines.length + pendingLines.length };
};

const cleanOverview = (text) =>
  String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .split('\n')
    .map((line) => line.replace(/^[#\-*\s]+/, '').trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 600);

const getOrGenerateSummary = async (userId, type, force) => {
  const { prisma, getCalendar, getAi, now } = getDeps();
  const setting = await prisma.userSetting.findUnique({ where: { userId } });
  const tz = normalizeTimeZone(setting?.timezone);
  const { start, end } = getPeriod(type, now(), tz);
  const key = { userId_type_periodStart_periodEnd: { userId, type, periodStart: start, periodEnd: end } };

  if (!force) {
    const cached = await prisma.summary.findUnique({ where: key });
    if (cached) return { content: cached.content, generatedAt: cached.createdAt, cached: true };
  }

  const account = await requireActiveAccount(userId);
  const calendarEvents = await getCalendar(account).listEvents({ timeMin: start, timeMax: end });
  const pendingItems = await prisma.actionItem.findMany({
    where: { status: 'SUGGESTED', startAt: { gte: start, lt: end }, email: { mailAccount: { userId } } },
    orderBy: { startAt: 'asc' },
    take: 50,
  });

  const sections = buildScheduleSections({ calendarEvents, pendingItems, tz });

  // ไม่มีรายการ = ไม่เรียก AI เลย (ไม่มีอะไรให้สรุป และกันโมเดลแต่งกิจกรรมขึ้นเอง)
  let overview = '';
  if (sections.count > 0) {
    const ai = await getAi(userId);
    const response = await ai.complete({
      user: buildScheduleOverviewPrompt({ scheduleText: sections.text, dateContext: `วันนี้คือ ${formatThaiDate(now(), tz)}` }),
      temperature: 0.2,
    });
    overview = cleanOverview(response.text);
  }

  const content = [`# ${TITLES[type]}`, ...(overview ? ['', overview] : []), '', sections.text].join('\n');
  const saved = await prisma.summary.upsert({
    where: key,
    update: { content, createdAt: now() },
    create: { userId, type, periodStart: start, periodEnd: end, content },
  });
  return { content: saved.content, generatedAt: saved.createdAt, cached: false };
};

module.exports = { getOrGenerateSummary, getPeriod, buildScheduleSections };
