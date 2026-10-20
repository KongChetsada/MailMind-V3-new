// คลัง template ตอบกลับของผู้ใช้: สร้างชุดตัวอย่าง คำนวณ embedding และค้นหาอันที่เข้ากับอีเมล
const { getDeps } = require('./deps');
const { DEFAULT_TEMPLATES } = require('../core/templates/defaults');
const { filterCandidates, rankTemplates, templateText } = require('../core/templates/retrieval');

/** สร้างชุดตัวอย่างให้ผู้ใช้ครั้งเดียว — ลบหมดแล้วไม่สร้างคืน */
const ensureDefaultTemplates = async (userId, deps = getDeps()) => {
  const { prisma, now } = deps;
  await prisma.userSetting.upsert({ where: { userId }, update: {}, create: { userId } });
  // จองด้วยการ update แบบมีเงื่อนไข: คำขอสองตัวพร้อมกันไม่สร้างซ้ำ
  const claim = await prisma.userSetting.updateMany({
    where: { userId, templatesSeededAt: null },
    data: { templatesSeededAt: now() },
  });
  if (claim.count === 0) return 0;
  await prisma.replyTemplate.createMany({ data: DEFAULT_TEMPLATES.map((t) => ({ userId, ...t })) });
  return DEFAULT_TEMPLATES.length;
};

/** คำนวณ embedding ให้ template ที่ยังไม่มีหรือคำนวณด้วยโมเดลอื่น คืนรายการที่อัปเดตแล้ว (ใช้ไม่ได้ = คืนรายการเดิม) */
const refreshEmbeddings = async (templates, deps = getDeps()) => {
  const model = deps.embeddingModel();
  if (!model) return templates;
  const stale = templates.filter((t) => !t.embedding?.length || t.embeddingModel !== model);
  if (!stale.length) return templates;
  const vectors = await deps.embed(stale.map(templateText));
  if (!vectors) return templates;
  const updated = new Map();
  await Promise.all(
    stale.map(async (t, i) => {
      const row = await deps.prisma.replyTemplate.update({ where: { id: t.id }, data: { embedding: vectors[i], embeddingModel: model } });
      updated.set(t.id, row);
    })
  );
  return templates.map((t) => updated.get(t.id) || t);
};

/**
 * template ที่เข้ากับอีเมลที่สุดสำหรับเจตนานี้
 * คืน { template, score, similarity, method, candidates } หรือ null
 */
const findTemplate = async ({ userId, category, intent, queryText }, deps = getDeps()) => {
  await ensureDefaultTemplates(userId, deps);
  const all = await deps.prisma.replyTemplate.findMany({ where: { userId, isActive: true }, orderBy: { createdAt: 'asc' } });
  const candidateIds = new Set(filterCandidates(all, { category, intent }).map((c) => c.template.id));
  if (!candidateIds.size) return null;

  let candidates = all.filter((t) => candidateIds.has(t.id));
  let queryVector = null;
  if (deps.embeddingModel()) {
    candidates = await refreshEmbeddings(candidates, deps);
    queryVector = (await deps.embed([queryText]))?.[0] || null;
  }
  return rankTemplates({ templates: candidates, category, intent, queryText, queryVector });
};

module.exports = { ensureDefaultTemplates, refreshEmbeddings, findTemplate };
