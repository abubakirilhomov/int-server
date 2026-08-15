const mongoose = require("mongoose");
const MonthlyInterview = require("../models/monthlyInterviewModel");
const Intern = require("../models/internModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { startOfTashkentMonth } = require("../utils/tashkentTime");

const isValidObjectId = (id) => mongoose.isValidObjectId(id);
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

// Head internning faol filialini aniqlash
const getHeadInternBranch = (user) => {
  const branchIds = user.branchIds || [];
  return branchIds[0] || null;
};

// ─── Ro'yxat: oylik imtihonlar (faqat head intern filiali) ────────────────────
exports.list = catchAsync(async (req, res, next) => {
  const { month } = req.query;
  const branchId = getHeadInternBranch(req.user);

  if (!branchId) {
    return next(new AppError("Filial topilmadi", 400));
  }

  const filter = { branch: branchId };
  if (month) filter.month = month;

  const interviews = await MonthlyInterview.find(filter)
    .populate("intern", "name lastName grade profilePhoto")
    .sort({ createdAt: -1 });

  res.json({ items: interviews });
});

// ─── Panel status: qizil/sariq/yashil indikator ───────────────────────────────
exports.status = catchAsync(async (req, res) => {
  const { month } = req.query;
  const branchId = getHeadInternBranch(req.user);

  if (!branchId) {
    return res.status(400).json({ message: "Filial topilmadi" });
  }

  const targetMonth = month || new Date().toISOString().slice(0, 7); // "2026-08"

  // Filialdagi barcha faol internlar
  const interns = await Intern.find({
    "branches.branch": branchId,
    status: "active",
    grade: { $ne: "senior" }, // seniorlar imtihon topshirmaydi
  }).select("_id name lastName grade dateJoined probationStartDate createdAt");

  // Shu oydagi imtihonlar
  const interviews = await MonthlyInterview.find({
    branch: branchId,
    month: targetMonth,
  }).lean();

  // Yangi intern aniqlash: imtihon faqat intern qo'shilgandan keyingi oydan boshlanadi.
  // Masalan 31-avg qo'shilgan intern 1-sentabrda "topsirilgan" (exempt) hisoblanadi.
  // Yani: agar intern prev oyning boshidan keyin qo'shilgan bo'lsa (to'liq 1 oy
  // bo'lmagan), u bu oy uchun imtihondan ozod — "passed" ko'rinishida chiqadi.
  const [tgtY, tgtM] = targetMonth.split("-").map(Number);
  const targetMonthStart = startOfTashkentMonth(new Date(Date.UTC(tgtY, tgtM - 1, 1)));
  const prevMonthStart = startOfTashkentMonth(new Date(targetMonthStart.getTime() - 1));

  const byIntern = new Map(interviews.map((iv) => [String(iv.intern), iv]));

  const pending = [];
  const passed = [];
  const failed = [];
  const newInterns = [];

  interns.forEach((intern) => {
    const iv = byIntern.get(String(intern._id));

    // Yangi intern: prev oy boshidan keyin qo'shilgan — bu oy imtihondan ozod
    const joinedAt = intern.dateJoined || intern.probationStartDate || intern.createdAt || targetMonthStart;
    const isNewIntern = joinedAt > prevMonthStart;

    if (iv) {
      if (iv.status === "passed") {
        passed.push({ intern, status: "passed", percentage: iv.percentage });
      } else if (iv.status === "failed") {
        failed.push({ intern, status: "failed", percentage: iv.percentage });
      } else {
        // pending yozuvi mavjud
        pending.push({ intern, status: "pending" });
      }
    } else if (isNewIntern) {
      // Imtihon hali shart emas — "topsirilgan" ko'rinadi
      newInterns.push({ intern, status: "passed", percentage: 100, isNewIntern: true });
    } else {
      pending.push({ intern, status: "pending" });
    }
  });

  const totalInterns = interns.length;

  // Qizil ogohlantirish faqat oyning 1-kunida yonadi.
  // (Oyni ko'rish rejimida: joriy oy + bugun 1-kun bo'lsa)
  const currentMonthStr = new Date().toISOString().slice(0, 7);
  const tashkentNow = new Date(Date.now() + TASHKENT_OFFSET_MS);
  const isFirstOfMonth = tashkentNow.getUTCDate() === 1;
  const viewingCurrentMonth = targetMonth === currentMonthStr;
  const alertNeeded =
    viewingCurrentMonth &&
    isFirstOfMonth &&
    pending.length > 0;

  res.json({
    month: targetMonth,
    totalInterns,
    pending: pending.length,
    passed: passed.length,
    failed: failed.length,
    newInterns: newInterns.length,
    alertNeeded,
    items: [...pending, ...newInterns, ...passed, ...failed],
  });
});

// ─── Imtihon o'tkazish (savollarni saqlash) ───────────────────────────────────
exports.conduct = catchAsync(async (req, res, next) => {
  const { internId, month, questions, resultNote } = req.body;
  const branchId = getHeadInternBranch(req.user);

  if (!isValidObjectId(internId)) {
    return next(new AppError("Nog'ri intern ID", 400));
  }
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return next(new AppError("Oy formatini kiriting (YYYY-MM)", 400));
  }
  if (!Array.isArray(questions) || questions.length < 3) {
    return next(new AppError("Kamida 3 ta savol kiritilishi shart", 400));
  }
  if (!branchId) {
    return next(new AppError("Filial topilmadi", 400));
  }

  // Intern filialda ekanligini tekshirish
  const intern = await Intern.findById(internId);
  if (!intern) return next(new AppError("Intern topilmadi", 404));

  const isInBranch = intern.branches.some(
    (b) => String(b.branch?._id || b.branch) === String(branchId)
  );
  if (!isInBranch) {
    return next(new AppError("Intern bu filialga tegishli emas", 403));
  }

  // Savollarni tozalash
  const cleanQuestions = questions
    .filter((q) => q && typeof q.text === "string" && q.text.trim().length > 0)
    .map((q) => {
      // 3 holatli baholash: correct(10%), partial(5%), wrong(0%)
      // Backward compat: eski isCorrect=true => "correct"
      let result = q.result;
      if (!["correct", "partial", "wrong"].includes(result)) {
        result = q.isCorrect ? "correct" : "wrong";
      }
      return {
        text: q.text.trim(),
        result,
        isCorrect: result === "correct",
        note: (q.note || "").trim(),
      };
    });

  if (cleanQuestions.length < 3) {
    return next(new AppError("Kamida 3 ta to'liq savol kiritilishi shart", 400));
  }

  // Har bir savol: to'g'ri = 10%, chala = 5%, noto'g'ri = 0%
  const SCORE = { correct: 10, partial: 5, wrong: 0 };
  const totalScore = cleanQuestions.reduce((sum, q) => sum + SCORE[q.result], 0);
  const percentage = Math.min(100, Math.round(totalScore));
  const passedCount = cleanQuestions.filter((q) => q.result === "correct").length;
  const partialCount = cleanQuestions.filter((q) => q.result === "partial").length;
  const failedCount = cleanQuestions.filter((q) => q.result === "wrong").length;
  const status = percentage >= 50 ? "passed" : "failed";

  // Upsert: har oyda har bir intern uchun bitta yozuv
  const interview = await MonthlyInterview.findOneAndUpdate(
    { intern: internId, month },
    {
      $set: {
        branch: branchId,
        headIntern: req.user.id || req.user._id,
        status,
        questions: cleanQuestions,
        passedCount,
        failedCount,
        percentage,
        resultNote: (resultNote || "").trim(),
        conductedAt: new Date(),
      },
    },
    { new: true, upsert: true, runValidators: true }
  );

  res.json({
    interview,
    status,
    passedCount,
    partialCount,
    failedCount,
    percentage,
  });
});

// ─── Bitta imtihon ────────────────────────────────────────────────────────────
exports.getOne = catchAsync(async (req, res, next) => {
  if (!isValidObjectId(req.params.id)) {
    return next(new AppError("Nog'ri ID", 400));
  }
  const interview = await MonthlyInterview.findById(req.params.id)
    .populate("intern", "name lastName grade profilePhoto")
    .populate("headIntern", "name lastName");
  if (!interview) return next(new AppError("Imtihon topilmadi", 404));
  res.json(interview);
});

// ─── Intern o'z natijalarini ko'radi ──────────────────────────────────────────
exports.myInterviews = catchAsync(async (req, res) => {
  const internId = req.user.id || req.user._id;
  const interviews = await MonthlyInterview.find({ intern: internId })
    .populate("branch", "name")
    .sort({ month: -1 });
  res.json({ items: interviews });
});