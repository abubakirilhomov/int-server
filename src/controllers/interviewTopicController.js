const InterviewTopic = require("../models/interviewTopicModel");
const catchAsync = require("../utils/catchAsync");

const UPDATABLE = ["label", "labelRu", "category", "track", "weight", "order", "isActive"];

// GET /api/interview-topics?track=&category=&all=true
exports.list = catchAsync(async (req, res) => {
  const filter = {};
  if (req.query.all !== "true") filter.isActive = true;
  if (req.query.track) filter.track = req.query.track;
  if (req.query.category) filter.category = req.query.category;

  const topics = await InterviewTopic.find(filter)
    .sort({ category: 1, order: 1, createdAt: 1 })
    .lean();
  res.json(topics);
});

exports.create = catchAsync(async (req, res) => {
  const { label, labelRu, category, track, weight, order } = req.body;
  const topic = await InterviewTopic.create({ label, labelRu, category, track, weight, order });
  res.status(201).json(topic);
});

exports.update = catchAsync(async (req, res) => {
  const update = {};
  for (const f of UPDATABLE) if (req.body[f] !== undefined) update[f] = req.body[f];
  const topic = await InterviewTopic.findByIdAndUpdate(req.params.id, update, {
    new: true,
    runValidators: true,
  });
  if (!topic) return res.status(404).json({ message: "Тема не найдена" });
  res.json(topic);
});

exports.remove = catchAsync(async (req, res) => {
  const topic = await InterviewTopic.findByIdAndUpdate(
    req.params.id,
    { isActive: false },
    { new: true }
  );
  if (!topic) return res.status(404).json({ message: "Тема не найдена" });
  res.json({ message: "Тема деактивирована", topic });
});
