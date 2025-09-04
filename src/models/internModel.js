const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const Rules = require("../models/rulesModel.js");

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
  score: {
    type: Number,
    default: 0,
  },
  mentorsEvaluated: {
    type: Map,
    of: Boolean,
    default: {},
  },
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
    enum: ["junior", "middle", "senior"],
    default: "junior",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  violations: [
    {
      ruleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Rule",
        required: [true, "Rule ID is required"],
      },
      date: {
        type: Date,
        default: Date.now,
      },
      notes: {
        type: String,
        trim: true,
        default: "",
      },
      consequenceApplied: {
        type: String,
        trim: true,
        default: "",
      },
    },
  ],
});

// Index frequently queried fields
internSchema.index({ username: 1 });
internSchema.index({ branch: 1 });
internSchema.index({ mentor: 1 });

// Hash password before saving
internSchema.pre("save", async function (next) {
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

module.exports = mongoose.model("Intern", internSchema);
