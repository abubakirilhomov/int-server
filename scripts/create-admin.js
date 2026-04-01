/**
 * Create an admin mentor account.
 *
 * Usage:
 *   MONGO_URI="mongodb+srv://..." node scripts/create-admin.js
 *   or set MONGO_URI in .env and run:
 *   node scripts/create-admin.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const ADMIN_NAME = "abubakir";
const ADMIN_LAST_NAME = "";
const ADMIN_PASSWORD = "abubakir";

const mentorSchema = new mongoose.Schema({
  name: String,
  lastName: String,
  password: { type: String, select: false },
  role: { type: String, default: "mentor" },
  branches: [{ type: mongoose.Schema.Types.ObjectId }],
  createdAt: { type: Date, default: Date.now },
});

const Mentor = mongoose.model("Mentor", mentorSchema);

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("❌ MONGO_URI not set");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("✅ Connected to MongoDB\n");

  const existing = await Mentor.findOne({ name: ADMIN_NAME, role: "admin" });
  if (existing) {
    console.log(`⚠️  Admin "${ADMIN_NAME}" already exists (id: ${existing._id})`);
    await mongoose.disconnect();
    return;
  }

  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const admin = await Mentor.create({
    name: ADMIN_NAME,
    lastName: ADMIN_LAST_NAME,
    password: hashedPassword,
    role: "admin",
    branches: [],
  });

  console.log(`✅ Admin created:`);
  console.log(`   Name:     ${admin.name}`);
  console.log(`   Role:     ${admin.role}`);
  console.log(`   ID:       ${admin._id}`);
  console.log(`   Password: (hashed)`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
