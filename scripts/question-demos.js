#!/usr/bin/env node
/**
 * Живые сцены к вопросам банка (HTML/CSS + сценарий; формат — src/utils/questionBank/demo.js).
 *
 *   node scripts/question-demos.js import <in.json> [--dry-run]
 *   node scripts/question-demos.js export <out.json> [--codes=C13,C14]
 *
 * Файл: [{ code, demo: { html, css, steps, caption, captionRu, height, width, slider, layers3d, audience },
 *          fix: { html?, css?, steps?, caption?, captionRu? } }]  (или { demos: [...] }).
 * demo: null — убрать сцену. Импорт идемпотентен.
 *
 * Сцены — часть банка (КОНФИДЕНЦИАЛЬНО), репозиторий публичный: файлы только ВНЕ репо,
 * содержимое в консоль не печатается. MONGO_URI берётся из .env.
 */
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { applyDemos, exportDemos } = require("../src/services/questionDemos");

function usage() {
  console.error("Usage: node scripts/question-demos.js import <in.json> [--dry-run]\n" +
    "       node scripts/question-demos.js export <out.json> [--codes=A,B]");
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
      const items = await exportDemos({ codes });
      fs.writeFileSync(file, JSON.stringify(items, null, 2), { mode: 0o600 });
      console.log(`Выгружено сцен: ${items.length} → ${file}`);
    } else {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      const entries = Array.isArray(raw) ? raw : raw.demos;
      if (!Array.isArray(entries)) throw new Error("Ожидается массив сцен или { demos: [...] }");
      const dryRun = flags.includes("--dry-run");
      const r = await applyDemos(entries, { dryRun });
      const p = dryRun ? "[dry-run] " : "";
      console.log(`${p}Сцены: записано ${r.updated}, убрано ${r.removed}, без изменений ${r.unchanged}`);
      if (r.notFound.length) console.log(`  ✖ нет в банке: ${r.notFound.join(", ")}`);
      if (r.invalid.length) console.log(`  ✖ ошибки:\n    ${r.invalid.join("\n    ")}`);
      if (r.invalid.length || r.notFound.length) process.exitCode = 1;
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
