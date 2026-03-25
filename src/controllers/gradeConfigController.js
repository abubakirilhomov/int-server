const GradeConfig = require("../models/gradeConfigModel");
const Intern = require("../models/internModel");
const fallbackGrades = require("../config/grades");

// GET /api/grade-config - get all grade configs
exports.getAll = async (req, res) => {
  try {
    let configs = await GradeConfig.find().lean();

    // If DB is empty, seed from fallback and return
    if (configs.length === 0) {
      const seeds = Object.entries(fallbackGrades).map(([grade, cfg]) => ({
        grade,
        lessonsPerMonth: cfg.lessonsPerMonth,
        trialPeriod: cfg.trialPeriod,
        perks: cfg.plus || [],
      }));
      await GradeConfig.insertMany(seeds);
      configs = await GradeConfig.find().lean();
    }

    res.json({ data: configs });
  } catch (err) {
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// PUT /api/grade-config/:grade - update a grade config
exports.update = async (req, res) => {
  try {
    const { grade } = req.params;
    const { lessonsPerMonth, trialPeriod, perks } = req.body;

    if (!lessonsPerMonth || !trialPeriod) {
      return res.status(400).json({ message: "lessonsPerMonth и trialPeriod обязательны" });
    }

    const config = await GradeConfig.findOneAndUpdate(
      { grade },
      { lessonsPerMonth: Number(lessonsPerMonth), trialPeriod: Number(trialPeriod), perks: perks || [] },
      { upsert: true, new: true }
    );

    // Sync all interns of this grade
    await Intern.updateMany(
      { grade },
      { $set: { lessonsPerMonth: Number(lessonsPerMonth), probationPeriod: Number(trialPeriod) } }
    );

    res.json({ data: config });
  } catch (err) {
    res.status(500).json({ message: "Ошибка сервера" });
  }
};
