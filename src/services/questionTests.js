// Автотесты мини-заданий: запись из файла (вне репозитория — тесты часть банка) и выгрузка.
// Идемпотентно: одинаковый файл второй раз — 0 изменений. Правки админа в редакторе банка
// (updatedBy) не отличаются от скрипта: сравнение идёт по содержимому тестов.
const BankQuestion = require("../models/bankQuestionModel");
const { normalizeTests } = require("../utils/questionBank/tests");

const canon = (v) => JSON.stringify(v ?? []);

// entries: [{ code, tests: [{ name, nameRu, code }] }]; tests: [] / null — тесты убрать.
async function applyTests(entries, { dryRun = false } = {}) {
  const report = { updated: 0, unchanged: 0, removed: 0, notFound: [], invalid: [] };
  for (const e of entries || []) {
    const code = String(e?.code || "");
    if (!code) { report.invalid.push("?: нет code"); continue; }
    let tests;
    try {
      tests = normalizeTests(e?.tests);
    } catch (err) {
      report.invalid.push(`${code}: ${err.message}`);
      continue;
    }
    const doc = await BankQuestion.findOne({ code }).select("+tests").lean();
    if (!doc) { report.notFound.push(code); continue; }
    let cur = [];
    try { cur = normalizeTests(doc.tests); } catch { /* битое в БД → перезапишем */ }
    if (canon(cur) === canon(tests)) { report.unchanged += 1; continue; }
    if (tests.length) report.updated += 1; else report.removed += 1;
    if (dryRun) continue;
    await BankQuestion.updateOne({ _id: doc._id }, { $set: { tests } }, { runValidators: true });
  }
  return report;
}

async function exportTests({ codes } = {}) {
  const filter = { "tests.0": { $exists: true } };
  if (codes?.length) filter.code = { $in: codes };
  const docs = await BankQuestion.find(filter).select("code +tests").sort({ topic: 1, order: 1 }).lean();
  return docs.map((d) => ({ code: d.code, tests: normalizeTests(d.tests) }));
}

module.exports = { applyTests, exportTests };
