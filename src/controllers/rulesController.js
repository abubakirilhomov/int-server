const Rule = require("../models/rulesModel");
const grades = require("../config/grades")

const createRule = async (req, res) => {
  try {
    const { category, title, example, consequence } = req.body;

    if (!category || !title) {
      return res.status(400).json({
        success: false,
        message: 'Category and title are required',
      });
    }

    const rule = new Rule({ category: category, title: title, example: example, consequence: consequence });
    await rule.save();

    res.status(201).json({
      success: true,
      data: rule,
      message: 'Rule created successfully',
    });
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: messages,
      });
    }
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'A rule with this title already exists',
      });
    }
    res.status(500).json({
      success: false,
      error: err.message,
      message: 'Error creating rule',
    });
  }
};

const getRules = async (req, res) => {
  try {
    const { category, page = 1, limit = 10 } = req.query;
    let filter = {};
    if (category) {
      filter.category = category;
    }

    const rules = await Rule.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    const total = await Rule.countDocuments(filter);
    res.json({
      success: true,
      data: rules,
      pagination: { page, limit, total },
      grades: grades,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      message: "Ошибка при получении правил",
    });
  }
};

const deleteRule = async (req, res) => {
  try {
    const { id } = req.params;
    const rule = await Rule.findByIdAndDelete(id);
    if (!rule) {
      return res.status(404).json({
        success: false,
        message: "Правило не найдено",
      });
    }
    res.json({
      success: true,
      message: "Правило удалено",
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      message: "Ошибка при удалении правила",
    });
  }
};

module.exports = { createRule, getRules, deleteRule };