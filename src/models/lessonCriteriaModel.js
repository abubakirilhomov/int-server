const mongoose = require("mongoose");

const lessonCriteriaSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    labelRu: { type: String },
    type: {
      type: String,
      enum: ["positive", "negative"],
      required: true,
    },
    weight: { type: Number, default: 1 },
    category: {
      type: String,
      enum: ["communication", "tempo", "discipline", "content", "other"],
      default: "other",
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LessonCriteria", lessonCriteriaSchema);
