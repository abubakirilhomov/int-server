const mongoose = require("mongoose");

const InterviewSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    age: { type: Number, required: true },
    branch: { type: String, required: true },
    monthsStudied: { type: Number, required: true },
    direction: { type: String, enum: ["Frontend", "Backend", "Fullstack"], required: true },
    skills: { type: [String], required: true },
    mentor: { type: String, required: true },
    difficulty: { type: String, enum: ["easy", "medium", "hard"], required: true },
    interviewDate: { type: Date, required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Interview", InterviewSchema);
