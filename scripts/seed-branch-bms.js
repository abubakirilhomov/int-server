/**
 * One-shot migration: backfill Branch.branchManager from existing mentors
 * with role: "branchManager" and a matching `branches[]` entry.
 *
 * - If exactly one BM is found for a branch and Branch.branchManager is
 *   empty, set it.
 * - If 0 or >1 BMs are found, log and leave Branch.branchManager unchanged
 *   (admin will need to pick manually via the admin UI).
 *
 * Use --apply to actually write; default is dry-run.
 *
 * Usage:
 *   cd int-server
 *   node scripts/seed-branch-bms.js          # dry run
 *   node scripts/seed-branch-bms.js --apply  # write
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Branch = require("../src/models/branchModel");
const Mentor = require("../src/models/mentorModel");

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGO_URI not set in .env");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");

(async () => {
  await mongoose.connect(MONGODB_URI);

  const branches = await Branch.find();
  let assigned = 0;
  let ambiguous = 0;
  let missing = 0;
  let already = 0;

  for (const branch of branches) {
    if (branch.branchManager) {
      already++;
      continue;
    }

    const bms = await Mentor.find({
      role: "branchManager",
      branches: branch._id,
    }).select("_id name lastName");

    if (bms.length === 1) {
      console.log(
        `→ ${branch.name}: ${bms[0].name || ""} ${bms[0].lastName || ""} (${bms[0]._id})`
      );
      if (APPLY) {
        branch.branchManager = bms[0]._id;
        await branch.save();
      }
      assigned++;
    } else if (bms.length === 0) {
      console.log(`⚠ ${branch.name}: no branchManager mentor found`);
      missing++;
    } else {
      console.log(
        `⚠ ${branch.name}: ${bms.length} branchManager candidates — set manually`
      );
      ambiguous++;
    }
  }

  console.log("");
  console.log(`Summary: assigned=${assigned} already=${already} missing=${missing} ambiguous=${ambiguous}`);
  console.log(APPLY ? "(applied)" : "(dry run — pass --apply to write)");

  await mongoose.disconnect();
})().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
