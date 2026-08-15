const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    // To'g'ri / Chala / Noto'g'ri — 3 holatli baholash
    // correct: 10%, partial: 5%, wrong: 0%
    result: {
      type: String,
      enum: ["correct", "partial", "wrong"],
      default: "wrong",
    },
    isCorrect: { type: Boolean, default: false }, // backward compat: correct == true
    note: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const monthlyInterviewSchema = new mongoose.Schema(
  {
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    intern: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Intern",
      required: true,
      index: true,
    },
    headIntern: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Intern",
      required: true,
    },
    month: { type: String, required: true, index: true }, // "2026-08"
    status: {
      type: String,
      enum: ["pending", "passed", "failed"],
      default: "pending",
      index: true,
    },
    questions: { type: [questionSchema], default: [] },
    passedCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    resultNote: { type: String, trim: true, default: "" },
    conductedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Har oyda har bir intern uchun bitta yozuv
monthlyInterviewSchema.index({ intern: 1, month: 1 }, { unique: true });

module.exports = mongoose.model("MonthlyInterview", monthlyInterviewSchema);