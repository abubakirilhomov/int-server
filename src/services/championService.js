const Lesson = require("../models/lessonModel");
const Intern = require("../models/internModel");

async function selectWeeklyChampion() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - mondayOffset);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const results = await Lesson.aggregate([
    {
      $match: {
        date: { $gte: weekStart, $lte: weekEnd },
        status: "confirmed",
      },
    },
    { $group: { _id: "$intern", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 1 },
  ]);

  if (results.length === 0) return null;

  const winner = await Intern.findById(results[0]._id)
    .select("name lastName profilePhoto grade")
    .lean();

  if (!winner) return null;

  return {
    internId: winner._id,
    name: `${winner.name || ""} ${winner.lastName || ""}`.trim(),
    profilePhoto: winner.profilePhoto || "",
    grade: winner.grade,
    lessons: results[0].count,
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
  };
}

async function getCurrentChampion() {
  return selectWeeklyChampion();
}

module.exports = { selectWeeklyChampion, getCurrentChampion };
