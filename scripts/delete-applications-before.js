/**
 * Delete Application (заявки на собес) records created before a cutoff.
 *
 * Safety:
 *   - Dry-run by default; pass --apply to actually delete.
 *   - Backs up every matched document to a timestamped JSON file BEFORE deleting.
 *   - Refuses to delete applications that are `accepted` or already converted to
 *     an intern (convertedToIntern set) — those are not throwaway заявки.
 *
 * Usage:
 *   cd int-server
 *   node scripts/delete-applications-before.js            # dry-run (lists matches)
 *   node scripts/delete-applications-before.js --apply    # backup + delete
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Application = require("../src/models/applicationModel");

// "до 6 июня" — before June 6 at local midnight (Asia/Tashkent, UTC+5).
const CUTOFF = new Date("2026-06-06T00:00:00+05:00");
const APPLY = process.argv.includes("--apply");

const filter = {
  createdAt: { $lt: CUTOFF },
  status: { $nin: ["accepted"] },
  convertedToIntern: null,
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const matches = await Application.find(filter).lean();
  console.log(`Cutoff (createdAt <): ${CUTOFF.toISOString()}  (2026-06-06 00:00 +05)`);
  console.log(`Matched ${matches.length} application(s) to delete:\n`);
  matches.forEach((a, i) =>
    console.log(
      `  ${String(i + 1).padStart(2)}. ${a.firstName} ${a.lastName}`.padEnd(34) +
        ` ${String(a.status).padEnd(12)} ${new Date(a.createdAt).toISOString().slice(0, 10)}  @${a.telegramUsername}`
    )
  );

  // Surface anything the safety guard would have caught (accepted/converted before cutoff).
  const guarded = await Application.countDocuments({
    createdAt: { $lt: CUTOFF },
    $or: [{ status: "accepted" }, { convertedToIntern: { $ne: null } }],
  });
  if (guarded > 0) {
    console.log(`\n  (skipping ${guarded} accepted/converted application(s) before cutoff — not deleted)`);
  }

  if (!APPLY) {
    console.log("\nDRY-RUN. No changes made. Re-run with --apply to back up and delete.");
    await mongoose.disconnect();
    return;
  }

  if (matches.length === 0) {
    console.log("\nNothing to delete.");
    await mongoose.disconnect();
    return;
  }

  // Backup before deleting.
  const stamp = CUTOFF.toISOString().slice(0, 10);
  const backupFile = path.join(
    __dirname,
    `backup-applications-deleted-${stamp}.json`
  );
  fs.writeFileSync(backupFile, JSON.stringify(matches, null, 2));
  console.log(`\nBacked up ${matches.length} document(s) to:\n  ${backupFile}`);

  const ids = matches.map((m) => m._id);
  const res = await Application.deleteMany({ _id: { $in: ids } });
  console.log(`Deleted ${res.deletedCount} application(s).`);

  const remaining = await Application.countDocuments({});
  console.log(`Applications remaining in DB: ${remaining}`);

  await mongoose.disconnect();
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
