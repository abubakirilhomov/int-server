const mongoose = require("mongoose");

// Ответ кандидата на вопрос живой сессии. Отдельная коллекция: код большой,
// автосохранение пишет часто — во встроенном массиве сессии это упиралось бы
// в лимит размера документа и гонки записи.
const MAX_ANSWER_BYTES = 100 * 1024;

const answerSchema = new mongoose.Schema(
  {
    session: { type: mongoose.Schema.Types.ObjectId, ref: "InterviewSession", required: true },
    questionCode: { type: String, required: true },
    kind: { type: String, enum: ["text", "code", "sandbox", "choice"], default: "text" },
    text: { type: String, default: "" },
    files: { type: Map, of: String, default: undefined },
    revision: { type: Number, default: 0 },
    draftUpdatedAt: Date,
    // Кандидат нажал «Отправить» (последний раз). Черновик можно менять, пока вопрос открыт.
    submittedAt: { type: Date, default: null },
    frozenAt: { type: Date, default: null }, // вопрос закрыт → запись запрещена (409)
  },
  { timestamps: true }
);

answerSchema.index({ session: 1, questionCode: 1 }, { unique: true });
answerSchema.statics.MAX_ANSWER_BYTES = MAX_ANSWER_BYTES;

module.exports = mongoose.model("Answer", answerSchema);
