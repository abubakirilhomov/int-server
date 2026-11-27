// API кандидата (/api/candidate/*). Всё, что уходит кандидату, проходит через
// serializers/candidateView: ни кодов вопросов, ни ответов банка, ни оценок,
// ни скрытых вопросов, ни данных других сессий. Сессия берётся только из
// доступа в токене — чужую сессию указать нельзя (id в запросах нет).
const bcrypt = require("bcrypt");
const CandidateAccess = require("../models/candidateAccessModel");
const InterviewSession = require("../models/interviewSessionModel");
const Answer = require("../models/answerModel");
const Application = require("../models/applicationModel");
const catchAsync = require("../utils/catchAsync");
const { accessDenial } = require("../middleware/candidateAuth");
const { toCandidateSession, visibleQuestions } = require("../serializers/candidateView");
const { normalizeLanguage } = require("../utils/questionBank/i18n");
const { LANGUAGES } = require("../config/questionBankTopics");
const {
  LOCK_AFTER_FAILS, normalizeUsername, signCandidateToken,
} = require("../services/candidateAccess");

const SIGNAL_TYPES = ["focus_lost", "focus_back", "paste"];
const MAX_SIGNALS = 500;
// Для несуществующего логина тоже считаем bcrypt — время ответа не выдаёт, есть ли логин.
let dummyHash = null;
const getDummyHash = async () => (dummyHash ||= await bcrypt.hash("no-such-user", 10));

const fail = (res, status, code, message, extra = {}) => res.status(status).json({ code, message, ...extra });

// ─── POST /login { username, password } ─────────────────────────────────────
// Пароль проверяется ДО окна/статуса: без пароля нельзя узнать, существует ли логин.
exports.login = catchAsync(async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || "");
  if (!username || !password) return fail(res, 400, "invalid", "Введите логин и пароль");

  const access = await CandidateAccess.findOne({ username }).select("+passwordHash");
  if (!access) {
    await bcrypt.compare(password, await getDummyHash());
    return fail(res, 401, "invalid", "Неверный логин или пароль");
  }
  if (access.failedLogins >= LOCK_AFTER_FAILS) {
    return fail(res, 423, "locked", "Слишком много попыток — попросите интервьюера сбросить пароль");
  }
  if (!(await bcrypt.compare(password, access.passwordHash))) {
    await CandidateAccess.updateOne({ _id: access._id }, { $inc: { failedLogins: 1 } });
    return fail(res, 401, "invalid", "Неверный логин или пароль");
  }
  const denial = accessDenial(access);
  if (denial) {
    const { status, code, message, ...extra } = denial;
    return fail(res, status, code, message, extra);
  }
  const now = new Date();
  await CandidateAccess.updateOne(
    { _id: access._id },
    { $set: { failedLogins: 0, lastLoginAt: now, lastSeenAt: now }, $inc: { loginCount: 1 } }
  );
  const session = await InterviewSession.findOne({ interview: access.interview }).select("language").lean();
  res.json({
    token: signCandidateToken(access, now),
    expiresAt: access.expiresAt,
    language: session?.language || "uz",
  });
});

async function sessionOf(req, res) {
  const session = await InterviewSession.findOne({ interview: req.candidate.access.interview });
  if (!session) {
    fail(res, 404, "no_session", "Собеседование ещё не начато");
    return null;
  }
  return session;
}

// ─── GET /session?rev=N&lang=uz|ru → 304, если для кандидата ничего не изменилось
// Сначала лёгкий запрос (rev и язык; в candidateAuth — параллельно с доступом):
// пустой опрос не тянет из БД снимки вопросов. При изменениях — снимок, имя и
// ответы одним параллельным заходом.
exports.getSession = catchAsync(async (req, res) => {
  const lang = req.query.lang ? normalizeLanguage(req.query.lang) : null;
  const interview = req.candidate.access.interview;
  let head = req.candidate.headP ? await req.candidate.headP : undefined;
  if (head === undefined) {
    head = await InterviewSession.findOne({ interview }).select("_id candidateRev language").lean();
  }
  if (!head) return fail(res, 404, "no_session", "Собеседование ещё не начато");
  if (req.query.rev !== undefined && Number(req.query.rev) === head.candidateRev && (!lang || lang === head.language)) {
    return res.status(304).end();
  }
  const [session, app, answers] = await Promise.all([
    InterviewSession.findById(head._id),
    Application.findById(req.candidate.access.application).select("firstName lastName").lean(),
    Answer.find({ session: head._id }).lean(),
  ]);
  if (!session) return fail(res, 404, "no_session", "Собеседование ещё не начато");
  // Своё имя и направление — для строки на экране ожидания (больше о человеке ничего).
  const me = { name: app ? `${app.firstName || ""} ${app.lastName || ""}`.trim() : "", track: session.track };
  res.json({ ...toCandidateSession(session, lang, new Map(answers.map((a) => [a.questionCode, a]))), me });
});

// ─── PUT /answers/:position { text, revision, submit? } ────────────────────
// position — номер среди показанных вопросов (как в GET /session).
// revision — счётчик клиента: запрос со старым revision отклоняется (409 stale),
// чтобы запоздавший черновик не затёр более новый текст.
exports.putAnswer = catchAsync(async (req, res) => {
  const session = await sessionOf(req, res);
  if (!session) return;
  if (session.status === "finished" || session.status === "aborted") return fail(res, 409, "finished", "Собеседование завершено");
  const position = Number(req.params.position);
  const q = visibleQuestions(session)[position - 1];
  if (!Number.isInteger(position) || !q) return fail(res, 404, "not_found", "Вопрос не найден");
  if (q.state !== "open") return fail(res, 409, "closed", "Вопрос закрыт — ответ сохранён");
  if (q.discussOnly) return fail(res, 409, "discuss_only", "На этот вопрос отвечают устно");

  const text = typeof req.body?.text === "string" ? req.body.text : "";
  if (Buffer.byteLength(text, "utf8") > Answer.MAX_ANSWER_BYTES) return fail(res, 413, "too_large", "Ответ слишком большой");
  const revision = Number(req.body?.revision);
  if (!Number.isInteger(revision) || revision < 0) return fail(res, 400, "invalid", "revision — целое ≥ 0");
  const submit = req.body?.submit === true;
  const now = new Date();
  const kind = ["code", "sandbox", "choice"].includes(q.answerKind) ? q.answerKind : "text";

  const set = { text, revision, kind, draftUpdatedAt: now };
  if (submit) set.submittedAt = now;
  let answer;
  try {
    answer = await Answer.findOneAndUpdate(
      { session: session._id, questionCode: q.code, frozenAt: null, revision: { $lte: revision } },
      { $set: set },
      { new: true, upsert: true }
    );
  } catch (e) {
    if (e?.code !== 11000) throw e;
    // Документ есть, но условие не прошло: заморожен или revision старее.
    const cur = await Answer.findOne({ session: session._id, questionCode: q.code }).lean();
    if (cur?.frozenAt) return fail(res, 409, "closed", "Вопрос закрыт — ответ сохранён");
    return fail(res, 409, "stale", "Есть более новая версия ответа", { revision: cur?.revision ?? 0 });
  }
  const inc = submit ? { rev: 1, candidateRev: 1 } : { rev: 1 };
  await InterviewSession.updateOne({ _id: session._id }, { $inc: inc });
  res.json({
    position,
    revision: answer.revision,
    savedAt: answer.draftUpdatedAt,
    submittedAt: answer.submittedAt || null,
  });
});

// ─── POST /signals { type: focus_lost|focus_back|paste, position?, meta? } ──
// Только для сведения интервьюера (вставка разрешена).
exports.postSignal = catchAsync(async (req, res) => {
  const session = await sessionOf(req, res);
  if (!session) return;
  const type = req.body?.type;
  if (!SIGNAL_TYPES.includes(type)) return fail(res, 400, "invalid", "Неизвестный сигнал");
  if (session.status === "finished" || session.status === "aborted") return res.status(204).end();
  const q = visibleQuestions(session)[Number(req.body?.position) - 1];
  const meta = {};
  const m = req.body?.meta || {};
  if (Number.isFinite(Number(m.ms))) meta.ms = Math.max(0, Math.round(Number(m.ms)));
  if (Number.isFinite(Number(m.chars))) meta.chars = Math.max(0, Math.round(Number(m.chars)));
  await InterviewSession.updateOne(
    { _id: session._id },
    {
      $push: { signals: { $each: [{ type, questionCode: q?.code, at: new Date(), meta: Object.keys(meta).length ? meta : undefined }], $slice: -MAX_SIGNALS } },
      $inc: { rev: 1 },
    }
  );
  res.status(204).end();
});

// ─── PATCH /language { language: uz|ru } ─────────────────────────────────
exports.setLanguage = catchAsync(async (req, res) => {
  const language = String(req.body?.language || "").toLowerCase();
  if (!LANGUAGES.includes(language)) return fail(res, 400, "invalid", "language: uz | ru");
  const r = await InterviewSession.findOneAndUpdate(
    { interview: req.candidate.access.interview },
    { $set: { language }, $inc: { rev: 1, candidateRev: 1 } },
    { new: true }
  ).select("language candidateRev");
  if (!r) return fail(res, 404, "no_session", "Собеседование ещё не начато");
  res.json({ language: r.language, rev: r.candidateRev });
});
