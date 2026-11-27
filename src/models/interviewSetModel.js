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
// генератора и ручного выбора). Правило — на трек (utils/questionBank/trackRules):
// уровни считаются по основному составу, extras трека (Python: HTML/CSS из JS-банка)
// проверяются лимитами. Импорт docx проверяет то же в validateBank / validatePythonBank.
interviewSetSchema.pre("validate", async function checkLevels() {
  if (!this.isNew && !this.isModified("questionCodes")) return;
  const { trackRules, checkComposition } = require("../utils/questionBank/trackRules");
  const BankQuestion = require("./bankQuestionModel");
  const Setting = require("./settingModel");
  const [qs, rules] = await Promise.all([
    BankQuestion.find({ code: { $in: this.questionCodes } }).select("code level topic tracks isPractical isMiniTask conflictGroup order").lean(),
    Setting.findOne({ key: "questionBankRules" }).lean(),
  ]);
  const byCode = new Map(qs.map((q) => [q.code, q]));
  const missing = this.questionCodes.filter((c) => !byCode.has(c));
  if (missing.length) throw new Error(`Набор: нет в банке ${missing.join(", ")}`);
  const r = checkComposition(this.questionCodes.map((c) => byCode.get(c)), trackRules(rules?.value, this.track));
  if (r.block.length) throw new Error(`Набор: ${r.block.join("; ")}`);
  this.size = this.questionCodes.length;
});

module.exports = mongoose.model("InterviewSet", interviewSetSchema);
