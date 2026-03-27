/**
 * Inspect & clean pending lessons for a specific mentor.
 *
 * Usage (dry-run, just shows stats):
 *   node scripts/inspect-mentor-lessons.js
 *
 * To actually delete suspicious lessons add --delete flag:
 *   node scripts/inspect-mentor-lessons.js --delete
 */

require("dotenv").config();
const mongoose = require("mongoose");

const MENTOR_NAME = "Bekzod Qaxxorov"; // first + lastName
const DRY_RUN = !process.argv.includes("--delete");

// ── minimal inline models (avoid circular deps from full models) ──────────────
const lessonSchema = new mongoose.Schema({
  intern:  { type: mongoose.Schema.Types.ObjectId, ref: "Intern" },
  mentor:  { type: mongoose.Schema.Types.ObjectId, ref: "Mentor" },
  topic:   String,
  time:    String,
  date:    Date,
  group:   String,
  status:  String,
  isRated: Boolean,
  createdAt: Date,
}, { timestamps: true });

const mentorSchema = new mongoose.Schema({
  name:     String,
  lastName: String,
});

const internSchema = new mongoose.Schema({
  name:     String,
  lastName: String,
});

const Lesson = mongoose.model("Lesson", lessonSchema);
const Mentor = mongoose.model("Mentor", mentorSchema);
const Intern = mongoose.model("Intern", internSchema);

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ Connected to MongoDB\n");

  // 1. Find mentor
  const [firstName, ...rest] = MENTOR_NAME.split(" ");
  const lastName = rest.join(" ");
  const mentor = await Mentor.findOne({
    name: { $regex: new RegExp(`^${firstName}$`, "i") },
    lastName: { $regex: new RegExp(`^${lastName}$`, "i") },
  }).lean();

  if (!mentor) {
    console.error(`❌ Mentor "${MENTOR_NAME}" not found`);
    process.exit(1);
  }
  console.log(`👤 Found mentor: ${mentor.name} ${mentor.lastName}  (id: ${mentor._id})\n`);

  // 2. Load all pending lessons for this mentor
  const pending = await Lesson.find({ mentor: mentor._id, status: "pending" })
    .populate("intern", "name lastName")
    .lean();

  console.log(`📋 Total pending lessons: ${pending.length}\n`);

  if (pending.length === 0) {
    console.log("Nothing to do.");
    await mongoose.disconnect();
    return;
  }

  // 3. Group by intern
  const byIntern = {};
  for (const l of pending) {
    const internId = l.intern?._id?.toString() || "unknown";
    if (!byIntern[internId]) {
      byIntern[internId] = {
        internName: l.intern ? `${l.intern.name} ${l.intern.lastName}` : "deleted intern",
        lessons: [],
      };
    }
    byIntern[internId].lessons.push(l);
  }

  // 4. Print per-intern summary
  console.log("── Per-intern breakdown ──────────────────────────────────────────");
  const suspiciousIds = new Set();
  const now = new Date();
  const ninetyDaysAgo = new Date(now - 90 * 24 * 3600 * 1000);

  const fmtDate = (d) => {
    const parsed = d ? new Date(d) : null;
    return parsed && !isNaN(parsed) ? parsed.toISOString().slice(0, 10) : "INVALID";
  };

  for (const [internId, { internName, lessons }] of Object.entries(byIntern)) {
    // Sort by date (invalid dates go to end)
    lessons.sort((a, b) => {
      const da = a.date ? new Date(a.date) : Infinity;
      const db = b.date ? new Date(b.date) : Infinity;
      return da - db;
    });

    // Detect suspicious: same intern + same date duplicates
    const dateCounts = {};
    for (const l of lessons) {
      const dk = fmtDate(l.date);
      dateCounts[dk] = (dateCounts[dk] || 0) + 1;
    }
    const dupDates = Object.entries(dateCounts).filter(([, c]) => c > 1).map(([d]) => d);

    // Detect very old pending lessons (>90 days) OR invalid date
    const veryOld = lessons.filter((l) => {
      const created = l.createdAt ? new Date(l.createdAt) : null;
      return !l.date || isNaN(new Date(l.date)) || (created && created < ninetyDaysAgo);
    });

    console.log(`\n  ${internName}  (${lessons.length} pending)`);
    if (dupDates.length) {
      console.log(`    ⚠️  Duplicate dates: ${dupDates.join(", ")}`);
    }
    if (veryOld.length) {
      console.log(`    ⚠️  Suspicious (invalid date or >90d old): ${veryOld.length} lessons`);
    }

    // Collect IDs of suspicious lessons to delete
    for (const l of lessons) {
      const dk = fmtDate(l.date);
      const hasInvalidDate = !l.date || isNaN(new Date(l.date));
      const created = l.createdAt ? new Date(l.createdAt) : null;
      const isOld = created && created < ninetyDaysAgo;
      const isDup = dateCounts[dk] > 1;

      // Safe to delete only if:
      // 1. Intern is deleted (orphan), OR
      // 2. Topic is "Placeholder" (bulk-inserted fake), OR
      // 3. Has invalid/missing date, OR
      // 4. Is a duplicate AND older than 30 days (not a recent real lesson)
      const recentCutoff = new Date(now - 30 * 24 * 3600 * 1000);
      const isRecent = created && created > recentCutoff;
      const isOrphan = internId === "unknown";
      const isPlaceholder = (l.topic || "").trim().toLowerCase() === "placeholder";

      const shouldDelete =
        isOrphan ||
        isPlaceholder ||
        hasInvalidDate ||
        (isOld && !isRecent);

      if (shouldDelete) {
        suspiciousIds.add(l._id.toString());
        const flags = [
          isOrphan && "ORPHAN",
          isPlaceholder && "PLACEHOLDER",
          hasInvalidDate && "NO_DATE",
          isDup && "DUPLICATE",
          isOld && "OLD",
        ].filter(Boolean).join("+");
        console.log(
          `    🗑  [${flags}] id=${l._id}  date=${dk}  topic=${l.topic || "—"}  createdAt=${fmtDate(l.createdAt)}`
        );
      } else if (isDup) {
        console.log(
          `    ✅ [KEEP — recent real lesson] id=${l._id}  date=${dk}  topic=${l.topic || "—"}  createdAt=${fmtDate(l.createdAt)}`
        );
      }
    }
  }

  console.log("\n── Summary ───────────────────────────────────────────────────────");
  console.log(`  Total pending: ${pending.length}`);
  console.log(`  Suspicious (duplicates + orphaned >90d): ${suspiciousIds.size}`);
  console.log(`  Would keep: ${pending.length - suspiciousIds.size}`);

  if (DRY_RUN) {
    console.log("\n⚠️  DRY RUN — no changes made.");
    console.log("   To delete suspicious lessons run:");
    console.log("   node scripts/inspect-mentor-lessons.js --delete\n");
  } else {
    if (suspiciousIds.size === 0) {
      console.log("\nNothing to delete.");
    } else {
      const result = await Lesson.deleteMany({
        _id: { $in: Array.from(suspiciousIds) },
      });
      console.log(`\n✅ Deleted ${result.deletedCount} suspicious lessons.`);
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
