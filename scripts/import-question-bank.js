#!/usr/bin/env node
/**
 * Импорт банка вопросов собеседований из .docx в БД.
 * Формат определяется сам: JS-банк (H1, J22…) или Python-банк (M3-05…).
 * Node (только N-вопросы, без наборов): все вопросы неактивные (notCovered, «не включён»),
 * общее правило набора не трогается — включение и квота отдельно, после решения владельца.
 * Python: вопросы раздела 5 (ещё не пройденные модули) — неактивные (notCovered),
 * правило набора — в Setting questionBankRules.value.tracks["backend-python"].
 *
 *   node scripts/import-question-bank.js <путь/к/bank.docx> [--dry-run] [--force]
 *
 * Банк КОНФИДЕНЦИАЛЕН, а репозиторий публичный: файл лежит ВНЕ репо и
 * передаётся аргументом; скрипт ничего не пишет на диск и не печатает
 * текст вопросов — только сводку и расхождения.
 * Идемпотентен: повторный запуск без изменений файла = 0 записей.
 * --dry-run  — разобрать и сверить, в БД не писать.
 * --force    — писать, даже если валидатор нашёл ошибки (не рекомендуется).
 * MONGO_URI берётся из .env.
 */
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { readDocxBlocks } = require("../src/utils/questionBank/docxReader");
const { parseBank, validateBank } = require("../src/utils/questionBank/parseBank");
const { parsePythonBank, validatePythonBank, isPythonBank } = require("../src/utils/questionBank/parseBankPython");
const BankQuestion = require("../src/models/bankQuestionModel");
const { applyBank } = require("../src/services/questionBankImport");

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");
  if (!file) {
    console.error("Usage: node scripts/import-question-bank.js <bank.docx> [--dry-run] [--force]");
    process.exit(2);
  }
  const repoRoot = path.resolve(__dirname, "..");
  if (path.resolve(file).startsWith(repoRoot + path.sep)) {
    console.error("Файл банка лежит внутри репозитория (публичного). Перенесите его наружу.");
    process.exit(2);
  }

  const blocks = readDocxBlocks(fs.readFileSync(file));
  const python = isPythonBank(blocks);
  const parsed = python ? parsePythonBank(blocks) : parseBank(blocks);
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  // Python: HTML/CSS (модули 1–2) берутся из JS-банка — сверяем, что они там есть.
  const jsBank = python && parsed.rules.extras
    ? await BankQuestion.find({ code: { $in: parsed.rules.extras.codes } }).select("code topic tracks level isActive").lean()
    : null;
  const { errors, warnings } = python ? validatePythonBank(parsed, { jsBank }) : validateBank(parsed);
  const fmtLabel = python ? "Python-банк (модули M3…)" : parsed.format === "node" ? "Node-банк (N…) — импорт НЕАКТИВНЫМ, правило набора не трогается" : "JS-банк";
  console.log(`Формат: ${fmtLabel}`);
  const byTopic = {};
  parsed.questions.forEach((q) => { byTopic[q.topic] = (byTopic[q.topic] || 0) + 1; });
  const setsByTrack = {};
  parsed.sets.forEach((s) => { setsByTrack[s.track] = (setsByTrack[s.track] || 0) + 1; });
  const sizes = [...new Set(parsed.sets.map((s) => s.size))];

  console.log(`Вопросов: ${parsed.questions.length} ${JSON.stringify(byTopic)}`);
  console.log(`  amaliy: ${parsed.questions.filter((q) => q.isPractical).length}, mini: ${parsed.questions.filter((q) => q.isMiniTask).length}`);
  console.log(`Наборов: ${JSON.stringify(setsByTrack)}, размеры: ${sizes.join(",")}`);
  console.log(`Conflict-групп: ${parsed.rules.conflictGroups.length}`);
  if (python) {
    const off = parsed.questions.filter((q) => !q.isActive);
    console.log(`  активных: ${parsed.questions.length - off.length}, ещё не пройдено (неактивные): ${off.length}`);
    console.log(`  редакторы: ${JSON.stringify(parsed.questions.reduce((a, q) => { const k = q.editor || "текст"; a[k] = (a[k] || 0) + 1; return a; }, {}))}`);
    console.log(`  правило: квоты модулей ${Object.keys(parsed.rules.quotas).join("/")}, amaliy ${parsed.rules.minPractical} ${JSON.stringify(parsed.rules.minPracticalBySize)}, HTML/CSS ${parsed.rules.extras ? parsed.rules.extras.codes.join(",") : "—"}`);
  }
  warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  errors.forEach((e) => console.log(`  ✖ ${e}`));
  console.log(`Нарушений правила в готовых наборах: ${errors.length}`);
  if (errors.length && !force) {
    console.error(`Ошибок: ${errors.length} — импорт остановлен (--force, чтобы всё равно записать).`);
    await mongoose.disconnect();
    process.exit(1);
  }

  try {
    const report = await applyBank(parsed, { dryRun });
    const fmt = (r) => `создано ${r.created}, обновлено ${r.updated}, без изменений ${r.unchanged}, пропущено (правки админа) ${r.skippedEdited.length}`;
    console.log(`${dryRun ? "[dry-run] " : ""}Вопросы: ${fmt(report.questions)}`);
    console.log(`${dryRun ? "[dry-run] " : ""}Наборы:  ${fmt(report.sets)}`);
    if (report.rules) console.log(`${dryRun ? "[dry-run] " : ""}Правило трека: ${report.rules}`);
    [...report.questions.skippedEdited, ...report.sets.skippedEdited].forEach((k) => console.log(`  ⚠ пропущено: ${k}`));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
