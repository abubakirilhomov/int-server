const Lesson = require("../models/lessonModel.js");
const Intern = require("../models/internModel");
const grades = require("../config/grades.js")
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

exports.getAttendanceStats = async (req, res) => {
  try {
    const { period = "month", startDate, endDate } = req.query;

    let matchStage = {};

    const now = new Date();

    if (period === "month") {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      matchStage.date = { $gte: firstDay, $lte: lastDay };
    } else if (period === "week") {
      const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const firstDay = new Date(now);
      firstDay.setDate(now.getDate() - daysToMonday);
      const lastDay = new Date(now);
      lastDay.setDate(now.getDate() + (5 - daysToMonday)); // до субботы
      matchStage.date = { $gte: firstDay, $lte: lastDay };
    } else if (startDate && endDate) {
      matchStage.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const stats = await Lesson.aggregate([
      { $match: matchStage },
      {
        $lookup: {
          from: "interns",
          localField: "intern",
          foreignField: "_id",
          as: "intern",
        },
      },
      { $unwind: "$intern" },
      // фильтруем по дате начала работы
      {
        $match: {
          $expr: { $gte: ["$date", "$intern.startDate"] },
        },
      },
      {
        $group: {
          _id: "$intern._id",
          attended: { $sum: 1 },
          intern: { $first: "$intern" },
        },
      },
      {
        $project: {
          internId: "$intern._id",
          name: { $concat: ["$intern.name", " ", "$intern.lastName"] },
          grade: "$intern.grade",
          attended: 1,
        },
      },
      { $sort: { attended: -1 } },
    ]);

    // утилита: рабочие дни между двумя датами (без воскресений)
    const countWorkDays = (start, end) => {
      let days = 0;
      let cur = new Date(start);
      while (cur <= end) {
        if (cur.getDay() !== 0) days++;
        cur.setDate(cur.getDate() + 1);
      }
      return days;
    };

    const enhancedStats = stats.map((stat) => {
      const gradeMap = {
        junior: "junior",
        "strong-junior": "strongJunior",
        middle: "middle",
        "strong-middle": "strongMiddle",
        senior: "senior",
      };
      const gradeKey = gradeMap[stat.grade] || "junior";
      const gradeConfig = grades[gradeKey];

      let norm = null;

      if (period === "month") {
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const workDays = countWorkDays(firstDay, lastDay);
        const lessonsPerDay = gradeConfig.lessonsPerMonth / workDays;
        norm = Math.round(lessonsPerDay * workDays);
      } else if (period === "week") {
        const monday = new Date(now);
        const dayOfWeek = now.getDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        monday.setDate(now.getDate() - daysToMonday);
        const saturday = new Date(monday);
        saturday.setDate(monday.getDate() + 5);
        const workDays = countWorkDays(monday, saturday);
        const lessonsPerDay = gradeConfig.lessonsPerMonth / 22; // условные 22 рабочих дня
        norm = Math.round(lessonsPerDay * workDays);
      } else if (startDate && endDate) {
        const workDays = countWorkDays(new Date(startDate), new Date(endDate));
        const lessonsPerDay = gradeConfig.lessonsPerMonth / 22;
        norm = Math.round(lessonsPerDay * workDays);
      }

      return {
        ...stat,
        norm,
        meetsNorm: norm ? stat.attended >= norm : null,
        percentage: norm ? Math.round((stat.attended / norm) * 100) : null,
      };
    });

    res.json({ stats: enhancedStats, grades });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};