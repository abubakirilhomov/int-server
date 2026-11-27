// Живые собеседования кандидатов — настройки по умолчанию.
// План: docs/2026-11-27-candidate-interviews-plan.md (в монорепо interns-system).
//
// Ответы Абубакира на §9 плана — 27.11. Меняются без деплоя: Setting с ключом
// "candidateInterviewSettings" (PATCH /api/settings) перекрывает поля ниже.
const Setting = require("../models/settingModel");
const { BANK_TRACKS, LANGUAGES, DEFAULT_LANGUAGE } = require("./questionBankTopics");

const DEFAULTS = Object.freeze({
  // §9.1 Кандидат обычно сидит рядом, иногда подключается по Google Meet.
  // Сигналы фокуса и вставки пишем в сессию, вставку не запрещаем.
  format: "mixed",
  recordSignals: true,
  blockPaste: false,

  // §9.2 «Все равны» = каждое собеседование одинаково по сложности, а не
  // равный вес вопросов (поправка Абубакира 27.11). Вес по уровню 1/2/3;
  // состав набора по уровням обязателен (utils/questionBank/setLevels).
  // Порог 80% от максимума набора. «Частично» — из interviewSettings (0.5).
  levelWeights: { oson: 1, orta: 2, qiyin: 3 },
  passThreshold: 80,
  partialCredit: null,

  // §9.3 Проводят только админы (isAdmin), как текущие /api/interviews.
  conductorRoles: ["admin"],

  // §9.4 Доступ кандидата: от −30 мин до +3 ч от начала, отзыв сразу по «Завершить».
  accessWindow: { beforeMinutes: 30, afterMinutes: 180 },
  revokeOnFinish: true,

  // §9.5 Банк ведётся для всех трёх треков; банк backend-nodejs пополняется.
  // Пока у трека нет активных наборов — старый чек-лист (services/candidateInterviewMode).
  bankTracks: [...BANK_TRACKS],

  // §9.6 Вопросы на двух языках. Кандидат получает выбранный, при пустом
  // переводе — узбекский.
  languages: [...LANGUAGES],
  defaultLanguage: DEFAULT_LANGUAGE,

  // §9.7 Домен кандидатского приложения — пока *.vercel.app (CANDIDATE_APP_URL).
  candidateAppUrl: process.env.CANDIDATE_APP_URL || "",

  // §9.8 Интернет в филиалах есть всегда — Sandpack (бандлер CodeSandbox) допустим.
  sandboxProvider: "sandpack",

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
