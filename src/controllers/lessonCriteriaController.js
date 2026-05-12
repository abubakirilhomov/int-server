const LessonCriteria = require("../models/lessonCriteriaModel");
const catchAsync = require("../utils/catchAsync");

// GET /api/lesson-criteria — public (interns and others)
// ?all=true — returns all including inactive (for admin panel)
exports.getCriteria = catchAsync(async (req, res) => {
  const filter = req.query.all === "true" ? {} : { isActive: true };
  const criteria = await LessonCriteria.find(filter).lean();
  res.json(criteria);
});

// POST /api/lesson-criteria — admin only
exports.createCriteria = catchAsync(async (req, res) => {
  const { label, labelRu, type, weight, category } = req.body;
  const criteria = await LessonCriteria.create({ label, labelRu, type, weight, category });
  res.status(201).json(criteria);
});

// PATCH /api/lesson-criteria/:id — admin only
exports.updateCriteria = catchAsync(async (req, res) => {
  const { label, labelRu, type, weight, category, isActive } = req.body;
  const criteria = await LessonCriteria.findByIdAndUpdate(
    req.params.id,
    { label, labelRu, type, weight, category, isActive },
    { new: true, runValidators: true }
  );
  if (!criteria) {
    return res.status(404).json({ message: "Criteria not found" });
  }
  res.json(criteria);
});

// DELETE /api/lesson-criteria/:id — admin only (soft delete)
exports.deleteCriteria = catchAsync(async (req, res) => {
  const criteria = await LessonCriteria.findByIdAndUpdate(
    req.params.id,
    { isActive: false },
    { new: true }
  );
  if (!criteria) {
    return res.status(404).json({ message: "Criteria not found" });
  }
  res.json({ message: "Criteria deactivated", criteria });
});
