const mongoose = require("mongoose");

// Живая сессия собеседования (Interview.mode = "live"), 1:1 с Interview.
// questions[] — снимки вопросов на момент старта: правка банка не меняет
// прошедшие собеседования. expectedAnswer в снимок НЕ копируется —
// интервьюер получает его из банка по code.
const QUESTION_STATES = ["hidden", "open", "closed"];
const RESULTS = ["pass", "partial", "fail"];

const sessionQuestionSchema = new mongoose.Schema(
  {
    code: { type: String, required: true },
    order: { type: Number, required: true },
    topic: String,
    level: String,
    isPractical: Boolean,
    prompt: { type: String, required: true },
    promptShort: String,
    answerKind: { type: String, default: "text" },
    sandbox: {
      template: { type: String, default: undefined },
      files: { type: Map, of: String, default: undefined },
    },
    state: { type: String, enum: QUESTION_STATES, default: "hidden" },
    discussOnly: { type: Boolean, default: false },
    openedAt: Date,
    closedAt: Date,
    result: { type: String, enum: [...RESULTS, null], default: null },
    note: { type: String, default: "" },
  },
  { _id: false }
);

const signalSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["focus_lost", "focus_back", "paste"], required: true },
    questionCode: String,
    at: { type: Date, default: Date.now },
    meta: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  { _id: false }
);

const interviewSessionSchema = new mongoose.Schema(
  {
    interview: { type: mongoose.Schema.Types.ObjectId, ref: "Interview", required: true, unique: true },
    set: { type: mongoose.Schema.Types.ObjectId, ref: "InterviewSet", default: null, index: true },
    track: { type: String, required: true },
    interviewer: { type: mongoose.Schema.Types.ObjectId, ref: "Mentor", default: null },
    status: {
      type: String,
      enum: ["lobby", "live", "finished", "aborted"],
      default: "lobby",
      index: true,
    },
    // Растёт при любом изменении — на нём держится опрос (?rev=N → 304).
    rev: { type: Number, default: 0 },
    currentIndex: { type: Number, default: -1 },
    questions: { type: [sessionQuestionSchema], default: [] },
    signals: { type: [signalSchema], default: [] },
    startedAt: Date,
    finishedAt: Date,
  },
  { timestamps: true }
);

interviewSessionSchema.statics.QUESTION_STATES = QUESTION_STATES;

module.exports = mongoose.model("InterviewSession", interviewSessionSchema);
