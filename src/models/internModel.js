const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const grades = require("../config/grades");
const Mentor = require("./mentorModel");
const Lesson = require("./lessonModel");

const internSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true, minlength: 8 },
  branch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Branch",
    required: true,
  },
  mentor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Mentor",
    required: true,
  },
  score: { type: Number, default: 0 },
  mentorsEvaluated: { type: Map, of: Boolean, default: {} },
  feedbacks: [
    {
      mentorId: { type: mongoose.Schema.Types.ObjectId, ref: "Mentor" },
      feedback: { type: String, trim: true },
      stars: { type: Number, min: 1, max: 5 },
      date: { type: Date, default: Date.now },
    },
  ],
  lessonsVisited: [
    {
      mentorId: { type: mongoose.Schema.Types.ObjectId, ref: "Mentor" },
      lessonId: { type: mongoose.Schema.Types.ObjectId, ref: "Lesson" },
      count: { type: Number, default: 0 },
    },
  ],
  grade: {
    type: String,
    enum: ["junior", "strongJunior", "middle", "strongMiddle", "senior"],
    default: "junior",
  },
  pendingMentors: [
    {
      mentorId: { type: mongoose.Schema.Types.ObjectId, ref: "Mentor" },
      lessonId: { type: mongoose.Schema.Types.ObjectId, ref: "Lesson" },
      date: { type: Date, default: Date.now },
    },
  ],
  probationPeriod: { type: Number, default: 1 },
  lessonsPerMonth: { type: Number, default: 24 },
  pluses: [{ type: String }],
  helpedStudents: { type: Number, default: 0 },
  badges: [{ type: String }],
  createdAt: { type: Date, default: Date.now },
  dateJoined: { type: Date, required: true, default: Date.now },
  violations: [
    {
      ruleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Rule",
        required: true,
      },
      date: { type: Date, default: Date.now },
      notes: { type: String, trim: true, default: "" },
      consequenceApplied: { type: String, trim: true, default: "" },
    },
  ],
  probationStartDate: {
    type: Date,
    default: Date.now,
  },
});

// Index
internSchema.index({ username: 1 });
internSchema.index({ branch: 1 });
internSchema.index({ mentor: 1 });

// Password hash
internSchema.pre("save", async function (next) {
  // 1. Hash password
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 10);
  }

  // 2. Sync grade → probationPeriod / lessonsPerMonth / pluses
  if (this.isNew || this.isModified("grade")) {
    const gradeConfig = grades[this.grade];
    if (gradeConfig) {
      const newPeriod = gradeConfig.trialPeriod;

      // ---- NEW LOGIC -------------------------------------------------
      // If the trial period *changed* → reset the start date
      if (this.isModified("grade") && this.probationPeriod !== newPeriod) {
        this.probationStartDate = new Date();   // ← **reset**
      }
      // ----------------------------------------------------------------

      this.probationPeriod = newPeriod;
      this.lessonsPerMonth = gradeConfig.lessonsPerMonth;
      this.pluses = gradeConfig.plus;
    }
  }

  next();
});

module.exports = mongoose.model("Intern", internSchema);
