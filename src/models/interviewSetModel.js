const mongoose = require("mongoose");
const { BANK_TRACKS } = require("../config/questionBankTopics");

// Набор вопросов для собеседования: упорядоченный список кодов банка.
// 15+15 готовых наборов импортируются из docx (source "docx"); дальше —
// сгенерированные по правилу (этап 3) или собранные вручную.
// «Кто какой набор взял» отдельно не хранится: это InterviewSession.set.
const interviewSetSchema = new mongoose.Schema(
  {
    track: { type: String, enum: BANK_TRACKS, required: true },
    number: { type: Number, required: true },
    questionCodes: { type: [String], default: [] },
    size: { type: Number, default: 0 },
    source: { type: String, enum: ["docx", "generated", "manual"], default: "manual" },
    isActive: { type: Boolean, default: true },
    updatedBy: { type: String, default: "import" },
    contentHash: { type: String, default: "" },
  },
  { timestamps: true }
);

interviewSetSchema.index({ track: 1, number: 1 }, { unique: true });

// Набор с неверным составом по уровням не сохраняется (create/save — путь
// генератора и ручного выбора). Импорт docx проверяет то же в validateBank.
interviewSetSchema.pre("validate", async function checkLevels() {
  if (!this.isNew && !this.isModified("questionCodes")) return;
  const { checkSetLevels, fmt } = require("../utils/questionBank/setLevels");
  const BankQuestion = require("./bankQuestionModel");
  const Setting = require("./settingModel");
  const [qs, rules] = await Promise.all([
    BankQuestion.find({ code: { $in: this.questionCodes } }).select("code level").lean(),
    Setting.findOne({ key: "questionBankRules" }).lean(),
  ]);
  const levelOf = new Map(qs.map((q) => [q.code, q.level]));
  const missing = this.questionCodes.filter((c) => !levelOf.has(c));
  if (missing.length) throw new Error(`Набор: нет в банке ${missing.join(", ")}`);
  const r = checkSetLevels(this.questionCodes.map((c) => levelOf.get(c)), rules?.value);
  if (!r.ok) throw new Error(`Набор: уровни ${fmt(r.got)}, по правилу ${fmt(r.want)} — собеседования должны быть одинаковыми по сложности`);
  this.size = this.questionCodes.length;
});

module.exports = mongoose.model("InterviewSet", interviewSetSchema);
