/**
 * Bucket 1: архивировать интернов, которые так и не начали —
 * 0 уроков И записаны >= 30 дней назад. Архив обратим (unarchive), данные не теряются.
 *
 * Safety:
 *   - Dry-run по умолчанию; --apply чтобы записать.
 *   - Бэкап полных документов в JSON ПЕРЕД изменением.
 *   - Пропускает уже архивных, недавних (joined < 30 дн) и тест-аккаунты.
 *   - Использует реальный internService.archiveIntern (поведение как в приложении).
 *
 * Usage:
 *   cd int-server
 *   node scripts/archive-inactive-zero-lessons.js          # dry-run
 *   node scripts/archive-inactive-zero-lessons.js --apply  # бэкап + архив
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Intern = require("../src/models/internModel");
const Lesson = require("../src/models/lessonModel");
const internService = require("../src/services/internService");

const NOW = new Date("2026-06-11T12:00:00+05:00");
const CUTOFF = new Date(NOW.getTime() - 30 * 86400000); // записан не позже 30 дней назад
const APPLY = process.argv.includes("--apply");
const TEST_USERNAMES = ["test", "testoybek"]; // обрабатываются отдельно (НЕ архивируем здесь)

const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : "—");
const days = (x) => (x ? Math.floor((NOW - new Date(x)) / 86400000) : "?");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const withLessons = new Set((await Lesson.distinct("intern")).map(String));

  const all = await Intern.find({}).lean();
  const candidates = all.filter((x) => {
    if (withLessons.has(String(x._id))) return false;          // есть уроки
    if (x.status === "archived") return false;                  // уже в архиве
    if (!x.dateJoined || new Date(x.dateJoined) > CUTOFF) return false; // недавний
    if (TEST_USERNAMES.includes(String(x.username || "").toLowerCase())) return false; // тест
    return true;
  }).sort((a, b) => new Date(a.dateJoined) - new Date(b.dateJoined));

  console.log(`Cutoff записи: <= ${d(CUTOFF)} | кандидатов: ${candidates.length}\n`);
  candidates.forEach((x, i) =>
    console.log(`  ${String(i + 1).padStart(2)}. ${(x.name + " " + x.lastName).padEnd(26)} @${String(x.username||"—").padEnd(20)} ${String(x.status||"NULL").padEnd(9)} join:${d(x.dateJoined)} (${days(x.dateJoined)}дн)`)
  );

  if (!APPLY) {
    console.log("\nDRY-RUN. Изменений нет. Запусти с --apply для бэкапа и архивации.");
    await mongoose.disconnect();
    return;
  }
  if (candidates.length === 0) { console.log("\nНечего архивировать."); await mongoose.disconnect(); return; }

  const backupFile = path.join(__dirname, `backup-archived-inactive-${d(NOW)}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(candidates, null, 2));
  console.log(`\nБэкап ${candidates.length} документов: ${backupFile}`);

  let ok = 0;
  for (const x of candidates) {
    try {
      await internService.archiveIntern(x._id, {
        reason: "other",
        note: `Batch-архив ${d(NOW)}: 0 уроков, не онбордился (${days(x.dateJoined)}дн с записи)`,
        adminId: null,
      });
      ok += 1;
    } catch (e) {
      console.log(`  ! ${x.name} ${x.lastName}: ${e.message}`);
    }
  }
  console.log(`\nАрхивировано: ${ok}/${candidates.length}. Обратимо через unarchive.`);
  const activeLeft = await Intern.countDocuments({ status: { $ne: "archived" } });
  console.log(`Не-архивных интернов осталось: ${activeLeft}`);
  await mongoose.disconnect();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
