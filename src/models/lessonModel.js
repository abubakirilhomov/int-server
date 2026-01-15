const mongoose = require("mongoose");

const lessonSchema = new mongoose.Schema(
  {
    intern: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Intern",
      required: true,
    },
    mentor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Mentor",
      required: true,
    },
    topic: { type: String, required: true },
    time: { type: String, required: true },
    date: { type: Date, required: true, default: Date.now },
    group: { type: String, required: true },
    feedback: {
      type: String,
      enum: ["🔥", "👍", "😐", "👎"],
    },
    isRated: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["pending", "confirmed"],
      default: "pending",
    },
  },
  { timestamps: true }
);


// Индекс для оптимизации запросов по статистике
lessonSchema.index({ date: 1, intern: 1 });

module.exports = mongoose.model("Lesson", lessonSchema);