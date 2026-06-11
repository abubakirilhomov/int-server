/**
 * READ-ONLY inspection. Counts Application (заявки) and Interview records
 * created before a cutoff, so we can decide exactly what a deletion would remove.
 * Does NOT write or delete anything.
 *
 * Usage:
 *   cd int-server
 *   node scripts/inspect-applications-before.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Application = require("../src/models/applicationModel");
const Interview = require("../src/models/interviewModel");

// "до 6 июня" — before June 6 at local midnight (Asia/Tashkent, UTC+5).
const CUTOFF = new Date("2026-06-06T00:00:00+05:00");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const totalApps = await Application.countDocuments({});
  const before = { createdAt: { $lt: CUTOFF } };
  const appsBefore = await Application.countDocuments(before);

  const byStatus = await Application.aggregate([
    { $match: before },
    { $group: { _id: "$status", n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);

  // How many of those "before" applications have linked Interview records?
  const beforeIds = await Application.find(before).distinct("_id");
  const linkedInterviews = await Interview.countDocuments({
    application: { $in: beforeIds },
  });

  // In case "заявки на собес" was meant as the Interview records themselves:
  const totalInterviews = await Interview.countDocuments({});
  const interviewsBefore = await Interview.countDocuments(before);

  console.log("Cutoff (createdAt <):", CUTOFF.toISOString(), "= 2026-06-06 00:00 +05");
  console.log("");
  console.log("APPLICATIONS (заявки):");
  console.log("  total in DB:            ", totalApps);
  console.log("  created before cutoff:  ", appsBefore);
  console.log("  by status (before):");
  byStatus.forEach((s) => console.log(`     ${String(s._id).padEnd(20)} ${s.n}`));
  console.log("  linked Interview docs:  ", linkedInterviews, "(would be orphaned if apps deleted)");
  console.log("");
  console.log("INTERVIEWS (собеседования):");
  console.log("  total in DB:            ", totalInterviews);
  console.log("  created before cutoff:  ", interviewsBefore);

  await mongoose.disconnect();
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
