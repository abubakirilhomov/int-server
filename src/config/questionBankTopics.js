// Темы банка вопросов: префикс кода → тема, треки, язык подсветки кода,
// названия в docx и подписи для roadmap. Единственный источник для модели
// BankQuestion, разбора docx и подсчёта результата.
//
// Модель найма (Абубакир, 27.11): берём только full-stack учеников, закончивших PRO;
// стеки JS и Python. Направления в выборе: «JS · React» (frontend-react),
// «JS · Vue» (frontend-vue), «Python» (backend-python). backend-nodejs — архивное:
// в enum'ах остаётся ради истории (заявки, собеседования), в выборе не показывается.
const FR = "frontend-react";
const FV = "frontend-vue";
const BN = "backend-nodejs";
const BP = "backend-python";

const BANK_TRACKS = [FR, FV, BN, BP];

// Направления найма: порядок = порядок в интерфейсе. active:false — только история.
// stack — для группировки «JS · React», «JS · Vue». unit — чем задаются квоты набора:
// topic (темы JS-банка) или module (модули курса Python: M3…M11).
const TRACK_DEFS = [
  { track: FR, stack: "js", label: { uz: "JS · React", ru: "JS · React" }, active: true, unit: "topic" },
  { track: FV, stack: "js", label: { uz: "JS · Vue", ru: "JS · Vue" }, active: true, unit: "topic" },
  { track: BP, stack: "python", label: { uz: "Python", ru: "Python" }, active: true, unit: "module" },
  { track: BN, stack: "js", label: { uz: "Backend (Node.js)", ru: "Backend (Node.js) — архив" }, active: false, unit: "topic" },
];
const TRACK_LABELS = Object.fromEntries(TRACK_DEFS.map((d) => [d.track, d.label]));
const ACTIVE_TRACKS = TRACK_DEFS.filter((d) => d.active).map((d) => d.track);
const trackUnit = (track) => TRACK_DEFS.find((d) => d.track === track)?.unit || "topic";

// Сфера заявки → трек собеседования. Устаревшие mern-stack / full-stack → JS · React.
function sphereToTrack(sphere) {
  if ([FR, FV, BP, BN].includes(sphere)) return sphere;
  return FR;
}
const LANGUAGES = ["uz", "ru"];
const DEFAULT_LANGUAGE = "uz";

// Python-банк (27.11): тема = модуль курса, код вопроса «M3-05» (3-модуль, 5-вопрос).
// Модули 1–2 (HTML/CSS) своих вопросов не имеют — берутся из JS-банка (правило трека, extras).
const PY_MODULES = [
  { n: 3, uz: "Python asoslari", ru: "Основы Python" },
  { n: 4, uz: "Python: chuqurlashtirish", ru: "Python: углублённо" },
  { n: 5, uz: "OOP", ru: "ООП" },
  { n: 6, uz: "Telegram-botlar", ru: "Telegram-боты" },
  { n: 7, uz: "SQL va PostgreSQL", ru: "SQL и PostgreSQL" },
  { n: 8, uz: "Mahsulot darajasidagi botlar", ru: "Боты продуктового уровня" },
  { n: 9, uz: "Django asoslari", ru: "Основы Django" },
  { n: 10, uz: "Django: o'rta daraja", ru: "Django: средний уровень" },
  { n: 11, uz: "Django: professional daraja", ru: "Django: профессиональный уровень" },
];

const TOPIC_DEFS = [
  { prefix: "H", editor: "web", topic: "html", tracks: [FR, FV], codeLang: "html", names: ["HTML"], label: { uz: "HTML", ru: "HTML" } },
  { prefix: "C", editor: "web", topic: "css", tracks: [FR, FV], codeLang: "css", names: ["CSS"], label: { uz: "CSS", ru: "CSS" } },
  { prefix: "J", editor: "js", topic: "js", tracks: [FR, FV], codeLang: "js", names: ["JavaScript"], label: { uz: "JavaScript", ru: "JavaScript" } },
  { prefix: "R", editor: "jsx", topic: "react", tracks: [FR], codeLang: "jsx", names: ["React"], label: { uz: "React", ru: "React" } },
  { prefix: "V", editor: "vue", topic: "vue", tracks: [FV], codeLang: "vue", names: ["Vue"], label: { uz: "Vue", ru: "Vue" } },
  { prefix: "T", editor: "tailwind", topic: "tailwind", tracks: [FV], codeLang: "html", names: ["Tailwind CSS", "Tailwind"], label: { uz: "Tailwind CSS", ru: "Tailwind CSS" } },
  // Node.js в направлении JS (Абубакир 27.11): JS · React и JS · Vue = фронт + Node.
  { prefix: "N", editor: "node", topic: "node", tracks: [FR, FV, BN], codeLang: "js", names: ["Node.js", "Node"], label: { uz: "Node.js", ru: "Node.js" } },
  { prefix: "E", editor: "node", topic: "express", tracks: [BN], codeLang: "js", names: ["Express.js", "Express"], label: { uz: "Express", ru: "Express" } },
  { prefix: "D", editor: "node", topic: "database", tracks: [BN], codeLang: "js", names: ["MongoDB", "Ma'lumotlar bazasi", "SQL"], label: { uz: "Ma'lumotlar bazasi", ru: "Базы данных" } },
  { prefix: "A", editor: "node", topic: "api", tracks: [BN], codeLang: "js", names: ["API va HTTP", "API", "HTTP"], label: { uz: "API va HTTP", ru: "API и HTTP" } },
  ...PY_MODULES.map((m) => ({
    prefix: `M${m.n}`, module: m.n, editor: m.n === 7 ? "sql" : "python", topic: `py-m${m.n}`, tracks: [BP],
    codeLang: m.n === 7 ? "sql" : "python", names: [`M${m.n}`],
    label: { uz: `M${m.n} · ${m.uz}`, ru: `M${m.n} · ${m.ru}` },
  })),
];

const PREFIX = Object.fromEntries(TOPIC_DEFS.map((d) => [d.prefix, { topic: d.topic, tracks: d.tracks }]));
const CODE_LANG = Object.fromEntries(TOPIC_DEFS.map((d) => [d.prefix, d.codeLang]));
// Редактор ответа на amaliy-вопрос у кандидата (этап 4): web — HTML-документ
// со стилями и скриптами, js — чистый JS; у них есть превью и консоль в
// песочнице. jsx (R), vue (V), tailwind (T — Vue + Tailwind v4) — превью на Sandpack
// (этап 5). html / node / python / sql — только подсветка (Python в браузере не
// исполняется; Pyodide — отдельное предложение).
const EDITOR_BY_PREFIX = Object.fromEntries(TOPIC_DEFS.map((d) => [d.prefix, d.editor]));
const EDITOR_BY_TEMPLATE = { static: "web", vanilla: "js", react: "jsx", vue: "vue", "vue-tailwind": "tailwind", node: "node" };

// Вопрос (снимок сессии или банк) → редактор; null — ответ не код.
const EDITORS = ["web", "js", "jsx", "vue", "tailwind", "html", "node", "python", "sql"];
function editorFor(q) {
  if (!q || !["code", "sandbox"].includes(q.answerKind)) return null;
  if (EDITORS.includes(q.editor)) return q.editor; // явный выбор в редакторе банка
  const byTemplate = EDITOR_BY_TEMPLATE[q.sandbox?.template];
  if (byTemplate) return byTemplate;
  return defOfCode(q.code)?.editor || "js";
}
const TOPICS = TOPIC_DEFS.map((d) => d.topic);
const TOPIC_LABELS = Object.fromEntries(TOPIC_DEFS.map((d) => [d.topic, d.label]));
// Буквенные префиксы JS/backend-банка (H1, J22) и коды Python-банка (M3-05).
const PREFIX_CHARS = TOPIC_DEFS.filter((d) => !d.module).map((d) => d.prefix).join("");
const PY_CODE_PATTERN = "M\\d{1,2}-\\d{2}";
const CODE_PATTERN = `(?:[${PREFIX_CHARS}]\\d{1,3}|${PY_CODE_PATTERN})`;

// Код вопроса → описание темы (по модулю для M3-05, по букве для J22) или null.
function defOfCode(code) {
  const s = String(code || "");
  const m = s.match(/^M(\d{1,2})-\d{2}$/);
  if (m) return TOPIC_DEFS.find((d) => d.module === Number(m[1])) || null;
  return TOPIC_DEFS.find((d) => !d.module && d.prefix === s.charAt(0)) || null;
}

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
  PREFIX_CHARS, CODE_PATTERN, PY_CODE_PATTERN, APOS, escapeRe, topicByName, editorFor, EDITOR_BY_PREFIX, EDITORS,
  defOfCode, PY_MODULES, TRACK_DEFS, TRACK_LABELS, ACTIVE_TRACKS, trackUnit, sphereToTrack, FR, FV, BN, BP,
};
