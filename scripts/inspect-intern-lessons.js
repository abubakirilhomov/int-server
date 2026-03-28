/**
 * Inspect last N lessons for a specific intern.
 *
 * Usage:
 *   node scripts/inspect-intern-lessons.js
 *
 * Add --delete to remove suspicious lessons (ORPHAN, NO_DATE, OLD, PLACEHOLDER).
 */

require("dotenv").config();
const mongoose = require("mongoose");

const INTERN_NAME = "Sardor A'loyev"; // first + lastName
const LIMIT = 200;
const DRY_RUN = !process.argv.includes("--delete");

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

const internSchema = new mongoose.Schema({
  name:     String,
  lastName: String,
  grade:    String,
  score:    Number,
});

const mentorSchema = new mongoose.Schema({
  name:     String,
  lastName: String,
});

const Lesson = mongoose.model("Lesson", lessonSchema);
const Intern = mongoose.model("Intern", internSchema);
const Mentor = mongoose.model("Mentor", mentorSchema);

const fmtDate = (d) => {
  const parsed = d ? new Date(d) : null;
  return parsed && !isNaN(parsed) ? parsed.toISOString().slice(0, 10) : "INVALID";
};

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ Connected to MongoDB\n");

  // Find intern
  const [firstName, ...rest] = INTERN_NAME.split(" ");
  const lastName = rest.join(" ");
  const intern = await Intern.findOne({
    name:     { $regex: new RegExp(`^${firstName}$`, "i") },
    lastName: { $regex: new RegExp(`^${lastName}$`, "i") },
  }).lean();

  if (!intern) {
    console.error(`❌ Intern "${INTERN_NAME}" not found`);
    process.exit(1);
  }
  console.log(`👤 Found intern: ${intern.name} ${intern.lastName}  (id: ${intern._id})`);
  console.log(`   Grade: ${intern.grade}  |  Score: ${intern.score}\n`);

  // Fetch last LIMIT lessons sorted by date desc
  const lessons = await Lesson.find({ intern: intern._id })
    .sort({ date: -1, createdAt: -1 })
    .limit(LIMIT)
    .populate("mentor", "name lastName")
    .lean();

  console.log(`📋 Last ${lessons.length} lessons:\n`);
  console.log("  #   date        status     mentor                    topic");
  console.log("  ─".repeat(30));

  const now = new Date();
  const ninetyDaysAgo = new Date(now - 90 * 24 * 3600 * 1000);
  const thirtyDaysAgo = new Date(now - 30 * 24 * 3600 * 1000);
  const suspiciousIds = new Set();

  lessons.forEach((l, i) => {
    const mentorName = l.mentor ? `${l.mentor.name} ${l.mentor.lastName}` : "DELETED MENTOR";
    const dateStr = fmtDate(l.date);
    const createdAt = l.createdAt ? new Date(l.createdAt) : null;

    const hasInvalidDate = !l.date || isNaN(new Date(l.date));
    const isOld = createdAt && createdAt < ninetyDaysAgo;
    const isRecent = createdAt && createdAt > thirtyDaysAgo;
    const isOrphan = !l.mentor;
    const isPlaceholder = (l.topic || "").trim().toLowerCase() === "placeholder";

    const flags = [
      isOrphan      && "NO_MENTOR",
      isPlaceholder && "PLACEHOLDER",
      hasInvalidDate && "NO_DATE",
      isOld && !isRecent && "OLD(>90d)",
    ].filter(Boolean);

    const shouldDelete = isOrphan || isPlaceholder || hasInvalidDate || (isOld && !isRecent);
    if (shouldDelete) suspiciousIds.add(l._id.toString());

    const flagStr = flags.length ? ` ⚠️  [${flags.join("+")}]` : "";
    const num = String(i + 1).padStart(3);
    console.log(`  ${num} ${dateStr}  ${(l.status || "?").padEnd(10)} ${mentorName.padEnd(25)} ${l.topic || "—"}${flagStr}`);
  });

  console.log("\n── Summary ───────────────────────────────────────────────────────");
  const confirmed = lessons.filter(l => l.status === "confirmed").length;
  const pending   = lessons.filter(l => l.status === "pending").length;
  console.log(`  Confirmed: ${confirmed}  |  Pending: ${pending}  |  Other: ${lessons.length - confirmed - pending}`);
  console.log(`  Suspicious: ${suspiciousIds.size}`);

  if (DRY_RUN) {
    console.log("\n⚠️  DRY RUN — no changes made.");
    if (suspiciousIds.size > 0) {
      console.log("   To delete suspicious lessons run:");
      console.log("   node scripts/inspect-intern-lessons.js --delete\n");
    }
  } else {
    if (suspiciousIds.size === 0) {
      console.log("\nNothing to delete.");
    } else {
      const result = await Lesson.deleteMany({ _id: { $in: Array.from(suspiciousIds) } });
      console.log(`\n✅ Deleted ${result.deletedCount} suspicious lessons.`);
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
