/**
 * Backfill: Lesson.date из Lesson.time
 *
 * Проблема: у уроков поле `date` исторически ставилось из `default: Date.now`
 * (момент СОЗДАНИЯ записи), а не из выбранного интерном времени урока `time`
 * ("YYYY-MM-DDTHH:mm", ташкентское стенное время). Из-за этого уроки у стыка
 * месяца / с бэкдейтом попадали не в тот месяц.
 *
 * Скрипт пересчитывает `date = tashkentWallClockToDate(time)`.
 *
 * Идемпотентно (повторный прогон после --apply → 0 изменений).
 *
 * Usage:
 *   cd int-server
 *   node scripts/backfill-lesson-date-from-time.js           # dry-run (по умолчанию, ничего не пишет)
 *   node scripts/backfill-lesson-date-from-time.js --apply    # применить
 */

require("dotenv").config();
const mongoose = require("mongoose");
const {
  tashkentWallClockToDate,
  startOfTashkentDay,
  startOfTashkentMonth,
} = require("../src/utils/tashkentTime");

const APPLY = process.argv.includes("--apply");

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("❌ MONGO_URI не задан в .env");
  process.exit(1);
}

const sameMs = (a, b) => a && b && a.getTime() === b.getTime();

async function run() {
  console.log(`🔌 Подключение к MongoDB...  (режим: ${APPLY ? "APPLY ✍️" : "DRY-RUN 👀"})`);
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Подключено\n");

  const lessons = mongoose.connection.db.collection("lessons");
  const cursor = lessons.find(
    { time: { $exists: true, $ne: null } },
    { projection: { time: 1, date: 1 } }
  );

  let total = 0;
  let skippedBadTime = 0;
  let unchanged = 0;
  let willShift = 0;
  let dayChanged = 0;
  let monthChanged = 0;
  const samples = [];
  const ops = [];

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    total += 1;

    const derived = tashkentWallClockToDate(doc.time);
    if (!derived) {
      skippedBadTime += 1;
      continue;
    }

    const stored = doc.date ? new Date(doc.date) : null;
    if (sameMs(stored, derived)) {
      unchanged += 1;
      continue;
    }

    willShift += 1;
    const dayShift =
      !stored || !sameMs(startOfTashkentDay(stored), startOfTashkentDay(derived));
    const monthShift =
      !stored ||
      !sameMs(startOfTashkentMonth(stored), startOfTashkentMonth(derived));
    if (dayShift) dayChanged += 1;
    if (monthShift) monthChanged += 1;

    if (samples.length < 12 && (monthShift || dayShift)) {
      samples.push({
        time: doc.time,
        storedDate: stored ? stored.toISOString() : "(нет)",
        newDate: derived.toISOString(),
        monthShift,
      });
    }

    if (APPLY) {
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { date: derived } },
        },
      });
      if (ops.length >= 500) {
        await lessons.bulkWrite(ops, { ordered: false });
        ops.length = 0;
      }
    }
  }

  if (APPLY && ops.length) {
    await lessons.bulkWrite(ops, { ordered: false });
  }

  console.log("📊 Сводка:");
  console.log(`   Всего уроков с time:        ${total}`);
  console.log(`   Пропущено (битый time):     ${skippedBadTime}`);
  console.log(`   Уже корректны (date=time):  ${unchanged}`);
  console.log(`   Сдвинутся:                  ${willShift}`);
  console.log(`      ├─ меняют ташкентский день:   ${dayChanged}`);
  console.log(`      └─ меняют ташкентский месяц:  ${monthChanged}  ← влияет на «уроки за месяц»`);

  if (samples.length) {
    console.log("\n🔎 Примеры (time → было → станет):");
    for (const s of samples) {
      console.log(
        `   ${s.time}  |  ${s.storedDate}  →  ${s.newDate}${s.monthShift ? "   [СМЕНА МЕСЯЦА]" : ""}`
      );
    }
  }

  if (!APPLY) {
    console.log(
      `\n👀 DRY-RUN — ничего не записано. Для применения: node scripts/backfill-lesson-date-from-time.js --apply`
    );
  } else {
    console.log(`\n✅ Применено. Обновлено уроков: ${willShift}`);
  }

  await mongoose.disconnect();
  console.log("🔌 Отключено. Готово.");
}

run().catch((err) => {
  console.error("❌ Backfill упал:", err);
  process.exit(1);
});
