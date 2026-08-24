/**
 * Seed initial "green" (praise) Rule documents so head interns can reward
 * interns, not only penalize them. Safe to re-run — skips existing titles.
 *
 * Usage:
 *   cd int-server-main
 *   node scripts/seed-praise-rules.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Rule = require("../src/models/rulesModel");

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGO_URI not set in .env");
  process.exit(1);
}

const rules = [
  { category: "green", title: "Mars nomidan tadbirda ishtirok etdi", example: "Tanlov, konferensiya yoki taqdimotda Marsni yaxshi tomondan ko'rsatdi" },
  { category: "green", title: "Real loyihani muvaffaqiyatli bajardi", example: "Buyurtmachi uchun ishlaydigan loyihani boshidan oxirigacha yetkazdi" },
];

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected\n");

  let created = 0;
  let skipped = 0;

  for (const r of rules) {
    const exists = await Rule.findOne({ title: r.title });
    if (exists) {
      skipped++;
      continue;
    }
    await Rule.create(r);
    console.log(`  [${r.category.toUpperCase()}] ${r.title}`);
    created++;
  }

  console.log(`\nQo'shildi: ${created}  O'tkazib yuborildi: ${skipped}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
