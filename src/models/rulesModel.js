const mongoose = require("mongoose");

const ruleSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: {
        values: ["green", "yellow", "red", "black"],
        message: "Категория должна быть одной из: green, yellow, red, black",
      },
      required: [true, "Категория обязательна"],
    },
    title: {
      type: String,
      required: [true, "Название обязательно"],
      trim: true,
      unique: true,
      minlength: [3, "Название должно содержать минимум 3 символа"],
      maxlength: [100, "Название не может превышать 100 символов"],
    },
    example: {
      type: String,
      default: "",
      trim: true,
    },
    consequence: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

ruleSchema.index({ category: 1 });
module.exports = mongoose.model("Rule", ruleSchema);