// Вид живой сессии для ИНТЕРВЬЮЕРА (только isAdmin): снимки вопросов + ответы
// банка (expectedAnswer, верный вариант, demoFix — из BankQuestion по code),
// ответы кандидата, сигналы, текущий балл, состояние доступа.
// Кандидату этот вид не отдаётся никогда — у него serializers/candidateView.
const { computeQuestionScore } = require("../utils/scoreInterview");
const { editorFor } = require("../config/questionBankTopics");
const { isEmptyAnswer } = require("./candidateView");

const ONLINE_MS = 20 * 1000;

const plain = (x) => (x && typeof x.toObject === "function" ? x.toObject() : x);
const plainMap = (m) => {
  if (!m) return undefined;
  const entries = m instanceof Map ? [...m.entries()] : Object.entries(m);
  return entries.length ? Object.fromEntries(entries) : undefined;
};

function isOnline(access, now = new Date()) {
  return Boolean(access?.lastSeenAt && now - new Date(access.lastSeenAt) <= ONLINE_MS);
}

// Балл — тот же расчёт, что пишет «Завершить» (computeQuestionScore): от
// максимума открытых кандидату вопросов, открытый без оценки = 0. setTotal и
// percentOfSet — справочно, от максимума всего набора.
function sessionScore(questions, cfg) {
  const weights = cfg.levelWeights;
  const r = computeQuestionScore(questions, {
    levelWeights: weights,
    partialCredit: cfg.partialCredit,
    threshold: cfg.passThreshold,
  });
  const setTotal = (questions || []).reduce((s, q) => s + (Number(weights[q.level]) || 1), 0);
  return {
    earned: r.earned,
    total: r.total,
    percentage: r.percentage,
    passed: r.passed,
    threshold: cfg.passThreshold,
    partialCredit: cfg.partialCredit,
    levelWeights: weights,
    counted: r.rated + r.unrated, // вопросов в знаменателе
    rated: r.rated,
    unrated: r.unrated, // открыты без оценки — считаются как 0
    unratedShown: r.unrated, // совместимость с экраном 2b
    notOpened: r.notOpened,
    setTotal,
    percentOfSet: setTotal > 0 ? Math.round((r.earned / setTotal) * 1000) / 10 : 0,
  };
}

function answerView(a) {
  if (isEmptyAnswer(a)) return null; // заглушка заморозки — ответа не было
  return {
    kind: a.kind,
    text: a.text || "",
    files: plainMap(a.files),
    revision: a.revision || 0,
    draftUpdatedAt: a.draftUpdatedAt || null,
    submittedAt: a.submittedAt || null,
    frozenAt: a.frozenAt || null,
  };
}

function accessView(access, now) {
  if (!access) return null;
  return {
    username: access.username,
    status: access.status,
    revokeReason: access.revokeReason || null,
    validFrom: access.validFrom,
    expiresAt: access.expiresAt,
    expired: access.status === "expired" || now > new Date(access.expiresAt),
    notYet: now < new Date(access.validFrom),
    lastLoginAt: access.lastLoginAt || null,
    lastSeenAt: access.lastSeenAt || null,
    online: isOnline(access, now),
    loginCount: access.loginCount || 0,
    failedLogins: access.failedLogins || 0,
  };
}

/**
 * @param session   InterviewSession (doc или lean)
 * @param ctx { bankByCode: Map, answers: Answer[], access, interview, set, cfg, appUrl, now }
 */
function toLiveView(session, ctx) {
  const now = ctx.now || new Date();
  const s = plain(session);
  const answersByCode = new Map((ctx.answers || []).map((a) => [a.questionCode, a]));
  const questions = (s.questions || []).map((q) => {
    const bank = ctx.bankByCode?.get(q.code) || {};
    const correct = new Map((bank.options || []).map((o) => [o.key, Boolean(o.correct)]));
    return {
      code: q.code,
      order: q.order,
      topic: q.topic,
      level: q.level,
      isPractical: Boolean(q.isPractical),
      answerKind: q.answerKind || "text",
      editor: editorFor(q),
      prompt: q.prompt,
      promptRu: q.promptRu || "",
      promptShort: q.promptShort || "",
      promptShortRu: q.promptShortRu || "",
      options: q.options ? q.options.map((o) => ({ ...o, correct: correct.get(o.key) || false })) : undefined,
      sandbox: q.sandbox?.template || q.sandbox?.files
        ? { template: q.sandbox.template || null, files: plainMap(q.sandbox.files) || {} }
        : undefined,
      demo: q.demo || undefined,
      demoFix: bank.demoFix || undefined,
      // Автотесты (с кодом) — только интервьюеру; запускает браузер в песочнице.
      tests: (bank.tests || []).map((t) => ({ name: t.name, nameRu: t.nameRu || "", code: t.code })),
      expectedAnswer: bank.expectedAnswer || "",
      expectedAnswerRu: bank.expectedAnswerRu || "",
      state: q.state,
      discussOnly: Boolean(q.discussOnly),
      openedAt: q.openedAt || null,
      closedAt: q.closedAt || null,
      result: q.result || null,
      note: q.note || "",
      answer: answerView(answersByCode.get(q.code)),
    };
  });
  const iv = ctx.interview ? plain(ctx.interview) : null;
  const app = iv?.application && typeof iv.application === "object" ? iv.application : null;
  return {
    sessionId: s._id,
    interviewId: s.interview?._id || s.interview,
    rev: s.rev || 0,
    status: s.status,
    track: s.track,
    language: s.language,
    currentIndex: s.currentIndex,
    startedAt: s.startedAt || null,
    finishedAt: s.finishedAt || null,
    set: ctx.set ? { _id: ctx.set._id, number: ctx.set.number, source: ctx.set.source, size: ctx.set.size } : null,
    interview: iv
      ? {
          _id: iv._id,
          status: iv.status,
          scheduledAt: iv.scheduledAt,
          attemptNumber: iv.attemptNumber,
          candidate: app ? `${app.firstName || ""} ${app.lastName || ""}`.trim() : "",
          telegramUsername: app?.telegramUsername || "",
        }
      : null,
    access: accessView(ctx.access, now),
    appUrl: ctx.appUrl || "",
    score: sessionScore(s.questions, ctx.cfg),
    questions,
    signals: (s.signals || []).map((g) => ({ type: g.type, questionCode: g.questionCode || null, at: g.at, meta: g.meta })),
  };
}

module.exports = { toLiveView, sessionScore, isOnline, ONLINE_MS };
