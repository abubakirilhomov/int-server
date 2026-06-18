const mongoose = require("mongoose");

const SPHERES = [
  "backend-nodejs",
  "backend-python",
  "frontend-react",
  "frontend-vue",
  "mern-stack",
  "full-stack",
];

const STATUSES = ["pending", "approved", "rejected"];

// Заявка хед-интерна на создание нового интерна. Хед заполняет данные «вживую»
// рядом с новичком; админ рассматривает и при аппруве реально создаёт интерна
// через internService.createIntern. Пароль НЕ хранится в заявке — генерируется
// при аппруве (см. контроллер). Грейд всегда junior (форсится при создании).
const internRequestSchema = new mongoose.Schema(
  {
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Intern",
      required: true,
      index: true,
    },
    requestedByName: { type: String, trim: true, default: "" },

    // Филиал форсится сервером = активный филиал хед-интерна.
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    mentor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Mentor",
      required: true,
    },

    // Предлагаемые данные интерна
    name: { type: String, required: true, trim: true, maxlength: 50 },
    lastName: { type: String, required: true, trim: true, maxlength: 50 },
    username: { type: String, required: true, trim: true },
    sphere: { type: String, enum: SPHERES, default: "backend-nodejs" },
    phoneNumber: { type: String, trim: true, default: "" },
    telegram: { type: String, trim: true, default: "" },
    profilePhoto: { type: String, trim: true, default: "" },
    dateJoined: { type: Date, default: Date.now },

    // Workflow
    status: { type: String, enum: STATUSES, default: "pending", index: true },
    rejectionReason: { type: String, trim: true, default: "" },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Mentor",
      default: null,
    },
    reviewedAt: { type: Date, default: null },
    createdIntern: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Intern",
      default: null,
    },
    // Временный пароль, выданный при аппруве — показывается хед-интерну в
    // «Мои заявки», чтобы передать новичку. Интерн меняет его при первом входе.
    tempPassword: { type: String, default: "" },
  },
  { timestamps: true }
);

internRequestSchema.statics.SPHERES = SPHERES;
internRequestSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model("InternRequest", internRequestSchema);
