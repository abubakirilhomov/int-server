const Intern = require('../models/internModel');
const Branch = require("../models/branchModel");

// Создание стажёра
exports.createIntern = async (req, res) => {
  try {
    const { name, lastName, branch } = req.body;

    // Проверка, существует ли филиал
    const branchExists = await Branch.findById(branch);
    if (!branchExists) {
      return res.status(400).json({ error: 'Указанный филиал не найден' });
    }

    const intern = await Intern.create({
      name,
      lastName,
      branch,
      score: 0,
      feedbacks: [],
      lessonsVisited: {}
    });

    res.status(201).json(intern);
  } catch (error) {
    console.error("Ошибка при создании стажёра:", error);
    res.status(500).json({ error: error.message });
  }
};

// Получение стажёров по филиалу (из JWT)
exports.getInterns = async (req, res) => {
  try {
    if (req.user?.role === "admin") {
      const interns = await Intern.find().populate("branch", "name");
      return res.json(interns);
    }

    const branchId = req.user?.branchId;
    if (!branchId) {
      return res.status(403).json({ message: "Нет доступа" });
    }

    const interns = await Intern.find({ branch: branchId }).populate("branch", "name");
    res.json(interns);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Обновление стажёра
exports.updateIntern = async (req, res) => {
  try {
    const intern = await Intern.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(intern);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Удаление стажёра
exports.deleteIntern = async (req, res) => {
  try {
    await Intern.findByIdAndDelete(req.params.id);
    res.sendStatus(204);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Добавление фидбэка
// Добавление фидбэка
exports.rateIntern = async (req, res) => {
  try {
    const { mentorId, stars, feedback } = req.body;
    const intern = await Intern.findById(req.params.id);
    if (!intern) return res.status(404).json({ error: "Стажёр не найден" });

    // Проверяем ограничение: 1 отзыв от одного ментора в месяц
    const now = new Date();
    const lastFeedback = intern.feedbacks.find(fb =>
      fb.mentorId.toString() === mentorId &&
      new Date(fb.date).getMonth() === now.getMonth() &&
      new Date(fb.date).getFullYear() === now.getFullYear()
    );

    if (lastFeedback) {
      return res.status(400).json({ message: "Можно оценить только раз в месяц" });
    }

    // Добавляем новый отзыв
    intern.feedbacks.push({ mentorId, stars, feedback, date: now });

    // ✅ Пересчитываем средний балл
    const totalStars = intern.feedbacks.reduce((sum, fb) => sum + fb.stars, 0);
    intern.score = totalStars / intern.feedbacks.length;

    await intern.save();

    res.json(intern);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


// Добавление посещённых уроков
exports.addLessonVisit = async (req, res) => {
  try {
    const { month, count } = req.body;
    const intern = await Intern.findById(req.params.id);
    if (!intern) return res.status(404).json({ error: "Стажёр не найден" });

    intern.lessonsVisited.set(month, (intern.lessonsVisited.get(month) || 0) + count);
    await intern.save();

    res.json(intern);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
