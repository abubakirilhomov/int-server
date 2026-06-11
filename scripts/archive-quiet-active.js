/**
 * Bucket 2: архивировать активных интернов, у которых последний урок был >= 30 дней назад.
 * Архив обратим (unarchive), данные сохраняются. Бэкап перед изменением.
 *
 * Usage:
 *   node scripts/archive-quiet-active.js          # dry-run
 *   node scripts/archive-quiet-active.js --apply  # бэкап + архив
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Intern = require("../src/models/internModel");
const Lesson = require("../src/models/lessonModel");
const internService = require("../src/services/internService");

const NOW = new Date("2026-06-11T12:00:00+05:00");
const CUT = new Date(NOW.getTime() - 30 * 86400000);
const APPLY = process.argv.includes("--apply");
const TEST = ["test", "testoybek"];
const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : "—");
const days = (x) => Math.floor((NOW - new Date(x)) / 86400000);

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const agg = await Lesson.aggregate([{ $group: { _id: "$intern", last: { $max: "$date" }, count: { $sum: 1 } } }]);
  const byId = new Map(agg.map((a) => [String(a._id), a]));

  const interns = await Intern.find({ status: { $ne: "archived" } }).lean();
  const cands = interns.map((x) => {
    const a = byId.get(String(x._id));
    if (!a || new Date(a.last) > CUT) return null;
    if (TEST.includes(String(x.username || "").toLowerCase())) return null;
    return { ...x, _last: a.last, _count: a.count };
  }).filter(Boolean).sort((p, q) => new Date(p._last) - new Date(q._last));

  console.log(`Последний урок <= ${d(CUT)} (30+ дней): ${cands.length}\n`);
  cands.forEach((x, i) => console.log(`  ${String(i+1).padStart(2)}. ${(x.name+" "+x.lastName).padEnd(26)} @${String(x.username||"—").padEnd(18)} послед.урок:${d(x._last)} (${days(x._last)}дн) уроков:${x._count}`));

  if (!APPLY) { console.log("\nDRY-RUN. --apply для бэкапа и архивации."); await mongoose.disconnect(); return; }
  if (!cands.length) { console.log("\nНечего архивировать."); await mongoose.disconnect(); return; }

  const backupFile = path.join(__dirname, `backup-archived-quiet-${d(NOW)}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(cands, null, 2));
  console.log(`\nБэкап ${cands.length} документов: ${backupFile}`);

  let ok = 0;
  for (const x of cands) {
    try {
      await internService.archiveIntern(x._id, {
        reason: "other",
        note: `Batch-архив ${d(NOW)}: неактивен ${days(x._last)}дн (последний урок ${d(x._last)})`,
        adminId: null,
      });
      ok += 1;
    } catch (e) { console.log(`  ! ${x.name} ${x.lastName}: ${e.message}`); }
  }
  console.log(`\nАрхивировано: ${ok}/${cands.length}. Обратимо через unarchive.`);
  const activeLeft = await Intern.countDocuments({ status: { $ne: "archived" } });
  console.log(`Не-архивных интернов осталось: ${activeLeft}`);
  await mongoose.disconnect();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
