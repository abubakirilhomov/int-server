const mongoose = require("mongoose");
const { TOPICS, PREFIX, CODE_PATTERN, BANK_TRACKS } = require("../config/questionBankTopics");
const { questionDemoSchema, questionDemoFixSchema } = require("./schemas/questionDemoSchema");
const { normalizeDemo, normalizeDemoFix } = require("../utils/questionBank/demo");

// Банк вопросов для живых собеседований кандидатов.
// Содержимое КОНФИДЕНЦИАЛЬНО: живёт только в БД, импортируется скриптами
// scripts/import-question-bank.js (uz, docx) и scripts/import-question-translations.js
// (ru, json) из файлов вне репозитория (репо публичный).
// Старый InterviewTopic (метки тем для чек-листа) остаётся, пока у трека нет наборов.
//
// Языки: основной — узбекский (поля без суффикса), перевод — поля *Ru.
// Кандидат получает выбранный язык, при пустом переводе — узбекский
// (serializers/candidateView). ruSourceHash — хеш узбекского текста, с
// которого сделан перевод: правка uz делает перевод «устаревшим», а не тихо неверным.

const LEVELS = ["oson", "orta", "qiyin"];
const ANSWER_KINDS = ["text", "code", "sandbox", "choice"];
const SANDBOX_TEMPLATES = ["static", "vanilla", "react", "vue", "vue-tailwind", "node"];

// Вариант ответа (answerKind "choice"). correct — только для интервьюера.
const optionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // "A", "B", …
    text: { type: String, required: true },
    textRu: { type: String, default: "" },
    correct: { type: Boolean, default: false, select: false },
  },
  { _id: false }
);

const bankQuestionSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, match: new RegExp(`^${CODE_PATTERN}$`) },
    topic: { type: String, enum: TOPICS, required: true, index: true },
    tracks: { type: [{ type: String, enum: BANK_TRACKS }], default: [], index: true },
    level: { type: String, enum: LEVELS, required: true },
    isPractical: { type: Boolean, default: false },
    isMiniTask: { type: Boolean, default: false },
    order: { type: Number, default: 0 }, // номер внутри темы (H1 → 1)

    // То, что видит кандидат (markdown, код — в ```-блоках).
    prompt: { type: String, required: true },
    promptRu: { type: String, default: "" },
    promptShort: { type: String, default: "" },
    promptShortRu: { type: String, default: "" },
    // Ответ-черновик или критерии оценки — ТОЛЬКО для интервьюера. select:false:
    // случайный find() его не вернёт, админские запросы просят явно (+expectedAnswer).
    expectedAnswer: { type: String, default: "", select: false },
    expectedAnswerRu: { type: String, default: "", select: false },
    options: { type: [optionSchema], default: undefined },

    // Перевод на русский: с какого uz-текста сделан (utils/questionBank/i18n.uzTextHash).
    ruSourceHash: { type: String, default: "" },
    ruUpdatedAt: { type: Date, default: null },
    ruUpdatedBy: { type: String, default: "" },

    answerKind: { type: String, enum: ANSWER_KINDS, default: "text" },
    sandbox: {
      template: { type: String, enum: SANDBOX_TEMPLATES, default: undefined },
      files: { type: Map, of: String, default: undefined },
    },
    // Автотесты мини-заданий (этап 6). Кандидату не отдаются.
    tests: { type: [{ name: String, code: String }], default: [], select: false },

    // Живая сцена под вопросом (utils/questionBank/demo.js). Кандидату — только
    // при demo.audience "candidate". demoFix — исправленная сцена, ТОЛЬКО для
    // интервьюера: select:false, как expectedAnswer.
    demo: { type: questionDemoSchema, default: undefined },
    demoFix: { type: questionDemoFixSchema, default: undefined, select: false },

    // Вопросы одной группы не попадают в один набор (правило раздела 2 банка).
    conflictGroup: { type: String, default: null },

    isActive: { type: Boolean, default: true, index: true },
    version: { type: Number, default: 1 },
    source: { type: String, default: "manual" },
    // "import" — запись принадлежит импорту и обновляется им; иначе id
    // админа, правившего вопрос: повторный импорт её не трогает.
    updatedBy: { type: String, default: "import" },
    contentHash: { type: String, default: "" },
  },
  { timestamps: true }
);

// Сцена проверяется целиком (типы шагов, лимиты) при каждом сохранении.
bankQuestionSchema.pre("validate", function checkDemo() {
  for (const [field, normalize] of [["demo", normalizeDemo], ["demoFix", normalizeDemoFix]]) {
    if (!this.isModified(field) || !this[field]) continue;
    try {
      normalize(this[field].toObject ? this[field].toObject() : this[field]);
    } catch (e) {
      this.invalidate(field, e.message);
    }
  }
});

bankQuestionSchema.statics.TOPICS = TOPICS;
bankQuestionSchema.statics.LEVELS = LEVELS;
bankQuestionSchema.statics.PREFIX = PREFIX;

module.exports = mongoose.model("BankQuestion", bankQuestionSchema);
