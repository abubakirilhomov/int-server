/**
 * Жёсткое удаление одного тест-аккаунта по username (точное совпадение).
 * Бэкапит документ интерна + его уроки ПЕРЕД удалением. Удаление каскадное и НЕОБРАТИМО.
 *
 * Защита: работает ТОЛЬКО с username из ALLOW (чтобы случайно не задеть @test и др.).
 *
 * Usage:
 *   node scripts/delete-test-account.js testoybek            # dry-run
 *   node scripts/delete-test-account.js testoybek --apply    # бэкап + удалить
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Intern = require("../src/models/internModel");
const Lesson = require("../src/models/lessonModel");

const ALLOW = ["testoybek"]; // разрешённые к удалению username (НЕ включает "test")
const USERNAME = process.argv.slice(2).find((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");

(async () => {
  if (!USERNAME) { console.error("Укажи username"); process.exit(1); }
  if (!ALLOW.includes(USERNAME.toLowerCase())) {
    console.error(`ОТКАЗ: '${USERNAME}' не в списке разрешённых (${ALLOW.join(", ")}).`);
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);

  const matches = await Intern.find({ username: USERNAME }).lean();
  if (matches.length !== 1) {
    console.error(`Ожидал ровно 1 совпадение по '${USERNAME}', нашёл ${matches.length}. Стоп.`);
    await mongoose.disconnect(); process.exit(1);
  }
  const intern = matches[0];
  const lessons = await Lesson.find({ intern: intern._id }).lean();
  console.log(`Кандидат: ${intern.name} ${intern.lastName} @${intern.username} (${intern._id})`);
  console.log(`Связанных уроков (будут удалены каскадно): ${lessons.length}`);

  if (!APPLY) { console.log("\nDRY-RUN. Запусти с --apply, чтобы удалить."); await mongoose.disconnect(); return; }

  const backupFile = path.join(__dirname, `backup-deleted-intern-${intern.username}.json`);
  fs.writeFileSync(backupFile, JSON.stringify({ intern, lessons }, null, 2));
  console.log(`Бэкап: ${backupFile}`);

  const lr = await Lesson.deleteMany({ intern: intern._id });
  const ir = await Intern.findByIdAndDelete(intern._id);
  console.log(`Удалено уроков: ${lr.deletedCount} | интерн удалён: ${ir ? "да" : "нет"}`);
  await mongoose.disconnect();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
