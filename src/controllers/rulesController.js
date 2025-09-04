const Rule = require("../models/rulesModel");

const createRule = async (req, res) => {
  try {
    const { category, title, example, consequence } = req.body;

    if (!category || !title) {
      return res.status(400).json({
        success: false,
        message: "Категория и название обязательны",
      });
    }

    const rule = new Rule({ category, title, example, consequence });
    await rule.save();

    res.status(201).json({
      success: true,
      data: rule,
      message: "Правило добавлено",
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Правило с таким названием уже существует",
      });
    }
    res.status(500).json({
      success: false,
      error: err.message,
      message: "Ошибка при добавлении правила",
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