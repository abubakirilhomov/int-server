const mongoose = require("mongoose");

const Interview = require("../models/interviewModel");
const Application = require("../models/applicationModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { googleCalendarLink } = require("../utils/calendarLink");
const { SPHERE_LABELS } = require("../services/telegramService");
const InterviewTopic = require("../models/interviewTopicModel");
const Setting = require("../models/settingModel");
const { computeScore } = require("../utils/scoreInterview");
const { buildLetters } = require("../utils/roadmapLetter");

const isValidObjectId = (id) => mongoose.isValidObjectId(id);

// Трек по сфере заявки (владелец принимает только frontend-react и backend-nodejs).
const sphereToTrack = (sphere) =>
  sphere === "backend-nodejs" ? "backend-nodejs" : "frontend-react";

const TRACK_LABELS = {
  "frontend-react": "Frontend (React)",
  "backend-nodejs": "Backend (Node.js)",
};

// Собирает deep-link и человекочитаемые поля для одного интервью с
// популированной заявкой.
const decorate = (interview) => {
  const obj = interview.toObject ? interview.toObject() : interview;
  const app = obj.application || {};
  const teacher = app.mentor
    ? `${app.mentor.name || ""} ${app.mentor.lastName || ""}`.trim()
    : "";
  const candidate = `${app.firstName || ""} ${app.lastName || ""}`.trim();
  const trackLabel = TRACK_LABELS[obj.track] || obj.track;

  const detailLines = [
    candidate && `Кандидат: ${candidate}${app.age ? `, ${app.age} лет` : ""}`,
    app.phone && `Телефон: ${app.phone}`,
    app.parentPhone && `Телефон родителя: ${app.parentPhone}`,
    app.telegramUsername && `Telegram: @${app.telegramUsername}`,
    teacher && `Учитель: ${teacher}`,
    `Направление: ${trackLabel}`,
    app.monthsAtMars != null && `В Mars: ${app.monthsAtMars} мес`,
  ].filter(Boolean);

  const calendarLink = googleCalendarLink({
    title: `Собес: ${candidate || "кандидат"} (${trackLabel})`,
    start: obj.scheduledAt,
    durationMinutes: 45,
    details: detailLines.join("\n"),
    location: app.branch?.name || "",
  });

  return { ...obj, calendarLink };
};

const populateApplication = (query) =>
  query
    .populate({
      path: "application",
      select:
        "firstName lastName phone parentPhone telegramUsername age sphere monthsAtMars schoolNumber branch mentor cooldownUntil convertedToIntern status",
      populate: [
        { path: "mentor", select: "name lastName" },
        { path: "branch", select: "name" },
      ],
    })
    .populate("interviewer", "name lastName");

// ─── ADMIN: запланировать собеседование ───────────────────────────────────────
exports.schedule = catchAsync(async (req, res, next) => {
  const { applicationId, scheduledAt, track, interviewer } = req.body;

  if (!isValidObjectId(applicationId)) {
    return next(new AppError("Некорректный ID заявки", 400));
  }
  const when = new Date(scheduledAt);
  if (!scheduledAt || isNaN(when)) {
    return next(new AppError("Укажите корректную дату/время собеседования", 400));
  }

  const app = await Application.findById(applicationId);
  if (!app) return next(new AppError("Заявка не найдена", 404));
  if (app.convertedToIntern) {
    return next(new AppError("Кандидат уже стал интерном", 409));
  }

  // Гард кулдауна: пересдача заблокирована до cooldownUntil.
  if (app.cooldownUntil && when < new Date(app.cooldownUntil)) {
    const until = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Asia/Tashkent",
      dateStyle: "short",
    }).format(new Date(app.cooldownUntil));
    return next(
      new AppError(`Пересдача доступна только после ${until} (кулдаун).`, 400)
    );
  }

  const priorCount = await Interview.countDocuments({ application: app._id });

  const interview = await Interview.create({
    application: app._id,
    track: track || sphereToTrack(app.sphere),
    scheduledAt: when,
    interviewer: isValidObjectId(interviewer) ? interviewer : app.mentor,
    attemptNumber: priorCount + 1,
    status: "scheduled",
    createdBy: req.user.id || req.user._id,
  });

  app.status = "interview_scheduled";
  app.interviewDate = when;
  app.lastInterviewAt = when;
  app.reviewedBy = req.user.id || req.user._id;
  app.reviewedAt = new Date();
  await app.save();

  const full = await populateApplication(Interview.findById(interview._id));
  res.status(201).json(decorate(full));
});

// ─── ADMIN: список (доска Сегодня/Скоро) ──────────────────────────────────────
exports.list = catchAsync(async (req, res) => {
  const { from, to, status, track, q } = req.query;
  const filter = {};

  if (status) filter.status = { $in: String(status).split(",").map((s) => s.trim()) };
  if (track) filter.track = track;
  if (from || to) {
    filter.scheduledAt = {};
    if (from) filter.scheduledAt.$gte = new Date(from);
    if (to) filter.scheduledAt.$lte = new Date(to);
  }

  let interviews = await populateApplication(
    Interview.find(filter).sort({ scheduledAt: 1 })
  );

  // Текстовый поиск по кандидату/телефону/телеграму (после populate).
  if (q) {
    const re = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    interviews = interviews.filter((iv) => {
      const a = iv.application || {};
      return (
        re.test(`${a.firstName || ""} ${a.lastName || ""}`) ||
        re.test(a.phone || "") ||
        re.test(a.telegramUsername || "")
      );
    });
  }

  res.json({ items: interviews.map(decorate), total: interviews.length });
});

// ─── ADMIN: одно интервью ─────────────────────────────────────────────────────
exports.getOne = catchAsync(async (req, res, next) => {
  if (!isValidObjectId(req.params.id)) return next(new AppError("Некорректный ID", 400));
  const interview = await populateApplication(Interview.findById(req.params.id));
  if (!interview) return next(new AppError("Собеседование не найдено", 404));
  res.json(decorate(interview));
});

// ─── ADMIN: статус (no_show / canceled / completed) ───────────────────────────
exports.updateStatus = catchAsync(async (req, res, next) => {
  if (!isValidObjectId(req.params.id)) return next(new AppError("Некорректный ID", 400));
  const { status } = req.body;
  if (!Interview.STATUSES.includes(status)) {
    return next(new AppError("Недопустимый статус", 400));
  }

  const interview = await Interview.findById(req.params.id);
  if (!interview) return next(new AppError("Собеседование не найдено", 404));

  interview.status = status;
  if (status === "completed" && !interview.conductedAt) {
    interview.conductedAt = new Date();
  }
  await interview.save();

  // Синхронизируем статус заявки для no_show.
  if (status === "no_show") {
    await Application.findByIdAndUpdate(interview.application, { status: "no_show" });
  }

  const full = await populateApplication(Interview.findById(interview._id));
  res.json(decorate(full));
});

// ─── ADMIN: перенос времени ───────────────────────────────────────────────────
exports.reschedule = catchAsync(async (req, res, next) => {
  if (!isValidObjectId(req.params.id)) return next(new AppError("Некорректный ID", 400));
  const when = new Date(req.body.scheduledAt);
  if (!req.body.scheduledAt || isNaN(when)) {
    return next(new AppError("Укажите корректную дату/время", 400));
  }

  const interview = await Interview.findById(req.params.id);
  if (!interview) return next(new AppError("Собеседование не найдено", 404));

  const app = await Application.findById(interview.application);
  if (app?.cooldownUntil && when < new Date(app.cooldownUntil)) {
    return next(new AppError("Дата раньше окончания кулдауна.", 400));
  }

  interview.scheduledAt = when;
  interview.status = "scheduled";
  await interview.save();

  if (app) {
    app.interviewDate = when;
    app.lastInterviewAt = when;
    if (app.status !== "interview_scheduled") app.status = "interview_scheduled";
    await app.save();
  }

  const full = await populateApplication(Interview.findById(interview._id));
  res.json(decorate(full));
});

// ─── ADMIN: оценка собеседования (банк тем + автоподсчёт + письмо) ─────────────
exports.score = catchAsync(async (req, res, next) => {
  if (!isValidObjectId(req.params.id)) return next(new AppError("Некорректный ID", 400));
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return next(new AppError("Нет оценок по темам", 400));
  }

  const interview = await Interview.findById(req.params.id);
  if (!interview) return next(new AppError("Собеседование не найдено", 404));

  const app = await Application.findById(interview.application);
  if (!app) return next(new AppError("Заявка не найдена", 404));

  const settingDoc = await Setting.findOne({ key: "interviewSettings" }).lean();
  const cfg = settingDoc?.value || {};
  const threshold = Number(cfg.passThreshold ?? 80);
  const partialCredit = Number(cfg.partialCredit ?? 0.5);
  const cooldownDays = Number(cfg.cooldownDays ?? 7);

  const topicIds = items.map((i) => i.topicId).filter(isValidObjectId);
  const topics = await InterviewTopic.find({ _id: { $in: topicIds } }).lean();
  const byId = new Map(topics.map((t) => [String(t._id), t]));

  const result = computeScore(items, byId, { partialCredit, threshold });
  if (result.total === 0) {
    return next(new AppError("Не найдено ни одной валидной темы", 400));
  }

  interview.items = result.snapItems;
  interview.scoreEarned = result.earned;
  interview.scoreTotal = result.total;
  interview.percentage = result.percentage;
  interview.passed = result.passed;
  interview.roadmap = result.roadmap;
  interview.status = "completed";
  interview.conductedAt = new Date();
  interview.cooldownUntil = result.passed
    ? null
    : new Date(Date.now() + cooldownDays * 86400000);
  await interview.save();

  app.lastInterviewAt = new Date();
  app.cooldownUntil = result.passed ? null : interview.cooldownUntil;
  await app.save();

  const letter = buildLetters({
    candidateName: `${app.firstName || ""} ${app.lastName || ""}`.trim(),
    earned: result.earned,
    total: result.total,
    percentage: result.percentage,
    passed: result.passed,
    roadmap: result.roadmap,
    roadmapUz: result.roadmapUz,
    cooldownUntil: interview.cooldownUntil,
    threshold,
  });

  const full = await populateApplication(Interview.findById(interview._id));
  res.json({ interview: decorate(full), letter });
});

// ─── ADMIN: письмо по уже оценённому собесу (для повторной отправки/ассистента) ──
exports.letter = catchAsync(async (req, res, next) => {
  if (!isValidObjectId(req.params.id)) return next(new AppError("Некорректный ID", 400));

  const interview = await Interview.findById(req.params.id).populate(
    "application",
    "firstName lastName telegramUsername parentPhone cooldownUntil"
  );
  if (!interview) return next(new AppError("Собеседование не найдено", 404));
  if (interview.passed === null || interview.status !== "completed") {
    return next(new AppError("Собеседование ещё не оценено", 400));
  }

  const app = interview.application || {};
  const settingDoc = await Setting.findOne({ key: "interviewSettings" }).lean();
  const threshold = Number(settingDoc?.value?.passThreshold ?? 80);

  // UZ roadmap из снапшота тем (label), RU — из сохранённого interview.roadmap (labelRu).
  const roadmapUz = (interview.items || [])
    .filter((i) => i.result !== "pass")
    .map((i) => i.label || i.labelRu);

  const letter = buildLetters({
    candidateName: `${app.firstName || ""} ${app.lastName || ""}`.trim(),
    earned: interview.scoreEarned,
    total: interview.scoreTotal,
    percentage: interview.percentage,
    passed: interview.passed,
    roadmap: interview.roadmap,
    roadmapUz,
    cooldownUntil: interview.cooldownUntil,
    threshold,
  });

  res.json({
    letter,
    passed: interview.passed,
    percentage: interview.percentage,
    recipient: {
      firstName: app.firstName || "",
      lastName: app.lastName || "",
      telegramUsername: app.telegramUsername || "",
      parentPhone: app.parentPhone || "",
    },
  });
});
