// Темы банка вопросов: префикс кода → тема, треки, язык подсветки кода,
// названия в docx и подписи для roadmap. Единственный источник для модели
// BankQuestion, разбора docx и подсчёта результата.
//
// Backend-трек (N/E/D/A) заведён заранее: банк для backend-nodejs будет
// пополняться (Абубакир, 27.11). Пока у трека нет активных наборов, backend
// собеседуется по старому чек-листу (services/candidateInterviewMode).
const FR = "frontend-react";
const FV = "frontend-vue";
const BN = "backend-nodejs";

const BANK_TRACKS = [FR, FV, BN];
const LANGUAGES = ["uz", "ru"];
const DEFAULT_LANGUAGE = "uz";

const TOPIC_DEFS = [
  { prefix: "H", topic: "html", tracks: [FR, FV], codeLang: "html", names: ["HTML"], label: { uz: "HTML", ru: "HTML" } },
  { prefix: "C", topic: "css", tracks: [FR, FV], codeLang: "css", names: ["CSS"], label: { uz: "CSS", ru: "CSS" } },
  { prefix: "J", topic: "js", tracks: [FR, FV], codeLang: "js", names: ["JavaScript"], label: { uz: "JavaScript", ru: "JavaScript" } },
  { prefix: "R", topic: "react", tracks: [FR], codeLang: "jsx", names: ["React"], label: { uz: "React", ru: "React" } },
  { prefix: "V", topic: "vue", tracks: [FV], codeLang: "vue", names: ["Vue"], label: { uz: "Vue", ru: "Vue" } },
  { prefix: "T", topic: "tailwind", tracks: [FV], codeLang: "html", names: ["Tailwind CSS", "Tailwind"], label: { uz: "Tailwind CSS", ru: "Tailwind CSS" } },
  { prefix: "N", topic: "node", tracks: [BN], codeLang: "js", names: ["Node.js", "Node"], label: { uz: "Node.js", ru: "Node.js" } },
  { prefix: "E", topic: "express", tracks: [BN], codeLang: "js", names: ["Express.js", "Express"], label: { uz: "Express", ru: "Express" } },
  { prefix: "D", topic: "database", tracks: [BN], codeLang: "js", names: ["MongoDB", "Ma'lumotlar bazasi", "SQL"], label: { uz: "Ma'lumotlar bazasi", ru: "Базы данных" } },
  { prefix: "A", topic: "api", tracks: [BN], codeLang: "js", names: ["API va HTTP", "API", "HTTP"], label: { uz: "API va HTTP", ru: "API и HTTP" } },
];

const PREFIX = Object.fromEntries(TOPIC_DEFS.map((d) => [d.prefix, { topic: d.topic, tracks: d.tracks }]));
const CODE_LANG = Object.fromEntries(TOPIC_DEFS.map((d) => [d.prefix, d.codeLang]));
const TOPICS = TOPIC_DEFS.map((d) => d.topic);
const TOPIC_LABELS = Object.fromEntries(TOPIC_DEFS.map((d) => [d.topic, d.label]));
const PREFIX_CHARS = TOPIC_DEFS.map((d) => d.prefix).join("");
const CODE_PATTERN = `[${PREFIX_CHARS}]\\d{1,3}`;

// Апостроф в узбекских словах бывает любым: ' ’ ʻ `.
const APOS = "['’ʻ`]";
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, APOS);

// Название темы из docx («Tailwind CSS (…)», «Node.js») → тема или null.
// exact: строка целиком равна названию (заголовки «HTML (8 ta)»); иначе
// достаточно начала («Tailwind CSS (v3)» в таблице квот).
function topicByName(name, { exact = false } = {}) {
  const s = String(name || "").trim();
  const tail = exact ? "$" : "(?![\\w.])";
  for (const d of TOPIC_DEFS) {
    if (d.names.some((n) => new RegExp(`^${escapeRe(n)}${tail}`, "i").test(s))) return d.topic;
  }
  return null;
}

module.exports = {
  BANK_TRACKS, LANGUAGES, DEFAULT_LANGUAGE, TOPIC_DEFS, PREFIX, CODE_LANG, TOPICS, TOPIC_LABELS,
  PREFIX_CHARS, CODE_PATTERN, APOS, escapeRe, topicByName,
};
