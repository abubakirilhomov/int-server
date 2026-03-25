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

const isSunday = (date) => new Date(date).getDay() === 0;

const countWorkingDaysInclusive = (from, to) => {
  const start = startOfDay(from);
  const end = startOfDay(to);
  if (start > end) return 0;

  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    if (!isSunday(cursor)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
};

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

  if (intern.manualActivation?.isEnabled) {
    const enabledAt = intern.manualActivation.enabledAt;
    const stillValid =
      enabledAt &&
      enabledAt.getMonth() === referenceDate.getMonth() &&
      enabledAt.getFullYear() === referenceDate.getFullYear();

    if (stillValid) {
      return {
        isPlanBlocked: false,
        reason: "Аккаунт активирован администратором вручную.",
        weeklyTarget: getWeeklyTarget(intern.lessonsPerMonth),
        completedWeeksInMonth: getCompletedWeeksInMonth(referenceDate),
        requiredLessonsByNow: 0,
        confirmedLessonsThisMonth: 0,
        deficit: 0,
        isManuallyActivated: true,
      };
    }
    // Активация истекла (другой месяц) — продолжаем обычную проверку
  }

  const { start, end } = getMonthBounds(referenceDate);
  const completedWeeksInMonth = getCompletedWeeksInMonth(referenceDate);
  const weeklyTarget = getWeeklyTarget(intern.lessonsPerMonth);

  const startWorkDate = intern.probationStartDate || intern.dateJoined || intern.createdAt || start;
  const effectiveStart = startWorkDate > start ? startOfDay(startWorkDate) : start;
  const effectiveEnd = referenceDate < end ? referenceDate : end;

  const elapsedWorkingDays = countWorkingDaysInclusive(effectiveStart, effectiveEnd);
  const totalWorkingDaysInWindow = countWorkingDaysInclusive(effectiveStart, end);

  const requiredLessonsByNow =
    totalWorkingDaysInWindow > 0
      ? Math.ceil(
          (elapsedWorkingDays / totalWorkingDaysInWindow) *
            Number(intern.lessonsPerMonth || 0)
        )
      : 0;

  const confirmedLessonsCount = await Lesson.countDocuments({
    intern: intern._id,
    date: { $gte: start, $lte: end },
    status: "confirmed",
  });

  const pendingLessonsCount = await Lesson.countDocuments({
    intern: intern._id,
    date: { $gte: start, $lte: end },
    status: "pending",
  });

  const bonusLessonsCount = (intern.bonusLessons || [])
    .filter((bonus) => {
      const bonusDate = bonus?.date ? new Date(bonus.date) : null;
      return bonusDate && bonusDate >= start && bonusDate <= end;
    })
    .reduce((sum, bonus) => sum + (bonus.count || 0), 0);

  const confirmedLessonsThisMonth = confirmedLessonsCount + pendingLessonsCount + bonusLessonsCount;
  const deficit = Math.max(0, requiredLessonsByNow - confirmedLessonsThisMonth);
  // Блокировка только если прошло больше 3 рабочих дней с начала периода
  const isPlanBlocked = elapsedWorkingDays > 3 && requiredLessonsByNow > 0 && deficit > 0;

  return {
    isPlanBlocked,
    reason: isPlanBlocked
      ? `План к текущей дате отстаёт на ${deficit} урок(а/ов).`
      : "",
    weeklyTarget,
    completedWeeksInMonth,
    requiredLessonsByNow,
    confirmedLessonsThisMonth,
    confirmedLessonsCount,
    pendingLessonsCount,
    deficit,
    isManuallyActivated: false,
    elapsedWorkingDays,
    totalWorkingDaysInWindow,
  };
}

module.exports = {
  getInternPlanStatus,
};
