const Lesson = require("../models/lessonModel");

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

const getMonthBounds = (date = new Date()) => {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start: startOfDay(start), end: endOfDay(end) };
};

const getWeeklyTarget = (lessonsPerMonth = 24) =>
  Math.max(1, Math.ceil(Number(lessonsPerMonth) / 4));

const getCompletedWeeksInMonth = (date = new Date()) => {
  const dayOfMonth = date.getDate();
  const currentWeekIndex = Math.ceil(dayOfMonth / 7);
  return Math.max(0, currentWeekIndex - 1);
};

async function getInternPlanStatus(intern, referenceDate = new Date()) {
  if (!intern) {
    return {
      isPlanBlocked: false,
      reason: "",
      weeklyTarget: 0,
      completedWeeksInMonth: 0,
      requiredLessonsByNow: 0,
      confirmedLessonsThisMonth: 0,
      deficit: 0,
    };
  }

  const { start, end } = getMonthBounds(referenceDate);
  const completedWeeksInMonth = getCompletedWeeksInMonth(referenceDate);
  const weeklyTarget = getWeeklyTarget(intern.lessonsPerMonth);
  const requiredLessonsByNow = completedWeeksInMonth * weeklyTarget;

  const confirmedLessonsCount = await Lesson.countDocuments({
    intern: intern._id,
    date: { $gte: start, $lte: end },
    $or: [{ status: "confirmed" }, { status: { $exists: false }, isRated: true }],
  });

  const bonusLessonsCount = (intern.bonusLessons || [])
    .filter((bonus) => {
      const bonusDate = bonus?.date ? new Date(bonus.date) : null;
      return bonusDate && bonusDate >= start && bonusDate <= end;
    })
    .reduce((sum, bonus) => sum + (bonus.count || 0), 0);

  const confirmedLessonsThisMonth = confirmedLessonsCount + bonusLessonsCount;
  const deficit = Math.max(0, requiredLessonsByNow - confirmedLessonsThisMonth);
  const isPlanBlocked = requiredLessonsByNow > 0 && deficit > 0;

  return {
    isPlanBlocked,
    reason: isPlanBlocked
      ? `План за текущий месяц отстаёт на ${deficit} урок(а/ов).`
      : "",
    weeklyTarget,
    completedWeeksInMonth,
    requiredLessonsByNow,
    confirmedLessonsThisMonth,
    deficit,
  };
}

module.exports = {
  getInternPlanStatus,
};
