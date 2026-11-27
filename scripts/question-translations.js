#!/usr/bin/env node
/**
 * Русский перевод банка вопросов собеседований.
 *
 *   node scripts/question-translations.js export <out.json> [--missing] [--codes=H1,J2] [--inactive]
 *   node scripts/question-translations.js import <in.json>  [--dry-run] [--force]
 *
 * export — узбекский оригинал (код, sourceHash, тексты) для перевода.
 *          --inactive — и неактивные вопросы (банк Node до включения, «ещё не пройдено»).
 * import — файл [{ code, sourceHash, promptRu, promptShortRu, expectedAnswerRu, options:[{key,textRu}] }]
 *          (или { translations: [...] }). Идемпотентен; uz не трогает; перевод,
 *          сделанный с устаревшего uz-текста (sourceHash не совпал), не пишется.
 *          --force — перезаписать и переводы, которые правил админ.
 *
 * Банк КОНФИДЕНЦИАЛЕН, репозиторий публичный: файлы только ВНЕ репо, текст
 * вопросов в консоль не печатается. MONGO_URI берётся из .env.
 */
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { exportSource, applyTranslations, translationStats } = require("../src/services/questionTranslations");

function usage() {
  console.error("Usage: node scripts/question-translations.js export <out.json> [--missing] [--codes=A,B]\n" +
    "       node scripts/question-translations.js import <in.json> [--dry-run] [--force]");
  process.exit(2);
}

async function main() {
  const [cmd, file, ...flags] = process.argv.slice(2);
  if (!["export", "import"].includes(cmd) || !file) usage();
  const repoRoot = path.resolve(__dirname, "..");
  if (path.resolve(file).startsWith(repoRoot + path.sep)) {
    console.error("Файл лежит внутри репозитория (публичного). Укажите путь снаружи.");
    process.exit(2);
  }
  const codesFlag = flags.find((f) => f.startsWith("--codes="));
  const codes = codesFlag ? codesFlag.slice(8).split(",").filter(Boolean) : undefined;

  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  try {
    if (cmd === "export") {
      const items = await exportSource({ codes, onlyMissing: flags.includes("--missing"), includeInactive: flags.includes("--inactive") });
      fs.writeFileSync(file, JSON.stringify(items, null, 2), { mode: 0o600 });
      console.log(`Выгружено вопросов: ${items.length} → ${file}`);
    } else {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      const entries = Array.isArray(raw) ? raw : raw.translations;
      if (!Array.isArray(entries)) throw new Error("Ожидается массив переводов или { translations: [...] }");
      const dryRun = flags.includes("--dry-run");
      const r = await applyTranslations(entries, { dryRun, force: flags.includes("--force") });
      const p = dryRun ? "[dry-run] " : "";
      console.log(`${p}Переводы: записано ${r.updated}, без изменений ${r.unchanged}`);
      if (r.stale.length) console.log(`  ⚠ uz изменился после перевода: ${r.stale.join(", ")}`);
      if (r.notFound.length) console.log(`  ✖ нет в банке: ${r.notFound.join(", ")}`);
      if (r.invalid.length) console.log(`  ✖ без promptRu/sourceHash: ${r.invalid.join(", ")}`);
      if (r.skippedEdited.length) console.log(`  ⚠ правил админ (--force): ${r.skippedEdited.join(", ")}`);
    }
    console.log(`Покрытие переводом: ${JSON.stringify(await translationStats())}`);
    if (flags.includes("--inactive")) console.log(`  с неактивными: ${JSON.stringify(await translationStats({}))}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
