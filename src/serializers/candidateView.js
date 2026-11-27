// Единственное место, где данные сессии превращаются в ответ КАНДИДАТУ.
// Белый список полей: всё, что не перечислено, кандидат не получает —
// ни ответ-черновик, ни оценку/заметку интервьюера, ни коды банка, ни
// уровень, ни скрытые (ещё не открытые) вопросы, ни их количество.
// Любое новое поле добавляется сюда осознанно и покрывается тестом
// tests/candidateView.test.js.
//
// Язык: кандидат получает тексты на выбранном языке (uz | ru); если перевода
// нет — узбекский. Варианты ответа — без отметки верного.
const { normalizeLanguage, localized, localizedOptions } = require("../utils/questionBank/i18n");

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

module.exports = { toCandidateQuestion, toCandidateSession };
