const mongoose = require("mongoose");

// Треки приёма. Банк тем (InterviewTopic) тоже ключится по track.
const TRACKS = ["frontend-react", "backend-nodejs"];
const STATUSES = ["scheduled", "completed", "no_show", "canceled"];
const RESULTS = ["pass", "partial", "fail"];

// Снимок темы на момент собеседования (Фаза 2). Храним label/weight копией,
// чтобы редактирование банка задним числом не меняло прошлые результаты.
const itemSchema = new mongoose.Schema(
  {
    topic: { type: mongoose.Schema.Types.ObjectId, ref: "InterviewTopic" },
    label: String,
    labelRu: String,
    category: String,
    weight: { type: Number, default: 1 },
    result: { type: String, enum: RESULTS },
    earned: { type: Number, default: 0 },
    note: { type: String, default: "" },
  },
  { _id: false }
);

const interviewSchema = new mongoose.Schema(
  {
    application: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      index: true,
    },
    track: { type: String, enum: TRACKS, required: true },

    // Расписание (Фаза 1)
    scheduledAt: { type: Date, required: true, index: true },
    conductedAt: { type: Date, default: null },
    status: { type: String, enum: STATUSES, default: "scheduled", index: true },
    interviewer: { type: mongoose.Schema.Types.ObjectId, ref: "Mentor", default: null },
    attemptNumber: { type: Number, default: 1 },

    // Темы для фокуса при пересдаче — проваленные темы (roadmap) прошлой
    // попытки. Пусто для первой попытки. Экран оценки повторного собеса по
    // умолчанию показывает только их.
    focusTopics: [{ type: mongoose.Schema.Types.ObjectId, ref: "InterviewTopic" }],

    // Оценка (Фаза 2) — заполняется через PATCH /interviews/:id/score
    items: { type: [itemSchema], default: [] },
    scoreEarned: { type: Number, default: 0 },
    scoreTotal: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    passed: { type: Boolean, default: null },
    roadmap: { type: [String], default: [] },
    resultNote: { type: String, default: "" },
    cooldownUntil: { type: Date, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Mentor", default: null },
  },
  { timestamps: true }
);

interviewSchema.statics.TRACKS = TRACKS;
interviewSchema.statics.STATUSES = STATUSES;
interviewSchema.statics.RESULTS = RESULTS;

module.exports = mongoose.model("Interview", interviewSchema);
