// เลือก template ตอบกลับที่เข้ากับอีเมลที่สุด (ส่วน Retrieval ของ RAG) — ตรรกะล้วน ไม่เรียกบริการภายนอก
// 1) กรองด้วยประเภทอีเมลและเจตนา (null ใน template = ใช้ได้ทุกค่า)
// 2) จัดอันดับด้วยความหมาย: cosine ของ embedding ถ้ามีครบ ไม่งั้นใช้คำภาษาไทยที่ตรงกัน
// 3) ไม่ฝืนใช้ template ที่ไม่เกี่ยว: ต้องตรงทั้งประเภทและเจตนา หรือมีความคล้ายถึงเกณฑ์

// โบนัสเมื่อ template ระบุตรงกรณี (ดีกว่า template ที่ใช้ได้ทุกกรณี)
const EXACT_BONUS = 0.1;
// เกณฑ์ความคล้ายขั้นต่ำสำหรับ template ที่ไม่ได้ตรงทั้งประเภทและเจตนา
const MIN_COSINE = 0.45;
const MIN_KEYWORD = 0.15;

const STOPWORDS = new Set(
  'ครับ ค่ะ คะ นะ และ ที่ ของ ใน เป็น การ จะ ได้ ให้ มี ไม่ กับ ว่า นี้ ความ แล้ว ด้วย หรือ ก็ ไป มา อยู่ คือ ซึ่ง จาก ถึง โดย เรื่อง ท่าน ผม ดิฉัน the a an to of and for in on is are be'.split(' ')
);

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;

/** ตัดคำ (ภาษาไทยไม่มีช่องว่างระหว่างคำ) แล้วตัดคำทั่วไปและตัวยึด [..] ทิ้ง */
const tokenize = (text) => {
  const clean = String(text || '').toLowerCase().replace(/\[[^\]]*\]/g, ' ');
  const words = segmenter
    ? [...segmenter.segment(clean)].filter((s) => s.isWordLike).map((s) => s.segment)
    : clean.split(/[^\p{L}\p{N}]+/u);
  return words.map((w) => w.trim()).filter((w) => w.length > 1 && !STOPWORDS.has(w));
};

const cosine = (a, b) => {
  if (!a?.length || a.length !== b?.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

/** ข้อความของ template ที่ใช้ค้นหา */
const templateText = (t) => [t.name, t.whenToUse, t.body].filter(Boolean).join('\n');

/** template ที่ใช้กับกรณีนี้ได้ พร้อมบอกว่าตรงแบบระบุหรือแบบใช้ได้ทุกค่า */
const filterCandidates = (templates, { category, intent }) =>
  (templates || [])
    .filter((t) => t.isActive !== false)
    .filter((t) => (t.category == null || t.category === category) && (t.intent == null || t.intent === intent))
    .map((t) => ({ template: t, exactCategory: t.category === category, exactIntent: t.intent === intent }));

// ชื่อและ "ใช้เมื่อ" บอกกรณีตรงกว่าเนื้อหา จึงมีน้ำหนักมากกว่า
const HEAD_WEIGHT = 0.7;

/**
 * คะแนนคำที่ตรงกัน (0–1): สัดส่วนน้ำหนัก idf ของคำในคำค้นที่พบใน template
 * คิดแยกส่วนหัว (ชื่อ + ใช้เมื่อ) กับเนื้อหา แล้วถ่วงน้ำหนัก — คำที่พบในทุก template มีน้ำหนักน้อย
 */
const keywordScores = (queryText, templates) => {
  const query = [...new Set(tokenize(queryText))];
  const heads = templates.map((t) => new Set(tokenize([t.name, t.whenToUse].filter(Boolean).join('\n'))));
  const bodies = templates.map((t) => new Set(tokenize(t.body)));
  const idf = (w) => Math.log(1 + templates.length / (1 + templates.filter((_t, i) => heads[i].has(w) || bodies[i].has(w)).length));
  const total = query.reduce((sum, w) => sum + idf(w), 0);
  const coverage = (doc) => (total ? query.filter((w) => doc.has(w)).reduce((sum, w) => sum + idf(w), 0) / total : 0);
  return templates.map((_t, i) => HEAD_WEIGHT * coverage(heads[i]) + (1 - HEAD_WEIGHT) * coverage(bodies[i]));
};

/**
 * @param templates    template ของผู้ใช้ (มี embedding ได้)
 * @param queryText    ข้อความแทนอีเมล (หัวเรื่อง + สรุป)
 * @param queryVector  embedding ของ queryText (null = ไม่มี)
 * คืน { template, score, method: 'embedding' | 'keyword', candidates } หรือ null เมื่อไม่มีอันที่เข้ากรณี
 */
const rankTemplates = ({ templates, category, intent, queryText, queryVector }) => {
  const candidates = filterCandidates(templates, { category, intent });
  if (!candidates.length) return null;

  const useEmbedding =
    Array.isArray(queryVector) && queryVector.length > 0 && candidates.every((c) => c.template.embedding?.length === queryVector.length);
  const similarity = useEmbedding
    ? candidates.map((c) => cosine(queryVector, c.template.embedding))
    : keywordScores(queryText, candidates.map((c) => c.template));
  const minimum = useEmbedding ? MIN_COSINE : MIN_KEYWORD;

  const scored = candidates
    .map((c, i) => ({
      ...c,
      similarity: similarity[i],
      score: similarity[i] + (c.exactCategory ? EXACT_BONUS : 0) + (c.exactIntent ? EXACT_BONUS : 0),
    }))
    .filter((c) => (c.exactCategory && c.exactIntent) || c.similarity >= minimum)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  const best = scored[0];
  return {
    template: best.template,
    score: Number(best.score.toFixed(4)),
    similarity: Number(best.similarity.toFixed(4)),
    method: useEmbedding ? 'embedding' : 'keyword',
    candidates: scored.length,
  };
};

module.exports = { tokenize, cosine, templateText, filterCandidates, keywordScores, rankTemplates, MIN_COSINE, MIN_KEYWORD };
