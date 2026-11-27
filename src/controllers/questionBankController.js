// Банк вопросов — админский просмотр (этап 1; редактирование — этап 6).
// Отдаёт ответы-черновики и исправленные сцены (demoFix): роуты только auth + isAdmin.
const BankQuestion = require("../models/bankQuestionModel");
const InterviewSet = require("../models/interviewSetModel");
const catchAsync = require("../utils/catchAsync");
const { translationStatus } = require("../utils/questionBank/i18n");
const { translationStats } = require("../services/questionTranslations");
const { interviewModes } = require("../services/candidateInterviewMode");

exports.listQuestions = catchAsync(async (req, res) => {
  const filter = {};
  if (req.query.track) filter.tracks = String(req.query.track);
  if (req.query.topic) filter.topic = String(req.query.topic);
  if (req.query.level) filter.level = String(req.query.level);
  if (req.query.active !== "all") filter.isActive = true;
  const questions = await BankQuestion.find(filter)
    .select("+expectedAnswer +expectedAnswerRu +options.correct +demoFix")
    .sort({ topic: 1, order: 1 })
    .lean();
  questions.forEach((q) => { q.ruStatus = translationStatus(q); });
  res.json({ count: questions.length, questions });
});

exports.listSets = catchAsync(async (req, res) => {
  const filter = {};
  if (req.query.track) filter.track = String(req.query.track);
  const sets = await InterviewSet.find(filter).sort({ track: 1, number: 1 }).lean();
  res.json({ count: sets.length, sets });
});

// Сводка без текста вопросов — для смоков и дашборда.
exports.stats = catchAsync(async (req, res) => {
  const [byTopic, sets, translations, modes, demos] = await Promise.all([
    BankQuestion.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$topic", count: { $sum: 1 }, practical: { $sum: { $cond: ["$isPractical", 1, 0] } } } },
    ]),
    InterviewSet.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: { track: "$track", size: "$size" }, count: { $sum: 1 } } },
    ]),
    translationStats(),
    interviewModes(),
    BankQuestion.aggregate([
      { $match: { isActive: true, "demo.html": { $exists: true, $ne: "" } } },
      { $group: { _id: { $ifNull: ["$demo.audience", "candidate"] }, count: { $sum: 1 } } },
    ]),
  ]);
  const topics = Object.fromEntries(byTopic.map((t) => [t._id, t.count]));
  res.json({
    questions: byTopic.reduce((s, t) => s + t.count, 0),
    practical: byTopic.reduce((s, t) => s + t.practical, 0),
    topics,
    sets: sets.map((s) => ({ track: s._id.track, size: s._id.size, count: s.count })),
    translations, // { ok, stale, missing } — русский перевод
    modes, // трек → "live" (есть наборы) | "checklist"
    demos: Object.fromEntries(demos.map((d) => [d._id, d.count])), // живые сцены: candidate / interviewer
  });
});
