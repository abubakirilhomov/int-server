/**
 * One-time sync: check all interns against badge definitions
 * and award any badges they've already earned but don't have yet.
 *
 * Safe to re-run — skips badges already awarded.
 *
 * Usage:
 *   cd int-server
 *   node scripts/sync-badges.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Intern = require("../src/models/internModel");
const Lesson = require("../src/models/lessonModel");
const BADGE_DEFINITIONS = require("../src/config/badges");

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGO_URI not set in .env");
  process.exit(1);
}

async function getStats(internId, intern) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [totalLessons, monthlyLessons] = await Promise.all([
    Lesson.countDocuments({ intern: internId }),
    Lesson.countDocuments({
      intern: internId,
      date: { $gte: startOfMonth, $lte: endOfMonth },
      status: "confirmed",
    }),
  ]);

  const lessonsPerMonth = intern?.lessonsPerMonth || 24;
  const planCompletion = lessonsPerMonth > 0 ? monthlyLessons / lessonsPerMonth : 0;

  return {
    totalLessons,
    monthlyLessons,
    planCompletion,
    rank: 0,
  };
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected\n");

  const interns = await Intern.find();
  console.log(`Found ${interns.length} interns\n`);

  let totalAwarded = 0;

  for (const intern of interns) {
    const stats = await getStats(intern._id, intern);
    const existingKeys = new Set((intern.badges || []).map((b) => b.key));
    const newBadges = [];

    for (const def of BADGE_DEFINITIONS) {
      if (existingKeys.has(def.key)) continue;

      let earned = false;
      try {
        earned = def.check(intern, stats);
      } catch {
        continue;
      }

      if (earned) {
        newBadges.push({
          key: def.key,
          name: def.name.ru,
          icon: def.icon,
          category: def.category,
          earnedAt: new Date(),
        });
      }
    }

    if (newBadges.length > 0) {
      intern.badges.push(...newBadges);
      intern.xp = (intern.xp || 0) + newBadges.length * 20;
      intern.level = Math.floor(Math.sqrt((intern.xp || 0) / 100)) + 1;
      await intern.save();

      const names = newBadges.map((b) => `${b.icon} ${b.name}`).join(", ");
      console.log(`  ${intern.name} ${intern.lastName}: +${newBadges.length} badges (${names}), XP=${intern.xp}, Lv.${intern.level}`);
      totalAwarded += newBadges.length;
    }
  }

  console.log(`\nDone! Awarded ${totalAwarded} badges across ${interns.length} interns.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
