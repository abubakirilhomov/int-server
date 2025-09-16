const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const grades = require("../config/grades"); // qo‘shildi

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
    enum: ["junior", "strong-junior", "middle", "strong-middle", "senior"],
    default: "junior",
  },
  probationPeriod: { type: Number, default: 1 },
  lessonsPerMonth: { type: Number, default: 24 },
  pluses: [{ type: String }],
  helpedStudents: { type: Number, default: 0 }, 
  badges: [{ type: String }],
  createdAt: { type: Date, default: Date.now },
  dateJoined: { type: Date, required: true, default: Date.now },
  violations: [
    {
      ruleId: { type: mongoose.Schema.Types.ObjectId, ref: "Rule", required: true },
      date: { type: Date, default: Date.now },
      notes: { type: String, trim: true, default: "" },
      consequenceApplied: { type: String, trim: true, default: "" },
    },
  ],
});

// Index
internSchema.index({ username: 1 });
internSchema.index({ branch: 1 });
internSchema.index({ mentor: 1 });

// Password hash
internSchema.pre("save", async function (next) {
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 10);
  }

  // grade bo‘yicha fieldlarni avtomatik qo‘yish
  if (this.isNew || this.isModified("grade")) {
    const gradeConfig = grades[this.grade];
    if (gradeConfig) {
      this.probationPeriod = gradeConfig.probationPeriod;
      this.lessonsPerMonth = gradeConfig.lessonsPerMonth;
      this.pluses = gradeConfig.plus;
    }
  }

  next();
});

module.exports = mongoose.model("Intern", internSchema);
