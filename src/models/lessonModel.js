const mongoose = require("mongoose")

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
    topic: {
      type: String,
      required: true,
    },
    time: {
      type: String, 
      required: true,
    },
    group: {
      type: String,
      required: true,
    },
    feedback: {
      type: String,
      enum: ["🔥", "👍", "😐", "👎"],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Lesson", lessonSchema);
