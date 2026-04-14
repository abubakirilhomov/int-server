const LessonCriteria = require("../models/lessonCriteriaModel");

// GET /api/lesson-criteria — public (interns and others)
// ?all=true — returns all including inactive (for admin panel)
exports.getCriteria = async (req, res) => {
  try {
    const filter = req.query.all === "true" ? {} : { isActive: true };
    const criteria = await LessonCriteria.find(filter).lean();
    res.json(criteria);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/lesson-criteria — admin only
exports.createCriteria = async (req, res) => {
  try {
    const { label, labelRu, type, weight, category } = req.body;
    const criteria = await LessonCriteria.create({ label, labelRu, type, weight, category });
    res.status(201).json(criteria);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// PATCH /api/lesson-criteria/:id — admin only
exports.updateCriteria = async (req, res) => {
  try {
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
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// DELETE /api/lesson-criteria/:id — admin only (soft delete)
exports.deleteCriteria = async (req, res) => {
  try {
    const criteria = await LessonCriteria.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!criteria) {
      return res.status(404).json({ message: "Criteria not found" });
    }
    res.json({ message: "Criteria deactivated", criteria });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
