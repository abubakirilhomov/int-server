require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error("❌ MONGO_URI not set"); process.exit(1); }

async function run() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;

  const hashed = await bcrypt.hash("abubakir22", 10);
  const result = await db.collection("mentors").updateOne(
    { name: "abubakir" },
    { $set: { password: hashed } }
  );

  if (result.matchedCount === 0) {
    console.error("❌ Ментор 'abubakir' не найден");
  } else {
    console.log("✅ Пароль обновлён для abubakir");
  }

  await mongoose.disconnect();
}

run().catch(err => { console.error("❌", err); process.exit(1); });
