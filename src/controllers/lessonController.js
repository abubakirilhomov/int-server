const Lesson = require("../models/lessonModel.js");
const Intern = require("../models/internModel");

// Создать урок
exports.createLesson = async (req, res) => {
  try {
    const lesson = await Lesson.create(req.body);

    // After creating a lesson → update intern's lessonsVisited
    if (lesson.intern) {
      const intern = await Intern.findById(lesson.intern);

      if (intern) {
        const existing = intern.lessonsVisited.find(
          (lv) =>
            lv.lessonId.toString() === lesson._id.toString() &&
            lv.mentorId.toString() === lesson.mentor.toString()
        );

        if (existing) {
          existing.count += 1;
        } else {
          intern.lessonsVisited.push({
            mentorId: lesson.mentor,
            lessonId: lesson._id,
            count: 1,
          });
        }

        await intern.save();
      }
    }

    res.status(201).json(lesson);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// Получить все уроки
exports.getLessons = async (req, res) => {
  try {
    const lessons = await Lesson.find()
      .populate("intern", "name lastName")
      .populate("mentor", "name lastName");
    res.json(lessons);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Получить урок по ID
exports.getLessonById = async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id)
      .populate("intern", "name lastName")
      .populate("mentor", "name lastName");

    if (!lesson) return res.status(404).json({ message: "Lesson not found" });

    res.json(lesson);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Обновить урок
exports.updateLesson = async (req, res) => {
  try {
    const lesson = await Lesson.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!lesson) return res.status(404).json({ message: "Lesson not found" });
    res.json(lesson);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// Удалить урок
exports.deleteLesson = async (req, res) => {
  try {
    const lesson = await Lesson.findByIdAndDelete(req.params.id);
    if (!lesson) return res.status(404).json({ message: "Lesson not found" });
    res.json({ message: "Lesson deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Получить статистику посещаемости
exports.getAttendanceStats = async (req, res) => {
  try {
    const { period = "month", startDate, endDate } = req.query; // period: 'day', 'week', 'month'

    let matchStage = {};
    if (period === "month") {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      matchStage.date = { $gte: firstDay, $lte: lastDay };
    } else if (period === "week") {
      const now = new Date();
      const firstDay = new Date(now.setDate(now.getDate() - now.getDay() + 1)); // Понедельник
      const lastDay = new Date(now.setDate(now.getDate() + 5)); // Суббота
      matchStage.date = { $gte: firstDay, $lte: lastDay };
    } else if (startDate && endDate) {
      matchStage.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    // Исключить воскресенья
    matchStage.$expr = {
      $ne: [{ $dayOfWeek: "$date" }, 1], // 1 = Sunday
    };

    const stats = await Lesson.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$intern",
          attended: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "interns",
          localField: "_id",
          foreignField: "_id",
          as: "intern",
        },
      },
      { $unwind: "$intern" },
      {
        $project: {
          name: { $concat: ["$intern.name", " ", "$intern.lastName"] },
          attended: 1,
          internId: "$intern._id",
        },
      },
      { $sort: { attended: -1 } },
    ]);

    const norm = period === "month" ? calculateMonthlyNorm(new Date()) : period === "week" ? 12 : null;
    const enhancedStats = stats.map((stat) => ({
      ...stat,
      meetsNorm: norm ? stat.attended >= norm : null,
      percentage: norm ? Math.round((stat.attended / norm) * 100) : null,
    }));

    res.json(enhancedStats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

function calculateMonthlyNorm(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let sundays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    if (d.getDay() === 0) sundays++; // 0 = Sunday
  }
  return (daysInMonth - sundays) * 2;
}