const Question = require("../models/Question");

// 🔹 Добавить вопрос
const addQuestion = async (req, res) => {
  try {
    const { text, direction, topic, difficulty } = req.body;

    // Алгоритм очков
    let points = 1;
    if (difficulty === "medium") points = 2;
    if (difficulty === "hard") points = 3;

    const question = new Question({ text, direction, topic, difficulty, points });
    await question.save();

    res.status(201).json({ message: "Question added", question });
  } catch (error) {
    res.status(500).json({ message: "Error adding question", error: error.message });
  }
};

// 🔹 Получить все вопросы
const getQuestions = async (req, res) => {
  try {
    const { direction, difficulty } = req.query;

    let filter = {};
    if (direction) filter.direction = direction;
    if (difficulty) filter.difficulty = difficulty;

    const questions = await Question.find(filter);
    res.json(questions);
  } catch (error) {
    res.status(500).json({ message: "Error fetching questions", error: error.message });
  }
};

// 🔹 Изменить вопрос
const updateQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await Question.findByIdAndUpdate(id, req.body, { new: true });
    if (!updated) return res.status(404).json({ message: "Question not found" });

    res.json({ message: "Question updated", updated });
  } catch (error) {
    res.status(500).json({ message: "Error updating question", error: error.message });
  }
};

// 🔹 Удалить вопрос
const deleteQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Question.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: "Question not found" });

    res.json({ message: "Question deleted" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting question", error: error.message });
  }
};

module.exports = {
  addQuestion,
  getQuestions,
  updateQuestion,
  deleteQuestion,
};
