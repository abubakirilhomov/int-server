const mongoose = require("mongoose");

const ruleSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: ["green", "yellow", "red", "black"],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      unique: true, // Prevent duplicate rule titles
    },
    example: {
      type: String,
      default: "",
      trim: true, // Remove unnecessary whitespace
    },
    consequence: {
      type: String,
      default: "",
      trim: true, // Remove unnecessary whitespace
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Rule", ruleSchema);