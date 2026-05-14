const mongoose = require("mongoose");

const SPHERES = [
  "backend-nodejs",
  "backend-python",
  "frontend-react",
  "frontend-vue",
  "mern-stack",
  "full-stack",
];

const SHIFTS = ["morning", "evening"];

const STATUSES = [
  "pending",
  "contacted",
  "interview_scheduled",
  "no_show",
  "accepted",
  "rejected",
  "duplicate",
];

const applicationSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 50 },
    lastName: { type: String, required: true, trim: true, maxlength: 50 },
    phone: { type: String, required: true, trim: true, index: true },
    telegramUsername: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    age: { type: Number, required: true, min: 14, max: 60 },

    branch: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true },
    mentor: { type: mongoose.Schema.Types.ObjectId, ref: "Mentor", required: true },
    sphere: { type: String, required: true, enum: SPHERES },
    shift: { type: String, required: true, enum: SHIFTS },

    status: { type: String, enum: STATUSES, default: "pending", index: true },
    notes: { type: String, trim: true, default: "" },
    rejectionReason: { type: String, trim: true, default: "" },
    interviewDate: { type: Date, default: null },

    source: { type: String, default: "internUp" },

    submitterIp: { type: String, default: "", select: false },
    telegramNotified: { type: Boolean, default: false },
    telegramError: { type: String, default: null },
    notifiedChatIds: { type: [String], default: [], select: false },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Mentor", default: null },
    reviewedAt: { type: Date, default: null },
    convertedToIntern: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Intern",
      default: null,
    },
  },
  { timestamps: true }
);

applicationSchema.index({ phone: 1, createdAt: -1 });
applicationSchema.index({ telegramUsername: 1, createdAt: -1 });

applicationSchema.statics.SPHERES = SPHERES;
applicationSchema.statics.SHIFTS = SHIFTS;
applicationSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model("Application", applicationSchema);
