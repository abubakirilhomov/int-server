const Lesson = require("../models/lessonModel");
const Intern = require("../models/internModel");

const isSunday = (d) => new Date(d).getDay() === 0;

const toDateKey = (d) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

const prevWorkingDay = (d) => {
  const dt = new Date(d);
  dt.setDate(dt.getDate() - 1);
  while (isSunday(dt)) dt.setDate(dt.getDate() - 1);
  return dt;
};

async function updateStreak(internId) {
  const internQuery = Intern.findById(internId);
  const intern = internQuery?.select
    ? await internQuery.select("status currentStreak longestStreak")
    : await internQuery;
  if (intern?.status && intern.status !== "active") {
    return {
      current: intern.currentStreak || 0,
      longest: intern.longestStreak || 0,
      skipped: true,
    };
  }

  const now = new Date();
  const lookback = new Date(now);
  lookback.setDate(lookback.getDate() - 90);

  const lessons = await Lesson.find({
    intern: internId,
    date: { $gte: lookback },
  })
    .select("date")
    .sort({ date: -1 })
    .lean();

  if (lessons.length === 0) {
    await Intern.findByIdAndUpdate(internId, {
      currentStreak: 0,
      lastLessonDate: null,
    });
    return { current: 0, longest: 0 };
  }

  const daySet = new Set(lessons.map((l) => toDateKey(l.date)));

  let streak = 0;
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);

  // If today has no lesson, start from previous working day
  if (!daySet.has(toDateKey(cursor))) {
    const prev = prevWorkingDay(cursor);
    cursor.setTime(prev.getTime());
  }

  while (true) {
    if (isSunday(cursor)) {
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    if (daySet.has(toDateKey(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  const longest = Math.max(intern?.longestStreak || 0, streak);

  await Intern.findByIdAndUpdate(internId, {
    currentStreak: streak,
    longestStreak: longest,
    lastLessonDate: lessons[0].date,
  });

  return { current: streak, longest };
}

async function resetStaleStreaks() {
  const now = new Date();
  const yesterday = prevWorkingDay(now);
  yesterday.setHours(23, 59, 59, 999);

  // Замороженным/архивным streak не сбрасываем: после разморозки они смогут
  // продолжить с того места, где остановились (текущий streak важно сохранить
  // как достижение, даже если активно прогрессировать его сейчас нельзя).
  const result = await Intern.updateMany(
    {
      currentStreak: { $gt: 0 },
      status: "active",
      $or: [
        { lastLessonDate: { $lt: yesterday } },
        { lastLessonDate: null },
      ],
    },
    { $set: { currentStreak: 0 } }
  );

  return result.modifiedCount;
}

module.exports = { updateStreak, resetStaleStreaks };
