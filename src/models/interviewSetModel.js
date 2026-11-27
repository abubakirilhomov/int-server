const mongoose = require("mongoose");

// Набор вопросов для собеседования: упорядоченный список кодов банка.
// 15+15 готовых наборов импортируются из docx (source "docx"); дальше —
// сгенерированные по правилу (этап 3) или собранные вручную.
// «Кто какой набор взял» отдельно не хранится: это InterviewSession.set.
const interviewSetSchema = new mongoose.Schema(
  {
    track: { type: String, enum: ["frontend-react", "frontend-vue"], required: true },
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

module.exports = mongoose.model("InterviewSet", interviewSetSchema);
