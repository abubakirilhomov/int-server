const mongoose = require('mongoose');;

const QuestionSchema = new mongoose.Schema(
    {
        text: { type: String, required: true }, // сам вопрос
        direction: { type: String, enum: ["frontend", "backend", "fullstack"], required: true },
        topic: { type: String, enum: ["html", "css", "javascript", "react", "node", "express", "mongodb"], required: true },
        difficulty: { type: String, enum: ["easy", "medium", "hard"], required: true },
        points: { type: Number, default: 1 }, // кол-во очков (easy=1, medium=2, hard=3)
    },
    { timestamps: true }
);

module.exports = mongoose.model('Question', QuestionSchema);
