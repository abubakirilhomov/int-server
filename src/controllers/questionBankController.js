// Банк вопросов — админский просмотр (этап 1; редактирование — этап 6).
// Отдаёт ответы-черновики: роуты только auth + isAdmin.
const BankQuestion = require("../models/bankQuestionModel");
const InterviewSet = require("../models/interviewSetModel");
const catchAsync = require("../utils/catchAsync");

exports.listQuestions = catchAsync(async (req, res) => {
  const filter = {};
  if (req.query.track) filter.tracks = String(req.query.track);
  if (req.query.topic) filter.topic = String(req.query.topic);
  if (req.query.level) filter.level = String(req.query.level);
  if (req.query.active !== "all") filter.isActive = true;
  const questions = await BankQuestion.find(filter)
    .select("+expectedAnswer")
    .sort({ topic: 1, order: 1 })
    .lean();
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
  const [byTopic, sets] = await Promise.all([
    BankQuestion.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$topic", count: { $sum: 1 }, practical: { $sum: { $cond: ["$isPractical", 1, 0] } } } },
    ]),
    InterviewSet.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: { track: "$track", size: "$size" }, count: { $sum: 1 } } },
    ]),
  ]);
  const topics = Object.fromEntries(byTopic.map((t) => [t._id, t.count]));
  res.json({
    questions: byTopic.reduce((s, t) => s + t.count, 0),
    practical: byTopic.reduce((s, t) => s + t.practical, 0),
    topics,
    sets: sets.map((s) => ({ track: s._id.track, size: s._id.size, count: s.count })),
  });
});
