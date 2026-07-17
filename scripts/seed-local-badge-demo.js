/**
 * ЛОКАЛЬНАЯ демо-база для теста жёлтых бейджиков. Создаёт филиалы, интернов,
 * админа и аккаунт ресепшена (role: administrator). НИКОГДА не для прода —
 * скрипт отказывается работать, если MONGO_URI указывает на Atlas (mongodb.net).
 *
 * Usage:
 *   MONGO_URI=mongodb://127.0.0.1:27099/interns_badge_demo node scripts/seed-local-badge-demo.js
 */
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const Branch = require("../src/models/branchModel");
const Mentor = require("../src/models/mentorModel");
const Intern = require("../src/models/internModel");
const BadgeEvent = require("../src/models/badgeEventModel");
const BadgeReconciliation = require("../src/models/badgeReconciliationModel");

const URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27099/interns_badge_demo";
if (/mongodb\.net|atlas/i.test(URI)) {
  console.error("❌ ОТКАЗ: MONGO_URI похож на прод (Atlas). Скрипт только для локальной БД.");
  process.exit(1);
}

async function run() {
  await mongoose.connect(URI);
  console.log("✅ Локальная БД:", URI);

  await Promise.all([
    Branch.deleteMany({}), Mentor.deleteMany({}), Intern.deleteMany({}),
    BadgeEvent.deleteMany({}), BadgeReconciliation.deleteMany({}),
  ]);

  const chilonzor = await Branch.create({ name: "Chilonzor", city: "Toshkent", badgeStock: 10 });
  const yunusobod = await Branch.create({ name: "Yunusobod", city: "Toshkent", badgeStock: 6 });

  const hash = (p) => bcrypt.hash(p, 10);

  const mentor = await Mentor.create({
    name: "Nuriddin", lastName: "Mutalov", password: await hash("mentor1234"),
    branches: [chilonzor._id], role: "mentor",
  });

  const admin = await Mentor.create({
    name: "Admin", lastName: "Test", password: await hash("admin1234"),
    branches: [chilonzor._id, yunusobod._id], role: "admin", isAdmin: true,
  });

  const reception = await Mentor.create({
    name: "Reception", lastName: "Chilonzor", password: await hash("recept1234"),
    branches: [chilonzor._id], role: "administrator",
  });

  const mk = (name, lastName, username) => ({
    name, lastName, username, password: "password123", grade: "junior", status: "active",
    branches: [{ branch: chilonzor._id, mentor: mentor._id }],
  });

  const interns = await Intern.create([
    mk("Ali", "Valiyev", "alivaliyev"),
    mk("Vali", "Aliyev", "valialiyev"),
    mk("Sardor", "Karimov", "sardork"),
    mk("Jasur", "Toshev", "jasurt"),
    mk("Dilnoza", "Rahimova", "dilnozar"),
  ]);

  // Демо-утечка: один интерн держит бейджик, но заморожен (кейс "отдал другу").
  const leaker = interns[4];
  leaker.receptionBadge = { hasBadge: true, since: new Date(Date.now() - 40 * 864e5), branch: chilonzor._id, givenBy: admin._id };
  leaker.status = "frozen";
  await leaker.save();
  await BadgeEvent.create({
    intern: leaker._id, branch: chilonzor._id, action: "given",
    by: admin._id, byName: "Admin Test", note: "демо-выдача (давно, не возвращён)",
    at: new Date(Date.now() - 40 * 864e5),
  });

  console.log("\n— Данные —");
  console.log(`Филиалы: Chilonzor (запас 10), Yunusobod (запас 6)`);
  console.log(`Интерны: 5 (4 активных + 1 заморожен с бейджиком = утечка)`);
  console.log("\n— Логины (name / lastName / пароль) —");
  console.log("  Ресепшен (доска):   Reception / Chilonzor / recept1234");
  console.log("  Админ (отчёт):      Admin / Test / admin1234");
  console.log("");

  await mongoose.disconnect();
}

run().catch((e) => { console.error("❌", e); process.exit(1); });
