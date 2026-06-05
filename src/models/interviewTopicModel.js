const mongoose = require("mongoose");

// Банк тем собеседования. Зеркало LessonCriteria по структуре/CRUD.
const CATEGORIES = ["html-css", "javascript", "react", "practical"];
const TRACKS = ["frontend-react", "backend-nodejs"];

const interviewTopicSchema = new mongoose.Schema(
  {
    label: { type: String, required: true }, // основной текст (UZ)
    labelRu: { type: String, default: "" }, // RU перевод (опц.)
    category: { type: String, enum: CATEGORIES, default: "javascript", index: true },
    track: { type: String, enum: TRACKS, default: "frontend-react", index: true },
    weight: { type: Number, default: 1 }, // макс. балл за тему
    order: { type: Number, default: 0 }, // порядок внутри категории
    isActive: { type: Boolean, default: true }, // soft-delete
  },
  { timestamps: true }
);

interviewTopicSchema.statics.CATEGORIES = CATEGORIES;
interviewTopicSchema.statics.TRACKS = TRACKS;

module.exports = mongoose.model("InterviewTopic", interviewTopicSchema);
