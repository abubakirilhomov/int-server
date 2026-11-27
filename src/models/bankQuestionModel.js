const mongoose = require("mongoose");

// Банк вопросов для живых собеседований кандидатов (frontend-треки).
// Содержимое КОНФИДЕНЦИАЛЬНО: живёт только в БД, импортируется скриптом
// scripts/import-question-bank.js из файла вне репозитория (репо публичный).
// Старый InterviewTopic (метки тем для чек-листа) остаётся для backend-трека.

const TOPICS = ["html", "css", "js", "react", "vue", "tailwind"];
const LEVELS = ["oson", "orta", "qiyin"];
const ANSWER_KINDS = ["text", "code", "sandbox"];
const SANDBOX_TEMPLATES = ["static", "vanilla", "react", "vue", "vue-tailwind"];

// Префикс кода → тема и треки. H/C/J — общая база для обоих направлений.
const PREFIX = {
  H: { topic: "html", tracks: ["frontend-react", "frontend-vue"] },
  C: { topic: "css", tracks: ["frontend-react", "frontend-vue"] },
  J: { topic: "js", tracks: ["frontend-react", "frontend-vue"] },
  R: { topic: "react", tracks: ["frontend-react"] },
  V: { topic: "vue", tracks: ["frontend-vue"] },
  T: { topic: "tailwind", tracks: ["frontend-vue"] },
};

const bankQuestionSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, match: /^[HCJRVT]\d{1,3}$/ },
    topic: { type: String, enum: TOPICS, required: true, index: true },
    tracks: { type: [String], default: [], index: true },
    level: { type: String, enum: LEVELS, required: true },
    isPractical: { type: Boolean, default: false },
    isMiniTask: { type: Boolean, default: false },
    order: { type: Number, default: 0 }, // номер внутри темы (H1 → 1)

    // То, что видит кандидат (markdown, код — в ```-блоках).
    prompt: { type: String, required: true },
    promptShort: { type: String, default: "" },
    // Ответ-черновик — ТОЛЬКО для интервьюера. select:false: случайный
    // find() его не вернёт, админские запросы просят явно (+expectedAnswer).
    expectedAnswer: { type: String, default: "", select: false },

    answerKind: { type: String, enum: ANSWER_KINDS, default: "text" },
    sandbox: {
      template: { type: String, enum: SANDBOX_TEMPLATES, default: undefined },
      files: { type: Map, of: String, default: undefined },
    },
    // Автотесты мини-заданий (этап 6). Кандидату не отдаются.
    tests: { type: [{ name: String, code: String }], default: [], select: false },

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

bankQuestionSchema.statics.TOPICS = TOPICS;
bankQuestionSchema.statics.LEVELS = LEVELS;
bankQuestionSchema.statics.PREFIX = PREFIX;

module.exports = mongoose.model("BankQuestion", bankQuestionSchema);
