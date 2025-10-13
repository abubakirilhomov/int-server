const Lesson = require("../models/lessonModel.js");
const Intern = require("../models/internModel");
const grades = require("../config/grades.js");
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

// Получить список интернов, которых нужно оценить
exports.getPendingLessons = async (req, res) => {
  try {
    const mentorId = req.user.mentorId;

    const lessons = await Lesson.find({ mentor: mentorId, isRated: false })
      .populate(
        "intern",
        "name lastName username branch grade score lessonsVisited feedbacks"
      )
      .sort({ createdAt: -1 });

    const interns = lessons.map((l) => ({
      ...l.intern.toObject(),
      lessonId: l._id,
      topic: l.topic, // название темы урока
      time: l.time, // время урока
      date: l.date, // дата (если нужно)
      group: l.group, // группа
    }));

    res.json(interns);
  } catch (error) {
    res.status(500).json({ message: "Ошибка при получении уроков" });
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
    const { period = "month", startDate, endDate, prevMonth } = req.query;
    const now = new Date();
    let matchStage = {};

    // 🔹 Определяем диапазон дат
    let firstDay, lastDay;

    if (period === "month") {
      if (prevMonth === "true") {
        // прошлый месяц
        firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      } else {
        // текущий месяц
        firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      }
      matchStage.date = { $gte: firstDay, $lte: lastDay };
    } else if (period === "week") {
      const dayOfWeek = now.getDay(); // 0 = вс, 1 = пн
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      firstDay = new Date(now);
      firstDay.setDate(now.getDate() - daysToMonday);
      lastDay = new Date(firstDay);
      lastDay.setDate(firstDay.getDate() + 5);

      matchStage.date = { $gte: firstDay, $lte: lastDay };
    } else if (startDate && endDate) {
      firstDay = new Date(startDate);
      lastDay = new Date(endDate);
      matchStage.date = { $gte: firstDay, $lte: lastDay };
    }

    // 🔹 Собираем статистику по посещениям
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
          branchId: "$intern.branch",
          attended: 1,
        },
      },
      { $sort: { attended: -1 } },
    ]);

    // 🔹 Подсчёт рабочих дней (без воскресений)
    const countWorkDays = (start, end) => {
      let days = 0;
      let cur = new Date(start);
      while (cur <= end) {
        if (cur.getDay() !== 0) days++;
        cur.setDate(cur.getDate() + 1);
      }
      return days;
    };

    // 🔹 Обогащаем статистику нормами
    const enhancedStats = stats.map((stat) => {
      const normalizedGrade =
        stat.grade?.toLowerCase().replace("-", "") || "junior";

      const gradeMap = {
        junior: "junior",
        strongjunior: "strongJunior",
        middle: "middle",
        strongmiddle: "strongMiddle",
        senior: "senior",
      };

      const gradeKey = gradeMap[normalizedGrade] || "junior";
      const gradeConfig = grades[gradeKey];

      if (!gradeConfig) {
        console.warn(`⚠️ Не найден конфиг для грейда: ${stat.grade}`);
        return { ...stat, norm: 0, percentage: null, meetsNorm: null };
      }

      let norm = null;

      if (period === "month") {
        norm = gradeConfig.lessonsPerMonth;
      } else if (period === "week") {
        norm = Math.round(gradeConfig.lessonsPerMonth / 4);
      } else if (startDate && endDate) {
        const workDays = countWorkDays(firstDay, lastDay);
        const lessonsPerDay = gradeConfig.lessonsPerMonth / 22;
        norm = Math.round(lessonsPerDay * workDays);
      }

      return {
        ...stat,
        grade: gradeKey,
        norm,
        meetsNorm: norm ? stat.attended >= norm : null,
        percentage: norm ? Math.round((stat.attended / norm) * 100) : null,
      };
    });

    res.json({ stats: enhancedStats, grades });
  } catch (err) {
    console.error("Ошибка в getAttendanceStats:", err);
    res.status(500).json({ message: err.message });
  }
};
