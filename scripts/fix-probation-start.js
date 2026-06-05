/**
 * Restore an intern's probationStartDate to their dateJoined.
 *
 * Repairs records hit by the updateIntern bug, where saving the admin edit form
 * (which always sends `grade`) reset probationStartDate to "today" even when the
 * grade was unchanged — silently dropping earlier lessons out of trial-period
 * stats. The code bug itself is fixed in services/internService.js (reset now
 * only on a real grade change).
 *
 * Safety:
 *   - Dry-run by default; pass --apply to write.
 *   - Targets ONE intern by username (exact, case-insensitive).
 *   - Writes only probationStartDate via updateOne (no hooks, nothing else touched).
 *   - Refuses if intern not found, >1 match, or dateJoined missing.
 *
 * Usage:
 *   cd int-server
 *   node scripts/fix-probation-start.js KamronQayumov           # dry-run
 *   node scripts/fix-probation-start.js KamronQayumov --apply    # write
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Intern = require("../src/models/internModel");

const USERNAME = process.argv.slice(2).find((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

if (!USERNAME) {
  console.error("Usage: node scripts/fix-probation-start.js <username> [--apply]");
  process.exit(1);
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const matches = await Intern.find({ username: new RegExp(`^${USERNAME}$`, "i") })
    .select("name lastName username grade status dateJoined probationStartDate")
    .lean();

  if (matches.length === 0) {
    console.error(`✗ No intern with username "${USERNAME}".`);
    await mongoose.disconnect();
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`✗ ${matches.length} interns match username "${USERNAME}" — refusing (ambiguous).`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const i = matches[0];
  if (!i.dateJoined) {
    console.error(`✗ ${i.username} has no dateJoined — cannot restore. Set it manually.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`Intern: ${i.name} ${i.lastName} (@${i.username})  grade=${i.grade}/${i.status}`);
  console.log(`  dateJoined:         ${iso(i.dateJoined)}`);
  console.log(`  probationStartDate: ${iso(i.probationStartDate)}  →  ${iso(i.dateJoined)}`);

  if (iso(i.probationStartDate) === iso(i.dateJoined)) {
    console.log("  Already aligned — nothing to do.");
    await mongoose.disconnect();
    return;
  }

  if (!APPLY) {
    console.log(`  (dry-run) re-run with --apply to write.`);
    await mongoose.disconnect();
    return;
  }

  await Intern.updateOne({ _id: i._id }, { $set: { probationStartDate: i.dateJoined } });
  console.log(`  ✓ probationStartDate set to ${iso(i.dateJoined)}.`);

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error("ERR:", e.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
