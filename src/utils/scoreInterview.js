// Чистый подсчёт результата собеседования (без БД) — тестируется юнит-тестом.
// items: [{ topicId, result: "pass"|"partial"|"fail", note? }]
// topicsById: Map или объект topicId → { _id, label, labelRu, category, weight }
function computeScore(items, topicsById, opts = {}) {
  const partialCredit = Number(opts.partialCredit ?? 0.5);
  const threshold = Number(opts.threshold ?? 80);
  const get = (id) =>
    topicsById && typeof topicsById.get === "function"
      ? topicsById.get(String(id))
      : topicsById?.[String(id)];

  let earned = 0;
  let total = 0;
  const roadmap = []; // RU (labelRu) — used by RU letter and stored on Interview
  const roadmapUz = []; // UZ (label) — used by UZ letter
  const snapItems = [];

  for (const it of items || []) {
    const t = get(it.topicId);
    if (!t) continue;
    const w = Number(t.weight) || 1;
    total += w;

    let e = 0;
    if (it.result === "pass") e = w;
    else if (it.result === "partial") e = w * partialCredit;
    earned += e;

    if (it.result !== "pass") {
      roadmap.push(t.labelRu || t.label);
      roadmapUz.push(t.label || t.labelRu);
    }

    snapItems.push({
      topic: t._id,
      label: t.label,
      labelRu: t.labelRu || "",
      category: t.category,
      weight: w,
      result: it.result,
      earned: e,
      note: it.note || "",
    });
  }

  const round1 = (n) => Math.round(n * 10) / 10;
  const percentage = total > 0 ? round1((earned / total) * 100) : 0;

  return {
    earned: Math.round(earned * 100) / 100,
    total,
    percentage,
    passed: percentage >= threshold,
    roadmap,
    roadmapUz,
    snapItems,
  };
}

// Живой режим: оценка по вопросам банка (снимки InterviewSession.questions).
// items: [{ code, promptShort, topic, level, state, result: pass|partial|fail|null, note }]
// opts: { levelWeights, partialCredit, threshold }. Вес по уровню oson 1 /
// o'rta 2 / qiyin 3 (config/candidateInterviews).
//
// Решение Абубакира 27.11: % для порога 80% считается от максимума всех
// ОТКРЫТЫХ кандидату вопросов (state open/closed). Открыт, но не оценён = 0
// (`unrated`); неоткрытые (hidden) не считаются (`notOpened`). Вопрос, который
// интервьюер оценил, не открывая (обсудили устно), тоже входит — оценку не
// теряем. Элемент без state считается открытым.
// Roadmap — темы не зачтённых вопросов (без текста: банк конфиденциален,
// а roadmap уходит кандидату в письме).
const { TOPIC_LABELS } = require("../config/questionBankTopics");

function computeQuestionScore(items, opts = {}) {
  const weights = opts.levelWeights || { oson: 1, orta: 2, qiyin: 3 };
  const partialCredit = Number(opts.partialCredit ?? 0.5);
  const threshold = Number(opts.threshold ?? 80);

  let earned = 0;
  let total = 0;
  let unrated = 0;
  let notOpened = 0;
  let rated = 0;
  const weakTopics = [];
  const snapItems = [];

  for (const it of items || []) {
    const opened = it.state ? it.state !== "hidden" : true;
    if (!opened && !it.result) {
      notOpened += 1;
      continue;
    }
    const w = Number(weights[it.level]) || 1;
    total += w;
    let e = 0;
    if (it.result === "pass") e = w;
    else if (it.result === "partial") e = w * partialCredit;
    if (it.result) rated += 1;
    else unrated += 1;
    earned += e;
    if (it.result !== "pass" && it.topic && !weakTopics.includes(it.topic)) {
      weakTopics.push(it.topic);
    }
    snapItems.push({
      questionCode: it.code,
      label: it.promptShort || it.code,
      category: it.topic,
      weight: w,
      result: it.result || undefined, // открыт без оценки → 0 баллов
      earned: e,
      note: it.note || "",
    });
  }

  const percentage = total > 0 ? Math.round((earned / total) * 1000) / 10 : 0;
  return {
    earned: Math.round(earned * 100) / 100,
    total,
    percentage,
    passed: total > 0 && percentage >= threshold,
    rated,
    unrated,
    notOpened,
    roadmap: weakTopics.map((t) => TOPIC_LABELS[t]?.ru || t),
    roadmapUz: weakTopics.map((t) => TOPIC_LABELS[t]?.uz || t),
    snapItems,
  };
}

module.exports = { computeScore, computeQuestionScore, TOPIC_LABELS };
