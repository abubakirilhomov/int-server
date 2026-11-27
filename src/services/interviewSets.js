// Наборы для живых собеседований: ротация, генерация, учёт «кому какой достался».
// «Кто какой набор взял» отдельно не хранится — это InterviewSession.set.
const mongoose = require("mongoose");
const InterviewSet = require("../models/interviewSetModel");
const InterviewSession = require("../models/interviewSessionModel");
const Interview = require("../models/interviewModel");
const BankQuestion = require("../models/bankQuestionModel");
const Setting = require("../models/settingModel");
const { generateSet } = require("../utils/questionBank/generateSet");

// Коды вопросов из прошлых живых попыток этого кандидата (пересдача).
async function priorCodesOfApplication(applicationId, exceptInterviewId) {
  if (!applicationId) return new Set();
  const ivs = await Interview.find({ application: applicationId, _id: { $ne: exceptInterviewId } })
    .select("_id").lean();
  if (!ivs.length) return new Set();
  const sessions = await InterviewSession.find({ interview: { $in: ivs.map((i) => i._id) } })
    .select("questions.code").lean();
  return new Set(sessions.flatMap((s) => (s.questions || []).map((q) => q.code)));
}

// Последние N сессий трека: их наборы и вопросы не предлагаем.
async function recentOfTrack(track, n) {
  const sessions = await InterviewSession.find({ track })
    .sort({ createdAt: -1 }).limit(Math.max(0, n)).select("set questions.code").lean();
  return {
    setIds: new Set(sessions.map((s) => String(s.set)).filter((x) => x !== "null")),
    codes: new Set(sessions.flatMap((s) => (s.questions || []).map((q) => q.code))),
  };
}

// Сколько раз и когда последний раз брали каждый набор трека.
async function usageBySet(track) {
  const rows = await InterviewSession.aggregate([
    { $match: { track, set: { $ne: null } } },
    { $group: { _id: "$set", count: { $sum: 1 }, lastUsedAt: { $max: "$createdAt" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r]));
}

/**
 * Наборы трека с учётом и предложение «следующий по ротации»:
 * не из последних N собеседований трека → при пересдаче меньше пересечение
 * с прошлыми вопросами кандидата → реже использованный → меньший номер
 * (наборы 1–5 из docx идут первыми).
 */
async function suggestSets({ track, applicationId, interviewId, avoidRecent = 3 }) {
  const [sets, usage, recent, prior] = await Promise.all([
    InterviewSet.find({ track, isActive: true, size: { $gt: 0 } }).sort({ number: 1 }).lean(),
    usageBySet(track),
    recentOfTrack(track, avoidRecent),
    priorCodesOfApplication(applicationId, interviewId),
  ]);
  const list = sets.map((s) => {
    const u = usage.get(String(s._id));
    return {
      _id: s._id,
      number: s.number,
      source: s.source,
      size: s.size,
      questionCodes: s.questionCodes,
      usedCount: u?.count || 0,
      lastUsedAt: u?.lastUsedAt || null,
      recent: recent.setIds.has(String(s._id)),
      overlap: s.questionCodes.filter((c) => prior.has(c)).length,
    };
  });
  const ranked = list.slice().sort((a, b) =>
    Number(a.recent) - Number(b.recent) || a.overlap - b.overlap ||
    a.usedCount - b.usedCount || a.number - b.number
  );
  return { sets: list, suggestedSetId: ranked[0]?._id || null };
}

async function loadRules() {
  const doc = await Setting.findOne({ key: "questionBankRules" }).lean();
  return doc?.value || null;
}

// Набор по правилу без сохранения (предпросмотр) — коды + мягкие нарушения.
async function previewGenerated({ track, size, applicationId, interviewId, avoidRecent = 3, rng }) {
  const [questions, rules, recent, prior] = await Promise.all([
    BankQuestion.find({ tracks: track, isActive: true })
      .select("code topic tracks level isPractical isMiniTask conflictGroup order isActive").lean(),
    loadRules(),
    recentOfTrack(track, avoidRecent),
    priorCodesOfApplication(applicationId, interviewId),
  ]);
  return generateSet({ questions, track, size, rules, exclude: [...recent.codes, ...prior], rng });
}

// Сохранить набор (сгенерированный или собранный вручную). Состав по уровням
// проверяет InterviewSet pre-validate — неверный набор не сохранится.
async function saveSet({ track, questionCodes, source, updatedBy }) {
  const last = await InterviewSet.findOne({ track }).sort({ number: -1 }).select("number").lean();
  return InterviewSet.create({
    track,
    number: (last?.number || 0) + 1,
    questionCodes,
    source,
    updatedBy: updatedBy ? String(updatedBy) : "manual",
  });
}

// История: набор, дата, кандидат, интервьюер, итог.
async function setHistory({ track, limit = 100 }) {
  const filter = track ? { track } : {};
  const sessions = await InterviewSession.find(filter).sort({ createdAt: -1 }).limit(limit)
    .select("interview set track status startedAt finishedAt createdAt interviewer")
    .populate("set", "number source size")
    .populate("interviewer", "name lastName")
    .populate({
      path: "interview",
      select: "application percentage passed status scheduledAt attemptNumber",
      populate: { path: "application", select: "firstName lastName telegramUsername" },
    })
    .lean();
  return sessions.map((s) => ({
    sessionId: s._id,
    interviewId: s.interview?._id || null,
    track: s.track,
    set: s.set ? { _id: s.set._id, number: s.set.number, source: s.set.source, size: s.set.size } : null,
    date: s.startedAt || s.createdAt,
    status: s.status,
    candidate: s.interview?.application
      ? `${s.interview.application.firstName || ""} ${s.interview.application.lastName || ""}`.trim()
      : "",
    interviewer: s.interviewer ? `${s.interviewer.name || ""} ${s.interviewer.lastName || ""}`.trim() : "",
    attemptNumber: s.interview?.attemptNumber || 1,
    percentage: s.interview?.status === "completed" ? s.interview.percentage : null,
    passed: s.interview?.status === "completed" ? s.interview.passed : null,
  }));
}

const isId = (x) => mongoose.isValidObjectId(x);

module.exports = { suggestSets, previewGenerated, saveSet, setHistory, usageBySet, recentOfTrack, isId };
