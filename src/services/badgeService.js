const Intern = require("../models/internModel");
const Lesson = require("../models/lessonModel");
const BADGE_DEFINITIONS = require("../config/badges");

async function getInternStats(internId) {
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

  const intern = await Intern.findById(internId).lean();
  const lessonsPerMonth = intern?.lessonsPerMonth || 24;
  const planCompletion = lessonsPerMonth > 0 ? monthlyLessons / lessonsPerMonth : 0;

  // Rank (score bo'yicha) — top_3 badge uchun. Buzilgan edi (doim 0), shuning
  // uchun reytingdagi o'rinni score bo'yicha sanaymiz.
  const rank = intern
    ? (await Intern.countDocuments({
        status: { $nin: ["frozen", "archived"] },
        score: { $gt: intern.score || 0 },
      })) + 1
    : 0;

  return {
    totalLessons,
    monthlyLessons,
    planCompletion,
    rank,
  };
}

async function checkAndAwardBadges(internId) {
  const intern = await Intern.findById(internId);
  if (!intern) return { newBadges: [] };
  if (intern.status !== "active") return { newBadges: [] };

  const stats = await getInternStats(internId);
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
      const badge = {
        key: def.key,
        name: def.name.ru,
        icon: def.icon,
        category: def.category,
        points: def.points || 1,
        earnedAt: new Date(),
      };
      intern.badges.push(badge);
      newBadges.push({ ...badge, nameUz: def.name.uz });
    }
  }

  if (newBadges.length > 0) {
    // XP badge qiyinligiga (points) mutanosib beriladi — oddiy va og'ir
    // yutuqlar endi bir xil vazn bermaydi.
    const earnedPoints = newBadges.reduce((sum, b) => sum + (b.points || 1), 0);
    intern.xp = (intern.xp || 0) + earnedPoints * 10;
    intern.level = Math.floor(Math.sqrt((intern.xp || 0) / 100)) + 1;
    await intern.save();
  }

  return { newBadges };
}

async function getAllBadgeStatuses(internId) {
  const intern = await Intern.findById(internId).lean();
  if (!intern) return [];

  const earnedKeys = new Set((intern.badges || []).map((b) => b.key));

  return BADGE_DEFINITIONS.map((def) => ({
    key: def.key,
    name: def.name,
    icon: def.icon,
    description: def.description,
    category: def.category,
    points: def.points || 1,
    earned: earnedKeys.has(def.key),
    earnedAt: (intern.badges || []).find((b) => b.key === def.key)?.earnedAt || null,
  }));
}

module.exports = { checkAndAwardBadges, getAllBadgeStatuses };
