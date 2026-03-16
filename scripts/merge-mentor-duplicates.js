/**
 * Merge duplicate mentor accounts.
 *
 * For each pair: keeps the PRIMARY (first ID), merges branches from secondary,
 * re-points all Lessons and Intern.branches references to the primary, then deletes secondary.
 *
 * Run: node int-server/scripts/merge-mentor-duplicates.js
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");

const DUPLICATES = [
  {
    name: "Abduvohid Temirov",
    primary:   "69161cc970b9c4e7fed29efe",
    secondary: "691c6465a71f004f0e66333c",
  },
  {
    name: "Behruz Satimbayev",
    primary:   "68f3393a668e5a8b7622792c",
    secondary: "68f339b8668e5a8b76227940",
  },
  {
    name: "Mirfazil Mirsharipov",
    primary:   "68ecf0b1f3cbbf54961c0f02",
    secondary: "68ee4224384ae12276e042ae",
  },
  {
    name: "Bekzod Qaxxorov",
    primary:   "68f1ed2f828528ce11f441e4",
    secondary: "68f3762afed2608737b35270",
  },
];

async function merge() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ Connected to MongoDB\n");
  const db = mongoose.connection.db;

  for (const dup of DUPLICATES) {
    const primaryId   = new mongoose.Types.ObjectId(dup.primary);
    const secondaryId = new mongoose.Types.ObjectId(dup.secondary);

    console.log(`━━━ ${dup.name} ━━━`);

    // 1. Load both
    const primary   = await db.collection("mentors").findOne({ _id: primaryId });
    const secondary = await db.collection("mentors").findOne({ _id: secondaryId });

    if (!primary) { console.log(`  ⚠️  Primary not found, skipping\n`); continue; }
    if (!secondary) { console.log(`  ⚠️  Secondary not found (already deleted?), skipping\n`); continue; }

    console.log(`  Primary   [${dup.primary}]: branches=${JSON.stringify(primary.branches)}`);
    console.log(`  Secondary [${dup.secondary}]: branches=${JSON.stringify(secondary.branches)}`);

    // 2. Merge branches — add secondary's branches not already in primary
    const existingBranchIds = (primary.branches || []).map(String);
    const newBranches = (secondary.branches || []).filter(
      (b) => !existingBranchIds.includes(String(b))
    );

    if (newBranches.length > 0) {
      await db.collection("mentors").updateOne(
        { _id: primaryId },
        { $push: { branches: { $each: newBranches } } }
      );
      console.log(`  ✅ Merged ${newBranches.length} branch(es) into primary`);
    } else {
      console.log(`  ℹ️  No new branches to merge`);
    }

    // 3. Re-point Lessons: mentor = secondary → primary
    const lessonsResult = await db.collection("lessons").updateMany(
      { mentor: secondaryId },
      { $set: { mentor: primaryId } }
    );
    console.log(`  ✅ Lessons re-pointed: ${lessonsResult.modifiedCount}`);

    // 4. Re-point Intern.branches[].mentor: secondary → primary
    const internsResult = await db.collection("interns").updateMany(
      { "branches.mentor": secondaryId },
      { $set: { "branches.$[elem].mentor": primaryId } },
      { arrayFilters: [{ "elem.mentor": secondaryId }] }
    );
    console.log(`  ✅ Intern branches re-pointed: ${internsResult.modifiedCount}`);

    // 5. Re-point Intern.pendingMentors[].mentorId
    const pendingResult = await db.collection("interns").updateMany(
      { "pendingMentors.mentorId": secondaryId },
      { $set: { "pendingMentors.$[elem].mentorId": primaryId } },
      { arrayFilters: [{ "elem.mentorId": secondaryId }] }
    );
    console.log(`  ✅ Pending mentors re-pointed: ${pendingResult.modifiedCount}`);

    // 6. Re-point Intern.lessonsVisited[].mentorId
    const visitedResult = await db.collection("interns").updateMany(
      { "lessonsVisited.mentorId": secondaryId },
      { $set: { "lessonsVisited.$[elem].mentorId": primaryId } },
      { arrayFilters: [{ "elem.mentorId": secondaryId }] }
    );
    console.log(`  ✅ LessonsVisited re-pointed: ${visitedResult.modifiedCount}`);

    // 7. Re-point Intern.feedbacks[].mentorId
    const feedbackResult = await db.collection("interns").updateMany(
      { "feedbacks.mentorId": secondaryId },
      { $set: { "feedbacks.$[elem].mentorId": primaryId } },
      { arrayFilters: [{ "elem.mentorId": secondaryId }] }
    );
    console.log(`  ✅ Feedbacks re-pointed: ${feedbackResult.modifiedCount}`);

    // 8. Delete secondary
    await db.collection("mentors").deleteOne({ _id: secondaryId });
    console.log(`  🗑️  Secondary account deleted\n`);
  }

  await mongoose.disconnect();
  console.log("🎉 Merge complete");
}

merge().catch((err) => {
  console.error("❌ Merge failed:", err);
  process.exit(1);
});
