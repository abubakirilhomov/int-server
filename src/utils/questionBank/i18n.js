// Двуязычные поля вопроса банка (uz — основной, ru — перевод). Чистые функции.
const crypto = require("crypto");
const { LANGUAGES, DEFAULT_LANGUAGE } = require("../../config/questionBankTopics");

const RU_FIELDS = ["promptRu", "promptShortRu", "expectedAnswerRu"];

// Неизвестный язык → узбекский.
function normalizeLanguage(lang) {
  const l = String(lang || "").toLowerCase();
  return LANGUAGES.includes(l) ? l : DEFAULT_LANGUAGE;
}

// Хеш узбекского текста вопроса: с него сделан перевод. Метаданные (уровень,
// треки) не входят — их правка перевод не портит.
function uzTextHash(q) {
  const options = (q.options || []).map((o) => ({ key: o.key, text: o.text }));
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      prompt: q.prompt || "",
      promptShort: q.promptShort || "",
      expectedAnswer: q.expectedAnswer || "",
      ...(options.length ? { options } : {}),
    }))
    .digest("hex");
}

// "missing" — перевода нет; "stale" — uz изменился после перевода; "ok".
// Нужен документ с expectedAnswer (select +expectedAnswer), иначе хеш другой.
function translationStatus(q) {
  if (!q.promptRu) return "missing";
  return q.ruSourceHash && q.ruSourceHash === uzTextHash(q) ? "ok" : "stale";
}

// Текст на нужном языке с fallback на узбекский (по каждому полю отдельно).
function localized(q, field, lang) {
  if (normalizeLanguage(lang) === "ru") {
    const ru = q[`${field}Ru`];
    if (ru && String(ru).trim()) return String(ru);
  }
  return String(q[field] || "");
}

function localizedOptions(options, lang) {
  if (!Array.isArray(options) || !options.length) return undefined;
  const ru = normalizeLanguage(lang) === "ru";
  return options.map((o) => ({
    key: String(o.key),
    text: ru && o.textRu && String(o.textRu).trim() ? String(o.textRu) : String(o.text || ""),
  }));
}

module.exports = { RU_FIELDS, normalizeLanguage, uzTextHash, translationStatus, localized, localizedOptions };
