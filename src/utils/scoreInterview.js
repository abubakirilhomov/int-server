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
  const roadmap = [];
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

    if (it.result !== "pass") roadmap.push(t.labelRu || t.label);

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
    snapItems,
  };
}

module.exports = { computeScore };
