/**
 * Grant (or revoke) admin access for a mentor via the orthogonal `isAdmin` flag.
 *
 * Sets Mentor.isAdmin WITHOUT touching Mentor.role, so a teaching mentor keeps
 * showing up in the intern lesson-mentor picker (interns app filters
 * role === "mentor") while gaining admin-panel access. Admin-ness is then
 * `isAdmin === true || role === "admin"` everywhere — see src/utils/isAdminUser.js.
 *
 * Safety:
 *   - Dry-run by default; pass --apply to write.
 *   - Matches by name + lastName (case-insensitive, trimmed, exact).
 *   - REFUSES to write if more than one mentor matches (known duplicate-mentor
 *     issue, see merge-mentor-duplicates.js) — disambiguate before applying.
 *   - Never modifies `role`.
 *
 * Usage:
 *   cd int-server
 *   node scripts/grant-mentor-admin.js                               # dry-run, default target Ibrohim To'lqinov
 *   node scripts/grant-mentor-admin.js --apply                       # grant admin
 *   node scripts/grant-mentor-admin.js "Имя" "Фамилия" --apply       # other mentor
 *   node scripts/grant-mentor-admin.js "Имя" "Фамилия" --revoke --apply   # revoke admin
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Mentor = require("../src/models/mentorModel");

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGO_URI not set in .env");
  process.exit(1);
}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const REVOKE = args.includes("--revoke");
const positionals = args.filter((a) => !a.startsWith("--"));

const NAME = (positionals[0] || "Ibrohim").trim();
const LAST = (positionals[1] || "To'lqinov").trim();
const target = !REVOKE; // grant by default, revoke with --revoke

// Case-insensitive exact match (escape regex metacharacters from the input).
const exactCI = (s) =>
  new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");

(async () => {
  await mongoose.connect(MONGODB_URI);

  const matches = await Mentor.find({
    name: exactCI(NAME),
    lastName: exactCI(LAST),
  }).select("_id name lastName role isAdmin branches");

  console.log(
    `\nTarget: "${NAME} ${LAST}"  →  isAdmin: ${target}  (${APPLY ? "APPLY" : "dry-run"})`
  );

  if (matches.length === 0) {
    console.error(`✗ No mentor found matching "${NAME} ${LAST}".`);
    await mongoose.disconnect();
    process.exit(1);
  }

  if (matches.length > 1) {
    console.error(
      `✗ ${matches.length} mentors match "${NAME} ${LAST}" — refusing to write (duplicate guard):`
    );
    for (const m of matches) {
      console.error(
        `    - ${m._id}  role=${m.role}  isAdmin=${m.isAdmin === true}  branches=${(m.branches || []).length}`
      );
    }
    console.error(
      "  Resolve duplicates (scripts/merge-mentor-duplicates.js) before applying."
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  const m = matches[0];
  console.log(`  Found: ${m._id}  role=${m.role}  isAdmin=${m.isAdmin === true}`);

  if ((m.isAdmin === true) === target) {
    console.log(`  Already isAdmin=${target} — nothing to do.`);
    await mongoose.disconnect();
    return;
  }

  if (!APPLY) {
    console.log(
      `  Would set isAdmin ${m.isAdmin === true} → ${target} (role stays "${m.role}"). Re-run with --apply.`
    );
    await mongoose.disconnect();
    return;
  }

  m.isAdmin = target;
  await m.save();
  console.log(
    `  ✓ Updated: ${m.name} ${m.lastName} → isAdmin=${target} (role "${m.role}" unchanged).`
  );

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error("Error:", err.message);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
