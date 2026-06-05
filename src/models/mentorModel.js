const mongoose = require('mongoose');

const mentorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  lastName: { type: String, required: false },
  profilePhoto: { type: String, trim: true, default: "" },
  password: { type: String, required: true, select: false },
  branches: [{ type: mongoose.Schema.Types.ObjectId, ref: "Branch" }],
  role: {
    type: String,
    enum: ['mentor', 'admin', 'branchManager'],
    default: 'mentor'
  },
  // Админ-доступ, ортогональный к `role`. Позволяет ментору оставаться
  // выбираемым учебным ментором (role: "mentor") и одновременно иметь админку.
  // Легаси-аккаунты с role: "admin" продолжают считаться админами (см. utils/isAdminUser).
  isAdmin: { type: Boolean, default: false },
  marsId: {
    sub: { type: String, index: { unique: true, sparse: true } },
    handle: { type: String, trim: true },
    tg: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    linkedAt: { type: Date },
  },
  telegramChatId: { type: String, trim: true, default: "", select: false },
  createdAt: { type: Date, default: Date.now }
});

// Virtual for backward compatibility
mentorSchema.virtual("branch").get(function () {
  return this.branches?.[0] || null;
});

module.exports = mongoose.model('Mentor', mentorSchema);
