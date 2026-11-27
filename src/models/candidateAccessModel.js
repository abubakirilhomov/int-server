const mongoose = require("mongoose");

// Логин кандидата на ОДНО собеседование. Данные человека — в Application.
// Токен подписывается отдельным ключом (utils/tokenKeys: "candidate"), поэтому
// общий middleware/auth его не принимает — кандидат не видит API интернов.
const candidateAccessSchema = new mongoose.Schema(
  {
    application: { type: mongoose.Schema.Types.ObjectId, ref: "Application", required: true, index: true },
    interview: { type: mongoose.Schema.Types.ObjectId, ref: "Interview", required: true, unique: true },
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    passwordShownAt: { type: Date, default: null },
    validFrom: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
    status: { type: String, enum: ["active", "revoked", "expired"], default: "active", index: true },
    revokedAt: { type: Date, default: null },
    revokeReason: { type: String, enum: ["finished", "manual", "expired", "canceled", null], default: null },
    // Растёт при отзыве/сбросе пароля — гасит все выданные токены сразу.
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: { type: Date, default: null },
    loginCount: { type: Number, default: 0 },
    failedLogins: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Mentor", default: null },
  },
  { timestamps: true }
);

// Активен ли доступ в момент `now` (окно + статус).
candidateAccessSchema.methods.isUsableAt = function isUsableAt(now = new Date()) {
  return this.status === "active" && now >= this.validFrom && now <= this.expiresAt;
};

module.exports = mongoose.model("CandidateAccess", candidateAccessSchema);
