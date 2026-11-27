// Живое собеседование — сторона интервьюера (роуты /api/interviews/*, auth + isAdmin).
// Контракт API: docs/2026-11-27-candidate-interviews-api.md (монорепо interns-system).
const mongoose = require("mongoose");
const Interview = require("../models/interviewModel");
const Application = require("../models/applicationModel");
const InterviewSession = require("../models/interviewSessionModel");
const InterviewSet = require("../models/interviewSetModel");
const BankQuestion = require("../models/bankQuestionModel");
const CandidateAccess = require("../models/candidateAccessModel");
const Answer = require("../models/answerModel");
const Setting = require("../models/settingModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { getCandidateInterviewConfig } = require("../config/candidateInterviews");
const { resolveInterviewMode } = require("../services/candidateInterviewMode");
const sets = require("../services/interviewSets");
const access = require("../services/candidateAccess");
const { toLiveView, isOnline } = require("../serializers/liveInterviewView");
const { computeQuestionScore } = require("../utils/scoreInterview");
const { buildLetters } = require("../utils/roadmapLetter");
const { normalizeLanguage } = require("../utils/questionBank/i18n");

const isId = (id) => mongoose.isValidObjectId(id);
const actorId = (req) => req.user?.id || req.user?._id || null;
const SNAPSHOT_FIELDS = "code topic level isPractical prompt promptRu promptShort promptShortRu options answerKind sandbox demo";

async function loadInterview(id) {
  if (!isId(id)) throw new AppError("Некорректный ID", 400);
  const iv = await Interview.findById(id);
  if (!iv) throw new AppError("Собеседование не найдено", 404);
  return iv;
}

async function loadSession(interviewId) {
  if (!isId(interviewId)) throw new AppError("Некорректный ID", 400);
  const session = await InterviewSession.findOne({ interview: interviewId });
  if (!session) throw new AppError("Живая сессия не начата", 404);
  return session;
}

// rev растёт отдельным атомарным $inc ПОСЛЕ записи изменений: опрос, увидевший
// новый rev, гарантированно видит и сами изменения; параллельные записи
// (черновики кандидата) не теряют инкременты.
function bumpRev(sessionId, candidateVisible) {
  const inc = candidateVisible ? { rev: 1, candidateRev: 1 } : { rev: 1 };
  return InterviewSession.updateOne({ _id: sessionId }, { $inc: inc });
}

// Полный вид для интервьюера (после каждого действия и в опросе).
async function buildView(sessionOrId, extra = {}) {
  const session = sessionOrId instanceof InterviewSession
    ? sessionOrId
    : await InterviewSession.findById(sessionOrId);
  const codes = session.questions.map((q) => q.code);
  const [bank, answers, acc, interview, set, cfg] = await Promise.all([
    BankQuestion.find({ code: { $in: codes } })
      .select("+expectedAnswer +expectedAnswerRu +options.correct +demoFix")
      .lean(),
    Answer.find({ session: session._id }).lean(),
    CandidateAccess.findOne({ interview: session.interview }).lean(),
    Interview.findById(session.interview)
      .select("status scheduledAt attemptNumber application")
      .populate("application", "firstName lastName telegramUsername")
      .lean(),
    session.set ? InterviewSet.findById(session.set).select("number source size").lean() : null,
    getCandidateInterviewConfig(),
  ]);
  return {
    ...toLiveView(session, {
      bankByCode: new Map(bank.map((b) => [b.code, b])),
      answers, access: acc, interview, set, cfg, appUrl: cfg.candidateAppUrl,
    }),
    ...extra,
  };
}

// ─── Наборы: ротация, предпросмотр сгенерированного, история ───────────────────
exports.listSets = catchAsync(async (req, res) => {
  const cfg = await getCandidateInterviewConfig();
  let track = req.query.track;
  let applicationId = null;
  let interviewId = null;
  if (isId(req.query.interviewId)) {
    const iv = await Interview.findById(req.query.interviewId).select("track application").lean();
    if (iv) { track = track || iv.track; applicationId = iv.application; interviewId = iv._id; }
  }
  if (!track) throw new AppError("Укажите track", 400);
  const mode = await resolveInterviewMode(track, cfg);
  const r = await sets.suggestSets({ track, applicationId, interviewId, avoidRecent: cfg.avoidRecentSets });
  res.json({ track, mode, defaultSize: cfg.defaultSetSize, ...r });
});

exports.previewSet = catchAsync(async (req, res) => {
  const cfg = await getCandidateInterviewConfig();
  const { track, interviewId } = req.body || {};
  const size = Number(req.body?.size) || cfg.defaultSetSize;
  if (!track) throw new AppError("Укажите track", 400);
  let applicationId = null;
  if (isId(interviewId)) {
    applicationId = (await Interview.findById(interviewId).select("application").lean())?.application || null;
  }
  let r;
  try {
    r = await sets.previewGenerated({ track, size, applicationId, interviewId, avoidRecent: cfg.avoidRecentSets });
  } catch (e) {
    throw new AppError(e.message, 422);
  }
  res.json({ track, size, questionCodes: r.codes, violations: r.violations });
});

exports.setHistory = catchAsync(async (req, res) => {
  const items = await sets.setHistory({ track: req.query.track, limit: Math.min(Number(req.query.limit) || 100, 500) });
  res.json({ count: items.length, items });
});

// ─── Старт: набор → снимок вопросов → разовый доступ ──────────────────────────
// body: { track?, setId } | { track?, generate: true, size? } | { track?, questionCodes: [] }, language?
exports.start = catchAsync(async (req, res) => {
  const interview = await loadInterview(req.params.id);
  if (interview.status !== "scheduled") throw new AppError("Собеседование уже не в статусе «назначено»", 409);
  if (await InterviewSession.exists({ interview: interview._id })) {
    throw new AppError("Живая сессия уже начата — для нового пароля используйте «Сбросить пароль»", 409);
  }
  const cfg = await getCandidateInterviewConfig();
  const body = req.body || {};
  const track = body.track || interview.track;
  if (!Interview.TRACKS.includes(track)) throw new AppError("Недопустимое направление", 400);
  if ((await resolveInterviewMode(track, cfg)) !== "live") {
    throw new AppError("Для этого направления нет наборов — только чек-лист", 400);
  }

  let set;
  if (isId(body.setId)) {
    set = await InterviewSet.findOne({ _id: body.setId, track, isActive: true });
    if (!set) throw new AppError("Набор не найден для этого направления", 404);
  } else if (body.generate || Array.isArray(body.questionCodes)) {
    let codes = body.questionCodes;
    if (!Array.isArray(codes)) {
      try {
        codes = (await sets.previewGenerated({
          track, size: Number(body.size) || cfg.defaultSetSize,
          applicationId: interview.application, interviewId: interview._id, avoidRecent: cfg.avoidRecentSets,
        })).codes;
      } catch (e) {
        throw new AppError(e.message, 422);
      }
    }
    const valid = await BankQuestion.countDocuments({ code: { $in: codes }, tracks: track, isActive: true });
    if (!codes.length || valid !== codes.length || new Set(codes).size !== codes.length) {
      throw new AppError("Набор: повтор или вопрос не из банка этого направления", 400);
    }
    try {
      set = await sets.saveSet({ track, questionCodes: codes, source: body.generate ? "generated" : "manual", updatedBy: actorId(req) });
    } catch (e) {
      throw new AppError(e.message, 422);
    }
  } else {
    throw new AppError("Выберите набор (setId) или generate: true", 400);
  }

  const bank = await BankQuestion.find({ code: { $in: set.questionCodes } }).select(SNAPSHOT_FIELDS).lean();
  const byCode = new Map(bank.map((q) => [q.code, q]));
  const missing = set.questionCodes.filter((c) => !byCode.has(c));
  if (missing.length) throw new AppError(`В банке нет вопросов: ${missing.join(", ")}`, 422);
  const questions = set.questionCodes.map((code, i) => {
    const q = byCode.get(code);
    return {
      code, order: i + 1, topic: q.topic, level: q.level, isPractical: q.isPractical,
      prompt: q.prompt, promptRu: q.promptRu || "", promptShort: q.promptShort || "", promptShortRu: q.promptShortRu || "",
      options: q.options?.length ? q.options.map((o) => ({ key: o.key, text: o.text, textRu: o.textRu || "" })) : undefined,
      answerKind: q.answerKind || "text",
      sandbox: q.sandbox?.template || q.sandbox?.files ? q.sandbox : undefined,
      demo: q.demo?.html ? q.demo : undefined,
      state: "hidden",
    };
  });

  let session;
  try {
    session = await InterviewSession.create({
      interview: interview._id,
      set: set._id,
      track,
      language: normalizeLanguage(body.language || cfg.defaultLanguage),
      interviewer: actorId(req),
      status: "lobby",
      questions,
    });
  } catch (e) {
    if (e?.code === 11000) throw new AppError("Живая сессия уже начата", 409);
    throw e;
  }

  let issued;
  try {
    issued = await access.issueAccess({
      interview,
      window: access.accessWindow(interview.scheduledAt, cfg.accessWindow),
      createdBy: actorId(req),
    });
  } catch (e) {
    await InterviewSession.deleteOne({ _id: session._id });
    if (e?.code === 11000) throw new AppError("Доступ для этого собеседования уже выдан", 409);
    throw e;
  }

  interview.mode = "live";
  interview.track = track;
  if (!interview.interviewer) interview.interviewer = actorId(req);
  await interview.save();

  res.status(201).json(await buildView(session, {
    credentials: {
      username: issued.access.username,
      password: issued.password, // показывается один раз
      validFrom: issued.access.validFrom,
      expiresAt: issued.access.expiresAt,
      appUrl: cfg.candidateAppUrl,
    },
  }));
});

// ─── Опрос интервьюера: ?rev=N[&online=0|1] → 304, если ничего не изменилось ──
exports.getLive = catchAsync(async (req, res) => {
  const session = await loadSession(req.params.id);
  if (req.query.rev !== undefined && Number(req.query.rev) === session.rev) {
    let same = true;
    if (req.query.online !== undefined) {
      const acc = await CandidateAccess.findOne({ interview: session.interview }).select("lastSeenAt").lean();
      same = isOnline(acc) === (req.query.online === "1" || req.query.online === "true");
    }
    if (same) return res.status(304).end();
  }
  res.json(await buildView(session));
});

// ─── Вопрос: открыть / только обсудить / закрыть ──────────────────────────────
// Открытым может быть один вопрос: открытие следующего закрывает текущий
// (ответ замораживается). Повторное открытие закрытого — размораживает ответ.
exports.questionAction = catchAsync(async (req, res) => {
  const { code, action } = req.params;
  if (!["open", "discuss", "close"].includes(action)) throw new AppError("Неизвестное действие", 400);
  const session = await loadSession(req.params.id);
  if (!["lobby", "live"].includes(session.status)) throw new AppError("Собеседование завершено", 409);
  const q = session.questions.find((x) => x.code === code);
  if (!q) throw new AppError("Вопроса нет в наборе", 404);
  const now = new Date();
  const freeze = [];
  const unfreeze = [];

  if (action === "close") {
    if (q.state !== "open") throw new AppError("Вопрос не открыт", 409);
    q.state = "closed";
    q.closedAt = now;
    freeze.push(code);
  } else {
    session.questions.forEach((o) => {
      if (o.state === "open" && o.code !== code) {
        o.state = "closed";
        o.closedAt = now;
        freeze.push(o.code);
      }
    });
    if (q.state !== "open") {
      if (q.state === "closed") unfreeze.push(code);
      // openedAt не переписываем: от него зависит номер вопроса у кандидата.
      if (!q.openedAt) q.openedAt = now;
      q.state = "open";
      q.closedAt = undefined;
    }
    q.discussOnly = action === "discuss";
    session.currentIndex = q.order - 1;
    if (session.status === "lobby") {
      session.status = "live";
      session.startedAt = now;
    }
  }
  await session.save();
  await bumpRev(session._id, true);
  if (freeze.length) {
    await Answer.updateMany({ session: session._id, questionCode: { $in: freeze }, frozenAt: null }, { $set: { frozenAt: now } });
  }
  if (unfreeze.length) {
    await Answer.updateMany({ session: session._id, questionCode: { $in: unfreeze } }, { $set: { frozenAt: null } });
  }
  res.json(await buildView(session._id));
});

// ─── Оценка и заметка: { result: pass|partial|fail|null, note } ─────────────
exports.rateQuestion = catchAsync(async (req, res) => {
  const session = await loadSession(req.params.id);
  if (session.status === "finished" || session.status === "aborted") throw new AppError("Собеседование завершено", 409);
  const q = session.questions.find((x) => x.code === req.params.code);
  if (!q) throw new AppError("Вопроса нет в наборе", 404);
  const body = req.body || {};
  if ("result" in body) {
    if (body.result !== null && !["pass", "partial", "fail"].includes(body.result)) {
      throw new AppError("result: pass | partial | fail | null", 400);
    }
    q.result = body.result;
  }
  if ("note" in body) q.note = String(body.note ?? "").slice(0, 2000);
  await session.save();
  await bumpRev(session._id, false);
  res.json(await buildView(session._id));
});

// ─── Доступ: сбросить пароль / продлить ──────────────────────────────────────
exports.accessAction = catchAsync(async (req, res) => {
  const session = await loadSession(req.params.id);
  if (session.status === "finished" || session.status === "aborted") throw new AppError("Собеседование завершено", 409);
  const acc = await CandidateAccess.findOne({ interview: session.interview }).select("_id");
  if (!acc) throw new AppError("Доступ не выдан", 404);
  let extra = {};
  if (req.params.action === "reset") {
    const r = await access.resetPassword(acc._id);
    if (!r) throw new AppError("Доступ отозван", 409);
    extra = { credentials: { username: r.access.username, password: r.password, validFrom: r.access.validFrom, expiresAt: r.access.expiresAt } };
  } else if (req.params.action === "extend") {
    const minutes = Math.min(Math.max(Number(req.body?.minutes) || 30, 5), 180);
    if (!(await access.extendAccess(acc._id, minutes))) throw new AppError("Доступ отозван", 409);
  } else {
    throw new AppError("Неизвестное действие", 400);
  }
  await session.save();
  await bumpRev(session._id, false);
  res.json(await buildView(session._id, extra));
});

// ─── Завершить: доступ отозван → Interview completed (items, балл, кулдаун) ──
// Дальше всё как у чек-листа: экран «Результат», письмо GET /:id/letter,
// interns-agent рассылает completed-интервью сам.
exports.finish = catchAsync(async (req, res) => {
  const session = await loadSession(req.params.id);
  if (session.status === "finished" || session.status === "aborted") throw new AppError("Собеседование уже завершено", 409);
  const interview = await Interview.findById(session.interview);
  if (!interview) throw new AppError("Собеседование не найдено", 404);
  const cfg = await getCandidateInterviewConfig();
  const result = computeQuestionScore(session.questions, {
    levelWeights: cfg.levelWeights, partialCredit: cfg.partialCredit, threshold: cfg.passThreshold,
  });
  if (result.total === 0) throw new AppError("Ни один вопрос не открыт и не оценён", 400);

  const now = new Date();
  await access.revokeAccess({ interview: interview._id }, "finished");

  const settingDoc = await Setting.findOne({ key: "interviewSettings" }).lean();
  const cooldownDays = Number(settingDoc?.value?.cooldownDays ?? 7);
  interview.items = result.snapItems;
  interview.scoreEarned = result.earned;
  interview.scoreTotal = result.total;
  interview.percentage = result.percentage;
  interview.passed = result.passed;
  interview.roadmap = result.roadmap;
  if (typeof req.body?.note === "string") interview.resultNote = req.body.note.slice(0, 2000);
  interview.mode = "live";
  interview.status = "completed";
  interview.conductedAt = now;
  interview.cooldownUntil = result.passed ? null : new Date(now.getTime() + cooldownDays * 86400000);
  await interview.save();

  const app = await Application.findById(interview.application);
  if (app) {
    app.lastInterviewAt = now;
    app.cooldownUntil = result.passed ? null : interview.cooldownUntil;
    await app.save();
  }

  const openCodes = session.questions.filter((q) => q.state === "open").map((q) => q.code);
  session.questions.forEach((q) => {
    if (q.state === "open") { q.state = "closed"; q.closedAt = now; }
  });
  session.status = "finished";
  session.finishedAt = now;
  session.finishedBy = actorId(req);
  await session.save();
  await bumpRev(session._id, true);
  await Answer.updateMany({ session: session._id, frozenAt: null }, { $set: { frozenAt: now } });

  const letter = buildLetters({
    candidateName: app ? `${app.firstName || ""} ${app.lastName || ""}`.trim() : "",
    earned: result.earned,
    total: result.total,
    percentage: result.percentage,
    passed: result.passed,
    roadmap: result.roadmap,
    roadmapUz: result.roadmapUz,
    cooldownUntil: interview.cooldownUntil,
    threshold: cfg.passThreshold,
  });
  res.json(await buildView(session._id, { result: { closedOpen: openCodes, unrated: result.unrated }, letter }));
});

// Отмена / неявка собеседования — доступ отзывается, сессия прерывается.
exports.abortForInterview = async (interviewId, reason = "canceled") => {
  await access.revokeAccess({ interview: interviewId }, reason === "no_show" ? "canceled" : reason);
  await InterviewSession.updateOne(
    { interview: interviewId, status: { $in: ["lobby", "live"] } },
    { $set: { status: "aborted", finishedAt: new Date() }, $inc: { rev: 1, candidateRev: 1 } }
  );
};
