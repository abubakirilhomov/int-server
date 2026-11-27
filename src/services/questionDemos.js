// Живые сцены вопросов: запись из файла (вне репозитория — содержимое сцен
// часть банка) и выгрузка. Идемпотентно: одинаковый файл второй раз — 0 изменений.
const BankQuestion = require("../models/bankQuestionModel");
const { normalizeDemo, normalizeDemoFix } = require("../utils/questionBank/demo");

const canon = (v) => JSON.stringify(v ?? null);

function plain(doc) {
  if (!doc) return null;
  return typeof doc.toObject === "function" ? doc.toObject() : doc;
}

// entries: [{ code, demo, fix }]; demo: null → сцену убрать.
async function applyDemos(entries, { dryRun = false } = {}) {
  const report = { updated: 0, unchanged: 0, removed: 0, notFound: [], invalid: [] };
  for (const e of entries || []) {
    const code = String(e?.code || "");
    let demo;
    let fix;
    try {
      demo = normalizeDemo(e?.demo);
      fix = demo ? normalizeDemoFix(e?.fix) : null;
    } catch (err) {
      report.invalid.push(`${code || "?"}: ${err.message}`);
      continue;
    }
    if (!code) { report.invalid.push("?: нет code"); continue; }
    const doc = await BankQuestion.findOne({ code }).select("+demoFix").lean();
    if (!doc) { report.notFound.push(code); continue; }

    // Сравниваем нормализованные формы: дефолты схемы не дают ложных «изменений».
    let curDemo = null;
    let curFix = null;
    try {
      curDemo = normalizeDemo(plain(doc.demo));
      curFix = curDemo ? normalizeDemoFix(plain(doc.demoFix)) : null;
    } catch { /* битая сцена в БД → перезапишем */ }
    if (canon(curDemo) === canon(demo) && canon(curFix) === canon(fix)) {
      report.unchanged += 1;
      continue;
    }
    if (demo) report.updated += 1; else report.removed += 1;
    if (dryRun) continue;
    const update = demo
      ? { $set: { demo, ...(fix ? { demoFix: fix } : {}) }, ...(fix ? {} : { $unset: { demoFix: 1 } }) }
      : { $unset: { demo: 1, demoFix: 1 } };
    await BankQuestion.updateOne({ _id: doc._id }, update, { runValidators: true });
  }
  return report;
}

async function exportDemos({ codes } = {}) {
  const filter = { "demo.html": { $exists: true, $ne: "" } };
  if (codes?.length) filter.code = { $in: codes };
  const docs = await BankQuestion.find(filter).select("code demo +demoFix").sort({ topic: 1, order: 1 }).lean();
  return docs.map((d) => ({ code: d.code, demo: normalizeDemo(d.demo), fix: normalizeDemoFix(d.demoFix) }));
}

module.exports = { applyDemos, exportDemos };
