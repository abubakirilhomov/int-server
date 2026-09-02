const mongoose = require("mongoose");

// Bitta filialning bitta oylik "online suhbat" sessiyasi. Video/ovoz
// tashqarida (Zoom/Meet — meetingUrl) o'tadi, bu model faqat rejalashtirish va
// davomatni (heartbeat orqali) kuzatish uchun.
const attendanceSchema = new mongoose.Schema(
  {
    intern: { type: mongoose.Schema.Types.ObjectId, ref: "Intern", required: true },
    joinedAt: { type: Date, default: null },
    lastHeartbeatAt: { type: Date, default: null },
    leftAt: { type: Date, default: null },
    result: {
      type: String,
      enum: ["pending", "present", "missed"],
      default: "pending",
    },
    // Intern oldindan "kira olmayman" deb sabab yozib qo'ysa — natija baribir
    // "missed" bo'ladi, lekin sabab MonthlyInterview.resultNote'ga ko'chadi
    // (finalizeSession'da), shunda head intern/admin nega kirmaganini ko'radi.
    excuseReason: { type: String, trim: true, default: "" },
    excusedAt: { type: Date, default: null },
  },
  { _id: false }
);

const monthlyInterviewSessionSchema = new mongoose.Schema(
  {
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    headIntern: { type: mongoose.Schema.Types.ObjectId, ref: "Intern", required: true },
    month: { type: String, required: true, index: true }, // "2026-08"
    scheduledAt: { type: Date, required: true },
    meetingUrl: { type: String, required: true, trim: true },
    joinToken: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["scheduled", "finalized"],
      default: "scheduled",
      index: true,
    },
    attendance: { type: [attendanceSchema], default: [] },
    finalizedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Har oyda har bir filial uchun bitta sessiya
monthlyInterviewSessionSchema.index({ branch: 1, month: 1 }, { unique: true });

module.exports = mongoose.model("MonthlyInterviewSession", monthlyInterviewSessionSchema);
