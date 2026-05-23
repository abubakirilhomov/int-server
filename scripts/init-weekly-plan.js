/**
 * Migration: initialize Intern.weeklyPlan subdoc for existing interns.
 *
 * Idempotent — only writes to interns whose weeklyPlan is missing OR who don't
 * have status field on weeklyPlan yet. Safe to re-run.
 *
 * Dry-run by default. Pass --apply to actually write.
 *
 *   node scripts/init-weekly-plan.js          # dry-run, prints stats
 *   node scripts/init-weekly-plan.js --apply  # writes
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`✅ Connected to MongoDB ${APPLY ? "(APPLY mode)" : "(dry-run)"}`);
  const db = mongoose.connection.db;

  // Find interns missing weeklyPlan.status (covers both "no weeklyPlan field"
  // and "partial weeklyPlan from earlier test"). Touch only what's needed.
  const candidates = await db
    .collection("interns")
    .find({ "weeklyPlan.status": { $exists: false } })
    .project({ _id: 1, name: 1, lastName: 1, status: 1 })
    .toArray();

  console.log(`📊 Found ${candidates.length} intern(s) without weeklyPlan`);
  if (candidates.length === 0) {
    console.log("Nothing to do.");
    await mongoose.disconnect();
    return;
  }

  // Preview a few
  for (const c of candidates.slice(0, 5)) {
    console.log(`  - ${c.name} ${c.lastName || ""} (${c._id}) status=${c.status}`);
  }
  if (candidates.length > 5) console.log(`  ... and ${candidates.length - 5} more`);

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const result = await db.collection("interns").updateMany(
    { "weeklyPlan.status": { $exists: false } },
    {
      $set: {
        weeklyPlan: {
          status: "ok",
          streakWeeks: 0,
          longestStreakWeeks: 0,
          lastEvaluatedAt: null,
          currentWeekStartAt: null,
          currentWeekTarget: 0,
          currentWeekConfirmed: 0,
          restrictedSince: null,
          selfActivations: [],
        },
      },
    }
  );

  console.log(`\n✅ Initialized weeklyPlan for ${result.modifiedCount} intern(s)`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
