/**
 * Migration: normalize Lesson.status field
 *
 * Problem: old lessons were created before the `status` field existed.
 * They have `isRated: true/false` but `status: undefined`.
 * Multiple controllers check both patterns — this migration eliminates the need.
 *
 * Rules:
 *   isRated === true  → status = "confirmed"
 *   isRated === false → status = "pending"
 *
 * Safe to run multiple times (idempotent — only touches docs where status is missing).
 *
 * Usage:
 *   cd int-server
 *   node scripts/migrate-lesson-status.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGODB_URI) {
    console.error("❌ MONGO_URI not set in .env");
    process.exit(1);
}

async function migrate() {
    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected\n");

    const db = mongoose.connection.db;
    const lessons = db.collection("lessons");

    // --- Step 1: isRated=true → confirmed ---
    const confirmedResult = await lessons.updateMany(
        { status: { $exists: false }, isRated: true },
        { $set: { status: "confirmed" } }
    );
    console.log(`✅ Set status="confirmed" on ${confirmedResult.modifiedCount} lessons (isRated=true)`);

    // --- Step 2: isRated=false (or missing) → pending ---
    const pendingResult = await lessons.updateMany(
        { status: { $exists: false } },
        { $set: { status: "pending" } }
    );
    console.log(`✅ Set status="pending"    on ${pendingResult.modifiedCount} lessons (isRated=false)`);

    // --- Verification ---
    const remaining = await lessons.countDocuments({ status: { $exists: false } });
    if (remaining === 0) {
        console.log("\n🎉 Migration complete — all lessons now have a status field");
    } else {
        console.warn(`\n⚠️  ${remaining} lessons still have no status — check manually`);
    }

    const total = await lessons.countDocuments();
    const confirmed = await lessons.countDocuments({ status: "confirmed" });
    const pending = await lessons.countDocuments({ status: "pending" });
    console.log(`\n📊 Final counts:`);
    console.log(`   Total:     ${total}`);
    console.log(`   confirmed: ${confirmed}`);
    console.log(`   pending:   ${pending}`);

    await mongoose.disconnect();
    console.log("\n🔌 Disconnected. Done.");
}

migrate().catch((err) => {
    console.error("❌ Migration failed:", err);
    process.exit(1);
});
