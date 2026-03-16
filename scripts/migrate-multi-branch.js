/**
 * Migration: single-branch → multi-branch
 *
 * 1. Interns: branch + mentor + isHeadIntern → branches: [{ branch, mentor, isHeadIntern, joinedAt }]
 * 2. Mentors: branch → branches: [branch]
 * 3. Lessons: backfill branch field from intern.branches by matching mentor
 * 4. Report duplicate accounts (same name+lastName) for manual merging
 *
 * Run: node int-server/scripts/migrate-multi-branch.js
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");

async function migrate() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ Connected to MongoDB");
  const db = mongoose.connection.db;

  // ─── 1. Interns ───────────────────────────────────────────────────────────
  const interns = await db.collection("interns").find({
    branch: { $exists: true },
    branches: { $exists: false },
  }).toArray();

  for (const intern of interns) {
    await db.collection("interns").updateOne(
      { _id: intern._id },
      {
        $set: {
          branches: [
            {
              branch: intern.branch,
              mentor: intern.mentor,
              isHeadIntern: intern.isHeadIntern || false,
              joinedAt: intern.dateJoined || intern.createdAt || new Date(),
            },
          ],
        },
        $unset: { branch: "", mentor: "", isHeadIntern: "" },
      }
    );
  }
  console.log(`✅ Migrated ${interns.length} interns`);

  // ─── 2. Mentors ───────────────────────────────────────────────────────────
  const mentors = await db.collection("mentors").find({
    branch: { $exists: true },
    branches: { $exists: false },
  }).toArray();

  for (const mentor of mentors) {
    await db.collection("mentors").updateOne(
      { _id: mentor._id },
      {
        $set: { branches: mentor.branch ? [mentor.branch] : [] },
        $unset: { branch: "" },
      }
    );
  }
  console.log(`✅ Migrated ${mentors.length} mentors`);

  // ─── 3. Lessons: backfill branch field ───────────────────────────────────
  const internMap = {};
  const migratedInterns = await db.collection("interns").find({}).toArray();
  migratedInterns.forEach((i) => { internMap[i._id.toString()] = i; });

  const lessons = await db.collection("lessons").find({
    branch: { $exists: false },
  }).toArray();

  const bulkOps = [];
  for (const lesson of lessons) {
    const intern = internMap[lesson.intern?.toString()];
    if (!intern?.branches?.length) continue;

    const entry = intern.branches.find(
      (b) => b.mentor?.toString() === lesson.mentor?.toString()
    );
    const branchId = entry?.branch || intern.branches[0]?.branch;
    if (!branchId) continue;

    bulkOps.push({
      updateOne: {
        filter: { _id: lesson._id },
        update: { $set: { branch: branchId } },
      },
    });
  }

  if (bulkOps.length > 0) {
    await db.collection("lessons").bulkWrite(bulkOps, { ordered: false });
  }
  console.log(`✅ Backfilled branch for ${bulkOps.length} / ${lessons.length} lessons`);

  // ─── 4. Duplicate account detection ──────────────────────────────────────
  const duplicates = await db.collection("interns").aggregate([
    {
      $group: {
        _id: { name: "$name", lastName: "$lastName" },
        count: { $sum: 1 },
        ids: { $push: "$_id" },
        usernames: { $push: "$username" },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  if (duplicates.length > 0) {
    console.log("\n⚠️  ДУБЛИКАТЫ — объединить вручную:");
    duplicates.forEach((d) => {
      console.log(`  ${d._id.name} ${d._id.lastName}: ${d.count} аккаунта`);
      console.log(`    IDs: ${d.ids.join(", ")}`);
      console.log(`    Usernames: ${d.usernames.join(", ")}`);
    });
  } else {
    console.log("✅ Дубликатов не найдено");
  }

  const mentorDuplicates = await db.collection("mentors").aggregate([
    {
      $group: {
        _id: { name: "$name", lastName: "$lastName" },
        count: { $sum: 1 },
        ids: { $push: "$_id" },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  if (mentorDuplicates.length > 0) {
    console.log("\n⚠️  ДУБЛИКАТЫ МЕНТОРОВ — объединить вручную:");
    mentorDuplicates.forEach((d) => {
      console.log(`  ${d._id.name} ${d._id.lastName}: ${d.count} аккаунта`);
      console.log(`    IDs: ${d.ids.join(", ")}`);
    });
  } else {
    console.log("✅ Дубликатов менторов не найдено");
  }

  await mongoose.disconnect();
  console.log("\n🎉 Migration complete");
}

migrate().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
