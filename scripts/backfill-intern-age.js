/**
 * Backfill: Intern.age из анкеты-заявки (Application).
 *
 * Возраст (`age`) исторически хранился только в Application и не переносился
 * на Intern. Этот скрипт заполняет Intern.age у тех интернов, для кого возраст
 * восстановим.
 *
 * Источники (по приоритету):
 *   1. Детерминированно: application.convertedToIntern === intern._id  (надёжно)
 *   2. --fuzzy: совпадение по нормализованному телефону / телеграму  (best-effort,
 *      по умолчанию ВЫКЛ, чтобы не рисковать мисматчем)
 *
 * Идемпотентно: трогает только интернов без age.
 *
 * Usage:
 *   cd int-server
 *   node scripts/backfill-intern-age.js               # dry-run (детерминированный)
 *   node scripts/backfill-intern-age.js --fuzzy        # dry-run + фаззи-матчинг
 *   node scripts/backfill-intern-age.js --apply        # применить (детерминированный)
 *   node scripts/backfill-intern-age.js --apply --fuzzy
 */

require("dotenv").config();
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const FUZZY = process.argv.includes("--fuzzy");

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("❌ MONGO_URI не задан в .env");
  process.exit(1);
}

const normPhone = (s) => (s || "").toString().replace(/[^0-9]/g, "").replace(/^998/, "");
const normTg = (s) => (s || "").toString().trim().replace(/^@/, "").toLowerCase();
const validAge = (a) => typeof a === "number" && a >= 11 && a <= 60;

async function run() {
  console.log(`🔌 Подключение...  режим: ${APPLY ? "APPLY ✍️" : "DRY-RUN 👀"}${FUZZY ? " +fuzzy" : ""}`);
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Подключено\n");

  const db = mongoose.connection.db;
  const interns = db.collection("interns");
  const applications = db.collection("applications");

  const apps = await applications
    .find({ age: { $ne: null } })
    .project({ age: 1, phone: 1, telegramUsername: 1, convertedToIntern: 1 })
    .toArray();

  // Индексы источников
  const byInternId = new Map(); // internId -> age (детерминированно)
  const byPhone = new Map();
  const byTg = new Map();
  for (const a of apps) {
    if (!validAge(a.age)) continue;
    if (a.convertedToIntern) byInternId.set(String(a.convertedToIntern), a.age);
    const p = normPhone(a.phone);
    if (p) byPhone.set(p, a.age);
    const t = normTg(a.telegramUsername);
    if (t) byTg.set(t, a.age);
  }

  const targets = await interns
    .find({ $or: [{ age: { $exists: false } }, { age: null }] })
    .project({ name: 1, lastName: 1, phoneNumber: 1, telegram: 1 })
    .toArray();

  let det = 0, fuz = 0;
  const samples = [];
  const ops = [];

  for (const it of targets) {
    const id = String(it._id);
    let age = byInternId.get(id);
    let via = "convertedToIntern";

    if (age === undefined && FUZZY) {
      const p = normPhone(it.phoneNumber);
      const t = normTg(it.telegram);
      if (p && byPhone.has(p)) { age = byPhone.get(p); via = "phone"; }
      else if (t && byTg.has(t)) { age = byTg.get(t); via = "telegram"; }
    }

    if (!validAge(age)) continue;

    if (via === "convertedToIntern") det += 1; else fuz += 1;
    if (samples.length < 15) {
      samples.push(`${it.name} ${it.lastName || ""} → age ${age} (${via})`);
    }
    if (APPLY) {
      ops.push({ updateOne: { filter: { _id: it._id }, update: { $set: { age } } } });
    }
  }

  if (APPLY && ops.length) {
    await interns.bulkWrite(ops, { ordered: false });
  }

  console.log("📊 Сводка:");
  console.log(`   Интернов без age:                 ${targets.length}`);
  console.log(`   Заполнится (детерминированно):    ${det}`);
  console.log(`   Заполнится (fuzzy):               ${FUZZY ? fuz : "— (выкл, добавь --fuzzy)"}`);
  console.log(`   Итого заполнится:                 ${det + (FUZZY ? fuz : 0)}`);
  if (samples.length) {
    console.log("\n🔎 Примеры:");
    for (const s of samples) console.log(`   ${s}`);
  }
  console.log(
    APPLY
      ? `\n✅ Применено. Обновлено интернов: ${det + (FUZZY ? fuz : 0)}`
      : `\n👀 DRY-RUN — ничего не записано. Применить: node scripts/backfill-intern-age.js --apply${FUZZY ? " --fuzzy" : ""}`
  );

  await mongoose.disconnect();
  console.log("🔌 Отключено. Готово.");
}

run().catch((err) => {
  console.error("❌ Backfill упал:", err);
  process.exit(1);
});
