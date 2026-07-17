/**
 * Инвентаризация запаса жёлтых бейджиков: проставляет Branch.badgeStock
 * по филиалам из карты STOCK ниже (заполни числами после физического подсчёта).
 *
 * Матчинг по имени филиала (без регистра, подстрока). Идемпотентно: ставит точное
 * значение, повторный прогон ничего не ломает.
 *
 * Usage:
 *   cd int-server
 *   node scripts/set-badge-stock.js           # dry-run 👀 (только покажет)
 *   node scripts/set-badge-stock.js --apply    # применить ✍️
 *
 * Аккаунты ресепшена (role: administrator) создаются через админ-панель
 * (Менторы → добавить → «Ресепшен (бейджики)» → филиал → пароль), поэтому
 * отдельного скрипта под них нет — там нужен пароль на каждого.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");

// ⬇️ ЗАПОЛНИ: имя филиала (как в БД) → сколько бейджиков на его ресепшене.
const STOCK = {
  // "Чилонзор": 20,
  // "Юнусабад": 15,
  // "Тинчлик": 12,
};

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("❌ MONGO_URI не задан в .env");
  process.exit(1);
}

async function run() {
  const pairs = Object.entries(STOCK);
  if (pairs.length === 0) {
    console.error("⚠️  Карта STOCK пустая — заполни её числами и запусти снова.");
    process.exit(1);
  }
  console.log(`🔌 Подключение...  режим: ${APPLY ? "APPLY ✍️" : "DRY-RUN 👀"}`);
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Подключено\n");

  const branches = mongoose.connection.db.collection("branches");
  let matched = 0;
  const notFound = [];

  for (const [name, stock] of pairs) {
    if (!Number.isInteger(stock) || stock < 0) {
      console.log(`  ⚠️  «${name}»: badgeStock должен быть целым ≥ 0 (сейчас ${stock}) — пропуск`);
      continue;
    }
    const b = await branches.findOne({ name: { $regex: name, $options: "i" } });
    if (!b) {
      notFound.push(name);
      continue;
    }
    matched += 1;
    console.log(`  • ${b.name}: ${b.badgeStock ?? 0} → ${stock}`);
    if (APPLY) {
      await branches.updateOne({ _id: b._id }, { $set: { badgeStock: stock } });
    }
  }

  if (notFound.length) {
    console.log(`\n❓ Не найдены филиалы: ${notFound.join(", ")}`);
  }
  console.log(`\n${APPLY ? "✍️  Записано" : "👀 Dry-run"}: ${matched} филиал(ов).`);
  if (!APPLY && matched) console.log("Запусти с --apply, чтобы применить.");

  await mongoose.disconnect();
}

run().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
