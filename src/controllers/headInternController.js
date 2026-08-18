const mongoose = require("mongoose");
const Intern = require("../models/internModel");
const Lesson = require("../models/lessonModel");
const Rule = require("../models/rulesModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { tashkentMonthBounds, startOfTashkentDay } = require("../utils/tashkentTime");
const { computePenalties, buildRuleMap } = require("../utils/penaltyUtils");

const getHeadInternBranch = (user) => {
  const branchIds = user.branchIds || [];
  return branchIds[0] || null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Internlar aktivligi (faqat head intern filiali) ──────────────────────────
exports.getInternsActivity = catchAsync(async (req, res, next) => {
  const branchId = getHeadInternBranch(req.user);
  const headInternId = String(req.user.id || req.user._id);

  if (!branchId) {
    return next(new AppError("Filial topilmadi", 400));
  }

  const now = new Date();
  const { start: startOfMonth, endExclusive: endOfMonth } = tashkentMonthBounds(now);

  // Fetch all rules once to build a ruleId → category map for penalty computation.
  const allRules = await Rule.find({}).select("category").lean();
  const ruleMap = buildRuleMap(allRules);

  // Filialdagi barcha faol internlar — head internning o'zi chiqarib tashlanadi
  const interns = await Intern.find({
    "branches.branch": branchId,
    status: "active",
    _id: { $ne: headInternId },
  })
    .select("_id name lastName grade score lessonsPerMonth lastLessonDate currentStreak xp level branches violations violationsCount lastViolationAt telegram")
    .lean();

  // Shu oydagi darslar (filialdagi barcha internlar uchun)
  const internIds = interns.map((i) => i._id);
  const lessons = await Lesson.find({
    intern: { $in: internIds },
    date: { $gte: startOfMonth, $lt: endOfMonth },
  })
    .select("intern status date")
    .lean();

  // Intern bo'yicha darslarni guruhlash
  const lessonCounts = {};
  const lessonDates = {};
  lessons.forEach((l) => {
    const key = String(l.intern);
    if (!lessonCounts[key]) {
      lessonCounts[key] = { confirmed: 0, pending: 0, total: 0 };
      lessonDates[key] = new Set();
    }
    lessonCounts[key].total += 1;
    if (l.status === "confirmed") {
      lessonCounts[key].confirmed += 1;
      if (l.date) {
        const dayKey = startOfTashkentDay(new Date(l.date)).getTime();
        lessonDates[key].add(dayKey);
      }
    } else if (l.status === "pending") {
      lessonCounts[key].pending += 1;
    }
  });

  // Oy boshidan o'tgan kunlar soni (Toshkent vaqti bo'yicha)
  const todayStart = startOfTashkentDay(now);
  const monthStartDay = startOfTashkentDay(startOfMonth);
  const daysElapsed = Math.max(1, Math.round((todayStart - monthStartDay) / DAY_MS) + 1);

  // Aktivlik: kunlik o'rtacha dars + oxirgi faollik (grade'ga bog'liq EMAS)
  // - Kuniga o'rtacha >= 2 dars va yaqinda faol → 🟢 Yuqori
  // - Kuniga o'rtacha 0.5–2 dars yoki ozgina sekinlashgan → 🟡 O'rtacha
  // - Kuniga o'rtacha < 0.5 yoki uzoq vaqt nofaol → 🔴 Past (nofaol)
  const activityList = interns.map((intern) => {
    const key = String(intern._id);
    const stats = lessonCounts[key] || { confirmed: 0, pending: 0, total: 0 };
    const uniqueActiveDays = lessonDates[key]?.size || 0;

    // Kunlik o'rtacha: oy boshidan o'tgan kunlarga nisbatan
    const dailyAverage = stats.confirmed / daysElapsed;

    // Oxirgi faollik: necha kun oldin darsga kelgan
    const lastDate = intern.lastLessonDate || null;
    let daysSinceLastLesson = null;
    if (lastDate) {
      const lastDayStart = startOfTashkentDay(new Date(lastDate));
      daysSinceLastLesson = Math.max(0, Math.round((todayStart - lastDayStart) / DAY_MS));
    }

    // Aktivlik darajasini aniqlash:
    let activityLevel = "low";
    let activityReason = "";

    if (stats.confirmed === 0) {
      activityLevel = "low";
      activityReason = daysSinceLastLesson === null || daysSinceLastLesson > 14
        ? "Nofaol — hali bu oyda darsga kelmagan"
        : "Bu oy hali darsga kelmagan";
    } else if (daysSinceLastLesson !== null && daysSinceLastLesson > 14) {
      activityLevel = "low";
      activityReason = "Uzoq vaqt nofaol (14+ kun darsga kelmagan)";
    } else if (dailyAverage >= 2) {
      activityLevel = "high";
      activityReason = "Kuniga o'rtacha 2+ dars";
    } else if (dailyAverage >= 0.5) {
      activityLevel = "medium";
      activityReason = "Kuniga o'rtacha 0.5–2 dars";
    } else {
      activityLevel = "low";
      activityReason = "Kuniga o'rtacha 0.5 dan kam dars";
    }

    // Aktivlik foizi: kunlik o'rtacha 2 dars = 100%
    const activityPercent = Math.min(100, Math.round((dailyAverage / 2) * 100));

    // 🔹 Shtraf ma'lumotlari: boshqaruv panelida ko'rsatish uchun
    const penaltyInfo = computePenalties(intern.violations || [], ruleMap);

    return {
      _id: intern._id,
      name: intern.name,
      lastName: intern.lastName,
      grade: intern.grade,
      score: intern.score || 0,
      isSenior: intern.grade === "senior",
      lessonsThisMonth: stats.confirmed,
      lessonsPending: stats.pending,
      telegram: intern.telegram || "",
      uniqueActiveDays,
      // Kunlik ortalama darslar soni butun son bo'ladi.
      // 0.5 dan 1 gacha 1, 1.5 dan esa 2 deb hisoblanadi.
      dailyAverage: dailyAverage > 0 ? Math.max(1, Math.round(dailyAverage)) : 0,
      daysSinceLastLesson,
      lessonsTarget: 0,
      activityPercent,
      activityLevel,
      activityReason,
      lastLessonDate: intern.lastLessonDate || null,
      currentStreak: intern.currentStreak || 0,
      xp: intern.xp || 0,
      level: intern.level || 1,
      // 🔹 Shtraf: jami son, eng yomon daraja, kategoriya bo'yicha sonlar
      violationsCount: intern.violationsCount || 0,
      lastViolationAt: intern.lastViolationAt || null,
      penaltyInfo,
    };
  });

  // Saralash: aktivlik foizi bo'yicha (yuqoridan pastga — eng faol tepada)
  activityList.sort((a, b) => b.activityPercent - a.activityPercent);

  const summary = {
    totalInterns: activityList.length,
    highActivity: activityList.filter((i) => i.activityLevel === "high").length,
    mediumActivity: activityList.filter((i) => i.activityLevel === "medium").length,
    lowActivity: activityList.filter((i) => i.activityLevel === "low").length,
  };

  res.json({ interns: activityList, summary });
});

// ─── Head intern: o'z filialidagi internlar (qisqa ro'yxat) ──────────────────
exports.getBranchInterns = catchAsync(async (req, res, next) => {
  const branchId = getHeadInternBranch(req.user);

  if (!branchId) {
    return next(new AppError("Filial topilmadi", 400));
  }

  // Fetch all rules once to build a ruleId → category map for penalty computation.
  const allRules = await Rule.find({}).select("category").lean();
  const ruleMap = buildRuleMap(allRules);

  const interns = await Intern.find({
    "branches.branch": branchId,
    status: "active",
  })
    .select("_id name lastName grade profilePhoto violations violationsCount lastViolationAt")
    .sort({ name: 1 })
    .lean();

  // 🔹 Har bir internga shtraf ma'lumotlarini qo'shish
  const internsWithPenalties = interns.map((intern) => {
    const penaltyInfo = computePenalties(intern.violations || [], ruleMap);
    return {
      _id: intern._id,
      name: intern.name,
      lastName: intern.lastName,
      grade: intern.grade,
      profilePhoto: intern.profilePhoto || "",
      violationsCount: intern.violationsCount || 0,
      lastViolationAt: intern.lastViolationAt || null,
      penaltyInfo,
    };
  });

  res.json(internsWithPenalties);
});
