const Lesson = require("../models/lessonModel");
const {
  TASHKENT_OFFSET_MS,
  startOfTashkentDay,
  startOfTashkentMonth,
  startOfNextTashkentMonth,
  tashkentWeekday,
} = require("./tashkentTime");

const DAY_MS = 24 * 60 * 60 * 1000;

// Полуоткрытые границы текущего ташкентского месяца: [start, endExclusive).
// Интерны в UTC+5 — окно должно совпадать с их календарным месяцем, иначе
// уроки у стыка месяца засчитываются не в тот месяц.
const getMonthBounds = (date = new Date()) => ({
  start: startOfTashkentMonth(date),
  endExclusive: startOfNextTashkentMonth(date),
});

const getWeeklyTarget = (lessonsPerMonth = 24) =>
  Math.max(1, Math.ceil(Number(lessonsPerMonth) / 4));

// Кол-во рабочих дней (не воскресений, по Ташкенту) в окне [from, to]
// включительно с обоих концов — как в исходной логике, но в ташкентском
// фрейме. Важно для requiredLessonsByNow, от которого зависит блокировка.
const countWorkingDaysInclusive = (from, to) => {
  let cursor = startOfTashkentDay(from);
  const end = startOfTashkentDay(to);
  if (cursor > end) return 0;

  let count = 0;
  while (cursor <= end) {
    if (tashkentWeekday(cursor) !== 0) count += 1;
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return count;
};

const getCompletedWeeksInMonth = (date = new Date()) => {
  const dayOfMonth = new Date(date.getTime() + TASHKENT_OFFSET_MS).getUTCDate();
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

  // Архивные и замороженные не блокируются по плану в принципе.
  if (intern.status === "archived") {
    return {
      isPlanBlocked: false,
      reason: "Аккаунт архивирован.",
      weeklyTarget: 0,
      completedWeeksInMonth: 0,
      requiredLessonsByNow: 0,
      confirmedLessonsThisMonth: 0,
      deficit: 0,
      isArchived: true,
    };
  }

  if (intern.status === "frozen") {
    const expectedReturn = intern.freezeInfo?.expectedReturn
      ? new Intl.DateTimeFormat("ru-RU", {
          timeZone: "Asia/Tashkent",
          dateStyle: "short",
        }).format(intern.freezeInfo.expectedReturn)
      : null;
    return {
      isPlanBlocked: false,
      reason: expectedReturn
        ? `Аккаунт заморожен. Возвращение: ${expectedReturn}.`
        : "Аккаунт заморожен.",
      weeklyTarget: getWeeklyTarget(intern.lessonsPerMonth),
      completedWeeksInMonth: getCompletedWeeksInMonth(referenceDate),
      requiredLessonsByNow: 0,
      confirmedLessonsThisMonth: 0,
      deficit: 0,
      isFrozen: true,
      freezeStartedAt: intern.freezeInfo?.startedAt || null,
      freezeExpectedReturn: intern.freezeInfo?.expectedReturn || null,
    };
  }

  if (intern.manualActivation?.isEnabled) {
    const enabledAt = intern.manualActivation.enabledAt;
    const stillValid =
      enabledAt &&
      startOfTashkentMonth(new Date(enabledAt)).getTime() ===
        startOfTashkentMonth(referenceDate).getTime();

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

  const { start, endExclusive } = getMonthBounds(referenceDate);
  // Последний момент ташкентского месяца (inclusive) — для подсчёта рабочих дней.
  const end = new Date(endExclusive.getTime() - 1);
  const completedWeeksInMonth = getCompletedWeeksInMonth(referenceDate);
  const weeklyTarget = getWeeklyTarget(intern.lessonsPerMonth);

  const startWorkDate = intern.probationStartDate || intern.dateJoined || intern.createdAt || start;
  const effectiveStart = startWorkDate > start ? startOfTashkentDay(startWorkDate) : start;
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
    date: { $gte: start, $lt: endExclusive },
    status: "confirmed",
  });

  const pendingLessonsCount = await Lesson.countDocuments({
    intern: intern._id,
    date: { $gte: start, $lt: endExclusive },
    status: "pending",
  });

  const bonusLessonsCount = (intern.bonusLessons || [])
    .filter((bonus) => {
      const bonusDate = bonus?.date ? new Date(bonus.date) : null;
      return bonusDate && bonusDate >= start && bonusDate < endExclusive;
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
