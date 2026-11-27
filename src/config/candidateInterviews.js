// Живые собеседования кандидатов — настройки по умолчанию.
// План: docs/2026-11-27-candidate-interviews-plan.md (в монорепо interns-system).
//
// Абубакир 27.11 одобрил план, но на вопросы §9 не ответил — до ответа
// действуют эти значения. Меняются без деплоя: Setting с ключом
// "candidateInterviewSettings" (PATCH /api/settings) перекрывает поля ниже.
const Setting = require("../models/settingModel");

const DEFAULTS = Object.freeze({
  // §9.1 Формат смешанный: кандидат рядом или по Zoom. Сигналы фокуса и
  // вставки пишем в сессию, вставку не запрещаем.
  format: "mixed",
  recordSignals: true,
  blockPaste: false,

  // §9.2 Вес вопроса по уровню. Порог и доля за «частично» — null → берутся
  // из текущего процесса (Setting interviewSettings: passThreshold 80, partialCredit 0.5).
  levelWeights: { oson: 1, orta: 2, qiyin: 3 },
  passThreshold: null,
  partialCredit: null,

  // §9.3 Проводят только админы (isAdmin), как текущие /api/interviews.
  conductorRoles: ["admin"],

  // §9.4 Доступ кандидата: от −30 мин до +3 ч от начала, отзыв сразу по «Завершить».
  accessWindow: { beforeMinutes: 30, afterMinutes: 180 },
  revokeOnFinish: true,

  // §9.5 Банк — только фронтенд-треки; backend-nodejs остаётся на старом чек-листе.
  bankTracks: ["frontend-react", "frontend-vue"],

  // §9.6 Язык вопросов — только узбекский.
  language: "uz",

  // §9.7 Домен кандидатского приложения — пока *.vercel.app (CANDIDATE_APP_URL).
  candidateAppUrl: process.env.CANDIDATE_APP_URL || "",

  // §9.8 Песочница React/Vue (Sandpack или своя) — решение на этапе 5.
  sandboxProvider: null,

  // Набор по умолчанию: 18 вопросов; не повторять наборы последних N собеседований трека.
  defaultSetSize: 18,
  avoidRecentSets: 3,
});

const INTERVIEW_DEFAULTS = { passThreshold: 80, partialCredit: 0.5 };

function mergeConfig(overrides = {}, interviewSettings = {}) {
  const cfg = {
    ...DEFAULTS,
    ...overrides,
    levelWeights: { ...DEFAULTS.levelWeights, ...(overrides.levelWeights || {}) },
    accessWindow: { ...DEFAULTS.accessWindow, ...(overrides.accessWindow || {}) },
  };
  const iv = { ...INTERVIEW_DEFAULTS, ...interviewSettings };
  if (cfg.passThreshold == null) cfg.passThreshold = Number(iv.passThreshold);
  if (cfg.partialCredit == null) cfg.partialCredit = Number(iv.partialCredit);
  return cfg;
}

async function getCandidateInterviewConfig() {
  const docs = await Setting.find({
    key: { $in: ["candidateInterviewSettings", "interviewSettings"] },
  }).lean();
  const byKey = Object.fromEntries(docs.map((d) => [d.key, d.value || {}]));
  return mergeConfig(byKey.candidateInterviewSettings, byKey.interviewSettings);
}

module.exports = { DEFAULTS, mergeConfig, getCandidateInterviewConfig };
