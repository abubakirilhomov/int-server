const mongoose = require("mongoose");

// Схемы живой сцены вопроса (формат и проверки — utils/questionBank/demo.js).
// Шаги сценария хранятся как есть (Mixed): их проверяет normalizeDemo.

const stepsField = { type: [mongoose.Schema.Types.Mixed], default: undefined };

const questionDemoSchema = new mongoose.Schema(
  {
    html: { type: String, default: "" },
    css: { type: String, default: "" },
    steps: stepsField,
    caption: { type: String, default: "" },
    captionRu: { type: String, default: "" },
    height: { type: Number, default: 320 },
    width: { type: Number, default: 375 },
    slider: { type: Boolean, default: false },
    layers3d: { type: Boolean, default: false },
    audience: { type: String, enum: ["candidate", "interviewer"], default: "candidate" },
    runtime: { type: String, enum: ["react", "vue"], default: undefined },
  },
  { _id: false }
);

// Сцена после исправления — только для интервьюера.
const questionDemoFixSchema = new mongoose.Schema(
  {
    html: { type: String, default: "" },
    css: { type: String, default: "" },
    steps: stepsField,
    caption: { type: String, default: "" },
    captionRu: { type: String, default: "" },
  },
  { _id: false }
);

module.exports = { questionDemoSchema, questionDemoFixSchema };
