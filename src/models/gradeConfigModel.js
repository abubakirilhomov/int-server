const mongoose = require("mongoose");
const gradeConfigSchema = new mongoose.Schema({
  grade: {
    type: String,
    enum: ["junior", "strongJunior", "middle", "strongMiddle", "senior"],
    required: true,
    unique: true,
  },
  lessonsPerMonth: { type: Number, required: true },
  trialPeriod: { type: Number, required: true }, // in months
  perks: [{ type: String }],
}, { timestamps: true });
module.exports = mongoose.model("GradeConfig", gradeConfigSchema);
