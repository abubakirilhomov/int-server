#!/usr/bin/env node
/**
 * Автотесты мини-заданий банка (формат — src/utils/questionBank/tests.js).
 *
 *   node scripts/question-tests.js import <in.json> [--dry-run]
 *   node scripts/question-tests.js export <out.json> [--codes=J13,J14]
 *
 * Файл: [{ code: "J14", tests: [{ name, nameRu, code }] }]  (или { tests: [...] }).
 * tests: [] — убрать тесты. Импорт идемпотентен, код тестов не исполняется (только проверка синтаксиса).
 *
 * Тесты — часть банка (КОНФИДЕНЦИАЛЬНО), репозиторий публичный: файлы только ВНЕ репо,
 * содержимое в консоль не печатается. MONGO_URI берётся из .env.
 */
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { applyTests, exportTests } = require("../src/services/questionTests");

function usage() {
  console.error("Usage: node scripts/question-tests.js import <in.json> [--dry-run]\n" +
    "       node scripts/question-tests.js export <out.json> [--codes=A,B]");
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
      const items = await exportTests({ codes });
      fs.writeFileSync(file, JSON.stringify(items, null, 2), { mode: 0o600 });
      console.log(`Выгружено вопросов с тестами: ${items.length} → ${file}`);
    } else {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      const entries = Array.isArray(raw) ? raw : raw.tests;
      if (!Array.isArray(entries)) throw new Error("Ожидается массив или { tests: [...] }");
      const dryRun = flags.includes("--dry-run");
      const r = await applyTests(entries, { dryRun });
      const p = dryRun ? "[dry-run] " : "";
      console.log(`${p}Тесты: записано ${r.updated}, убрано ${r.removed}, без изменений ${r.unchanged}`);
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
