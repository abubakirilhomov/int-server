const mongoose = require("mongoose");

// Журнал операций с физическими жёлтыми бейджиками (sariq bejik).
// Каждая запись = одно действие ресепшена над бейджиком конкретного интерна:
//   given    — выдал интерну (открыл заём),
//   returned — принял назад (закрыл заём),
//   lost     — списал как утерянный / негодный (уменьшает фактический stock).
// Живое состояние "у кого сейчас на руках" держится в Intern.receptionBadge;
// этот журнал — источник ИСТОРИИ и доказательств ("когда, сколько, кем"),
// именно его отсутствие и было корнем проблемы (бейджики уходили без следа).
const badgeEventSchema = new mongoose.Schema({
  intern: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Intern",
    required: true,
    index: true,
  },
  branch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Branch",
    required: true,
    index: true,
  },
  action: {
    type: String,
    enum: ["given", "returned", "lost"],
    required: true,
  },
  at: { type: Date, default: Date.now, index: true },
  // Кто оформил (администратор ресепшена или админ). Ссылка на Mentor-аккаунт.
  by: { type: mongoose.Schema.Types.ObjectId, ref: "Mentor", default: null },
  byName: { type: String, trim: true, default: "" },
  note: { type: String, trim: true, default: "" },
});

// Быстрый доступ к последним событиям филиала (лента, посуточные отчёты).
badgeEventSchema.index({ branch: 1, at: -1 });

module.exports = mongoose.model("BadgeEvent", badgeEventSchema);
