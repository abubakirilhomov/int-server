// Единственное место, где данные сессии превращаются в ответ КАНДИДАТУ.
// Белый список полей: всё, что не перечислено, кандидат не получает —
// ни ответ-черновик, ни оценку/заметку интервьюера, ни коды банка, ни
// уровень, ни скрытые (ещё не открытые) вопросы, ни их количество.
// Любое новое поле добавляется сюда осознанно и покрывается тестом
// tests/candidateView.test.js.
//
// Язык: кандидат получает тексты на выбранном языке (uz | ru); если перевода
// нет — узбекский. Варианты ответа — без отметки верного.
//
// Живая сцена (demo): только при audience "candidate" (сцена «для интервьюера»
// сама содержит ответ) и только поля из DEMO_FIELDS. Исправленная сцена
// (demoFix) кандидату не отдаётся никогда — здесь её даже не читают.
const { normalizeLanguage, localized, localizedOptions } = require("../utils/questionBank/i18n");

const DEMO_FIELDS = ["html", "css", "height", "width", "slider", "layers3d"];
const STEP_FIELDS = ["type", "ms", "target", "to", "className"];

function plainSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) return [];
  return steps.map((s) => {
    const src = s && typeof s.toObject === "function" ? s.toObject() : s || {};
    const out = {};
    STEP_FIELDS.forEach((k) => { if (src[k] !== undefined) out[k] = src[k]; });
    return out;
  });
}

function toCandidateDemo(demo, lang) {
  if (!demo || !demo.html || (demo.audience || "candidate") !== "candidate") return undefined;
  const out = {};
  DEMO_FIELDS.forEach((k) => { if (demo[k] !== undefined) out[k] = demo[k]; });
  out.steps = plainSteps(demo.steps);
  out.caption = localized(demo, "caption", lang);
  return out;
}

function plainFiles(files) {
  if (!files) return undefined;
  const entries = files instanceof Map ? [...files.entries()] : Object.entries(files);
  if (!entries.length) return undefined;
  return Object.fromEntries(entries.map(([k, v]) => [String(k), String(v)]));
}

// Вопрос (снимок сессии или документ банка) → вид для кандидата.
// `position` — порядковый номер среди показанных кандидату вопросов (1, 2, …),
// а не номер в наборе: так кандидат не узнаёт размер набора.
function toCandidateQuestion(q, position, lang) {
  if (!q) return null;
  const out = {
    position,
    prompt: localized(q, "prompt", lang),
    answerKind: q.answerKind || "text",
  };
  const options = localizedOptions(q.options, lang);
  if (options) out.options = options;
  if (q.state) out.state = q.state === "closed" ? "closed" : "open";
  if (q.discussOnly) out.discussOnly = true;
  const files = plainFiles(q.sandbox?.files);
  if (q.sandbox?.template || files) {
    out.sandbox = { template: q.sandbox?.template || null, files: files || {} };
  }
  const demo = toCandidateDemo(q.demo, lang);
  if (demo) out.demo = demo;
  return out;
}

// Сессия → вид для кандидата: только открытые и закрытые вопросы.
// lang — явный выбор в запросе; по умолчанию язык сессии.
function toCandidateSession(session, lang) {
  if (!session) return null;
  const language = normalizeLanguage(lang || session.language);
  const visible = (session.questions || [])
    .filter((q) => q.state === "open" || q.state === "closed")
    .sort((a, b) => (a.openedAt ? +new Date(a.openedAt) : 0) - (b.openedAt ? +new Date(b.openedAt) : 0));
  const questions = visible.map((q, i) => toCandidateQuestion(q, i + 1, language));
  const currentIdx = visible.findIndex((q) => q.state === "open");
  return {
    status: session.status === "finished" || session.status === "aborted" ? "finished" : session.status,
    rev: Number(session.rev) || 0,
    language,
    current: currentIdx >= 0 ? questions[currentIdx].position : null,
    questions,
  };
}

module.exports = { toCandidateQuestion, toCandidateSession, toCandidateDemo };
