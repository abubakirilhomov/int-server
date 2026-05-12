const Rule = require("../models/rulesModel");
const grades = require("../config/grades");
const catchAsync = require("../utils/catchAsync");

const createRule = catchAsync(async (req, res) => {
  const { category, title, example, consequence } = req.body;

  if (!category || !title) {
    return res.status(400).json({
      success: false,
      message: "Category and title are required",
    });
  }

  const rule = new Rule({ category, title, example, consequence });
  await rule.save();

  res.status(201).json({
    success: true,
    data: rule,
    message: "Rule created successfully",
  });
});

const getRules = catchAsync(async (req, res) => {
  const { category, page = 1, limit = 10 } = req.query;
  const filter = {};
  if (category) filter.category = category;

  const rules = await Rule.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));
  const total = await Rule.countDocuments(filter);
  res.json({
    success: true,
    data: rules,
    pagination: { page, limit, total },
    grades,
  });
});

const deleteRule = catchAsync(async (req, res) => {
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
});

module.exports = { createRule, getRules, deleteRule };
