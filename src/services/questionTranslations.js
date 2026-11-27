// Русский перевод банка: выгрузка узбекского оригинала и запись переводов.
// Тексты банка конфиденциальны — файлы живут вне репозитория (см. скрипт
// scripts/question-translations.js). Запись идемпотентна, оригинал (uz) не трогает.
const BankQuestion = require("../models/bankQuestionModel");
const { uzTextHash, translationStatus } = require("../utils/questionBank/i18n");

const IMPORT_BY = "translation-import";
const SELECT = "+expectedAnswer +expectedAnswerRu +options.correct";

// Узбекский оригинал для перевода: код, хеш оригинала, тексты.
// includeInactive — и неактивные (банк Node до включения, «ещё не пройдено»).
async function exportSource({ codes, onlyMissing = false, includeInactive = false } = {}) {
  const filter = includeInactive ? {} : { isActive: true };
  if (codes?.length) filter.code = { $in: codes };
  const docs = await BankQuestion.find(filter).select(SELECT).sort({ topic: 1, order: 1 }).lean();
  return docs
    .filter((d) => !onlyMissing || translationStatus(d) !== "ok")
    .map((d) => ({
      code: d.code,
      sourceHash: uzTextHash(d),
      prompt: d.prompt,
      promptShort: d.promptShort,
      expectedAnswer: d.expectedAnswer,
      ...(d.options?.length ? { options: d.options.map((o) => ({ key: o.key, text: o.text })) } : {}),
    }));
}

const same = (a, b) => String(a || "") === String(b || "");

// entries: [{ code, sourceHash, promptRu, promptShortRu?, expectedAnswerRu?, options?: [{key, textRu}] }]
// sourceHash обязателен: перевод сделан с конкретного uz-текста; если uz с тех
// пор изменился, перевод не пишется (stale) — его надо обновить.
async function applyTranslations(entries, { dryRun = false, force = false, by = IMPORT_BY } = {}) {
  const report = { updated: 0, unchanged: 0, stale: [], notFound: [], invalid: [], skippedEdited: [] };
  for (const e of entries || []) {
    const code = String(e?.code || "");
    if (!code || !e.promptRu || !String(e.promptRu).trim() || !e.sourceHash) {
      report.invalid.push(code || "?");
      continue;
    }
    const doc = await BankQuestion.findOne({ code }).select(SELECT).lean();
    if (!doc) { report.notFound.push(code); continue; }
    const hash = uzTextHash(doc);
    if (e.sourceHash !== hash) { report.stale.push(code); continue; }
    if (!force && doc.ruUpdatedBy && doc.ruUpdatedBy !== IMPORT_BY && doc.ruUpdatedBy !== by) {
      report.skippedEdited.push(code);
      continue;
    }

    const optRu = new Map((e.options || []).map((o) => [String(o.key), String(o.textRu || "")]));
    const options = doc.options?.length
      ? doc.options.map((o) => ({ ...o, textRu: optRu.has(o.key) ? optRu.get(o.key) : o.textRu || "" }))
      : undefined;
    const set = {
      promptRu: String(e.promptRu),
      promptShortRu: String(e.promptShortRu || ""),
      expectedAnswerRu: String(e.expectedAnswerRu || ""),
    };
    const optionsSame = !options || options.every((o, i) => same(o.textRu, doc.options[i].textRu));
    const unchanged = doc.ruSourceHash === hash && optionsSame &&
      Object.entries(set).every(([k, v]) => same(doc[k], v));
    if (unchanged) { report.unchanged += 1; continue; }

    report.updated += 1;
    if (dryRun) continue;
    await BankQuestion.updateOne(
      { _id: doc._id },
      { $set: { ...set, ...(options ? { options } : {}), ruSourceHash: hash, ruUpdatedAt: new Date(), ruUpdatedBy: by } }
    );
  }
  return report;
}

// Сводка покрытия переводом (без текстов).
async function translationStats(filter = { isActive: true }) {
  const docs = await BankQuestion.find(filter).select(SELECT).lean();
  const out = { ok: 0, stale: 0, missing: 0 };
  docs.forEach((d) => { out[translationStatus(d)] += 1; });
  return out;
}

module.exports = { exportSource, applyTranslations, translationStats, IMPORT_BY };
