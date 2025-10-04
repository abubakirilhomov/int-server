const Intern = require("../models/internModel");
const Branch = require("../models/branchModel");
const Mentor = require("../models/mentorModel");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Lesson = require("../models/lessonModel");
const grades = require("../config/grades");

exports.loginIntern = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Имя пользователя и пароль обязательны" });
    }
    const intern = await Intern.findOne({ username }).select("+password");
    if (!intern) {
      return res
        .status(401)
        .json({ error: "Неверное имя пользователя или пароль" });
    }

    const isMatch = await bcrypt.compare(password, intern.password);
    if (!isMatch) {
      return res
        .status(401)
        .json({ error: "Неверное имя пользователя или пароль" });
    }

    const token = jwt.sign(
      {
        _id: intern._id,
        role: "intern", // Default role for interns
        branchId: intern.branch,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.status(200).json({
      token,
      user: {
        _id: intern._id,
        name: intern.name,
        lastName: intern.lastName,
        username: intern.username,
        role: "intern",
        branchId: intern.branch,
      },
    });
  } catch (error) {
    console.error("Ошибка при входе:", error);
    res.status(500).json({ error: error.message });
  }
};

// Создание стажёра
exports.createIntern = async (req, res) => {
  try {
    const {
      name,
      lastName,
      username,
      password,
      branch,
      mentor,
      grade,
      dateJoined,
      lessonsVisitedFake,
    } = req.body;

    if (!name || !lastName || !username || !password || !branch || !mentor) {
      return res
        .status(400)
        .json({ error: "Все обязательные поля должны быть заполнены" });
    }

    const branchExists = await Branch.findById(branch);
    if (!branchExists) {
      return res.status(400).json({ error: "Указанный филиал не найден" });
    }

    const mentorExists = await Mentor.findById(mentor);
    if (!mentorExists) {
      return res.status(400).json({ error: "Указанный ментор не найден" });
    }

    // нормализация
    const validGrades = Object.keys(grades);
    let normalizedGrade = (grade || "junior").toString().trim();

    if (!validGrades.includes(normalizedGrade)) {
      return res.status(400).json({
        error: `Недопустимый уровень. Возможные: ${validGrades.join(", ")}`,
      });
    }

    const joinedDate = dateJoined ? new Date(dateJoined) : new Date();
    const gradeConfig = grades[normalizedGrade];

    const intern = await Intern.create({
      name,
      lastName,
      username,
      password,
      branch,
      mentor,
      score: 0,
      feedbacks: [],
      lessonsVisited: [],
      grade: normalizedGrade, // ← гарантированно правильный grade
      mentorsEvaluated: {},
      dateJoined: joinedDate,
      probationPeriod: gradeConfig.trialPeriod,
      lessonsPerMonth: gradeConfig.lessonsPerMonth,
      pluses: gradeConfig.plus,
    });

    if (lessonsVisitedFake && lessonsVisitedFake > 0) {
      const placeholderLessons = Array.from(
        { length: lessonsVisitedFake },
        (_, i) => ({
          intern: intern._id,
          mentor,
          topic: "Placeholder",
          time: "00:00",
          date: new Date(joinedDate.getTime() - (i + 1) * 86400000),
          group: "Legacy",
          feedback: "👍",
        })
      );

      const createdLessons = await Lesson.insertMany(placeholderLessons);

      createdLessons.forEach((lesson) => {
        intern.lessonsVisited.push({
          mentorId: mentor,
          lessonId: lesson._id,
          count: 1,
        });
      });

      await intern.save();
    }

    res.status(201).json(intern);
  } catch (error) {
    console.error("Ошибка при создании стажёра:", error);
    if (error.code === 11000) {
      return res.status(400).json({ error: "Имя пользователя уже существует" });
    }
    res.status(500).json({ error: error.message });
  }
};

exports.getPendingInterns = async (req, res) => {
  try {
    if (req.user?.role !== "mentor") {
      return res.status(403).json({ error: "Доступ только для менторов" });
    }

    const mentorId = req.user._id;

    // Находим всех стажёров, у которых есть задачи для этого ментора
    const interns = await Intern.find({
      "pendingMentors.mentorId": mentorId
    })
      .populate("branch", "name")
      .populate("mentor", "name lastName")
      .populate("pendingMentors.lessonId", "topic date time group");

    res.json(interns);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Получение профиля стажёра
exports.getInternProfile = async (req, res) => {
  try {
    if (req.user?.role === "admin" && req.params.id) {
      const intern = await Intern.findById(req.params.id)
        .populate("branch", "name")
        .populate("mentor", "name lastName");
      if (!intern) return res.status(404).json({ error: "Стажёр не найден" });
      return res.json(intern);
    }

    const internId = req.user?._id || req.params.id;
    if (!internId) {
      return res.status(403).json({ error: "Нет доступа" });
    }

    const intern = await Intern.findById(internId)
      .populate("branch", "name")
      .populate("mentor", "name lastName");

    if (!intern) return res.status(404).json({ error: "Стажёр не найден" });

    const gradeConfig = grades[intern.grade] || null;
    const goal = gradeConfig ? gradeConfig.lessonsPerMonth : null;

    // 🔹 конвертация UTC → Asia/Tashkent
    const createdAtLocal = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Asia/Tashkent",
      dateStyle: "short",
      timeStyle: "medium",
    }).format(intern.createdAt);

    res.json({
      _id: intern._id,
      name: intern.name,
      lastName: intern.lastName,
      username: intern.username,
      branch: intern.branch,
      mentor: intern.mentor,
      score: intern.score,
      grade: intern.grade,
      goal: goal,
      lessonsVisited: intern.lessonsVisited,
      feedbacks: intern.feedbacks.length,
      probationPeriod: intern.probationPeriod,
      pluses: intern.pluses,
      helpedStudents: intern.helpedStudents,
      createdAt: intern.createdAt,       // ✅ оригинал в UTC
      createdAtLocal: createdAtLocal,   // ✅ для фронта в ташкентском времени
      grades: grades
    });
  } catch (error) {
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

    const interns = await Intern.find({ branch: branchId }).populate(
      "branch",
      "name"
    );
    res.json(interns);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Обновление стажёра
exports.updateIntern = async (req, res) => {
  try {
    let updateData = { ...req.body };

    if (updateData.grade) {
      const gradeConfig = grades[updateData.grade];
      if (!gradeConfig) {
        return res.status(400).json({
          error: `Недопустимый уровень: ${Object.keys(grades).join(", ")}`,
        });
      }
      updateData.probationPeriod = gradeConfig.trialPeriod;
      updateData.lessonsPerMonth = gradeConfig.lessonsPerMonth;
      updateData.pluses = gradeConfig.plus;
    }

    const intern = await Intern.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
    });

    if (!intern) return res.status(404).json({ error: "Стажёр не найден" });

    res.json(intern);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteIntern = async (req, res) => {
  try {
    await Intern.findByIdAndDelete(req.params.id);
    res.status(204).json({ message: "Intern deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


exports.rateIntern = async (req, res) => {
  try {
    const { lessonId, stars, feedback } = req.body;
    const mentorId = req.user.mentorId;

    const lesson = await Lesson.findById(lessonId).populate("intern");
    if (!lesson) return res.status(404).json({ message: "Урок не найден" });
    if (lesson.isRated) return res.status(400).json({ message: "Урок уже оценен" });
    if (lesson.mentor.toString() !== mentorId) {
      return res.status(403).json({ message: "Вы не можете оценить чужой урок" });
    }

    const intern = await Intern.findById(lesson.intern._id);

    // Добавляем новый отзыв
    intern.feedbacks.push({
      mentorId,
      stars,
      feedback,
    });

    // Пересчитываем общий балл (среднее арифметическое)
    const totalStars = intern.feedbacks.reduce((sum, fb) => sum + fb.stars, 0);
    intern.score = totalStars / intern.feedbacks.length;

    await intern.save();

    // Отмечаем урок как оценённый
    lesson.isRated = true;
    await lesson.save();

    res.json({
      message: "Стажёр успешно оценён",
      score: intern.score.toFixed(1),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Ошибка при оценке стажёра" });
  }
};

// Добавление посещённых уроков
exports.addLessonVisit = async (req, res) => {
  try {
    const { mentorId, topic, time, date, group } = req.body;

    const intern = await Intern.findById(req.params.id);
    if (!intern) return res.status(404).json({ error: "Стажёр не найден" });

    // Создаём Lesson
    const lesson = await Lesson.create({
      intern: intern._id,
      mentor: mentorId,
      topic: topic || "Без темы",
      time: time || "00:00",
      date: date ? new Date(date) : new Date(),
      group: group || "General",
    });

    // Добавляем в lessonsVisited
    intern.lessonsVisited.push({
      mentorId,
      lessonId: lesson._id,
      count: 1,
    });

    // Добавляем задачу для ментора "оценить этого стажёра"
    intern.pendingMentors.push({
      mentorId,
      lessonId: lesson._id,
    });

    await intern.save();

    res.json({ message: "Урок добавлен и отправлен на оценку ментору", intern });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getInternsRating = async (req, res) => {
  try {
    const interns = await Intern.find()
      .populate("branch", "name")
      .populate("mentor", "name lastName");

    const now = new Date();
    const currentMonth = now.getMonth() + 1; // Yanvar = 1

    // grade mapping
    const gradeMap = {
      junior: "junior",
      "strong-junior": "strongJunior",
      middle: "middle",
      "strong-middle": "strongMiddle",
      senior: "senior",
    };

    const withRating = interns.map((intern) => {
      const totalLessons = intern.lessonsVisited.reduce(
        (sum, l) => sum + l.count,
        0
      );

      const gradeKey = gradeMap[intern.grade] || intern.grade;
      const gradeConfig = grades[gradeKey];

      if (!gradeConfig) {
        return {
          _id: intern._id,
          name: intern.name,
          lastName: intern.lastName,
          branch: intern.branch,
          mentor: intern.mentor,
          grade: intern.grade,
          score: intern.score,
          attendance: "N/A",
          rating: "N/A",
          lessonsPerMonth: null,
          totalLessonsRequired: null,
          totalLessonsVisited: totalLessons,
        };
      }

      // Hozirgi oyning normasi
      const maxLessons = gradeConfig.lessonsPerMonth * currentMonth;

      const attendance = maxLessons > 0 ? totalLessons / maxLessons : 0;

      // umumiy reyting formulasi
      const rating = intern.score * 0.7 + attendance * 5 * 0.3;

      return {
        _id: intern._id,
        name: intern.name,
        lastName: intern.lastName,
        branch: intern.branch,
        mentor: intern.mentor,
        grade: intern.grade,
        score: intern.score,
        attendance: (attendance * 100).toFixed(1) + "%",
        rating: rating.toFixed(2),
        lessonsPerMonth: gradeConfig.lessonsPerMonth, // 1 oy uchun norma
        totalLessonsRequired: maxLessons, // hozirgi oyning oxirigacha bo‘lishi kerak bo‘lgan jami darslar
        totalLessonsVisited: totalLessons,
      };
    });

    withRating.sort((a, b) => b.rating - a.rating);

    res.json(withRating);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.upgradeInternGrade = async (req, res) => {
  try {
    const { newGrade } = req.body;

    if (!newGrade) {
      return res.status(400).json({ error: "Новый уровень обязателен" });
    }

    const intern = await Intern.findById(req.params.id);
    if (!intern) {
      return res.status(404).json({ error: "Стажёр не найден" });
    }

    const validGrades = Object.keys(grades);
    const normalizedGrade = newGrade.toString().trim();

    if (!validGrades.includes(normalizedGrade)) {
      return res.status(400).json({
        error: `Недопустимый уровень. Возможные: ${validGrades.join(", ")}`,
      });
    }

    const gradeConfig = grades[normalizedGrade];

    // 🔹 Обновляем грейд и параметры
    intern.grade = normalizedGrade;
    intern.probationPeriod = gradeConfig.trialPeriod;
    intern.lessonsPerMonth = gradeConfig.lessonsPerMonth;
    intern.pluses = gradeConfig.plus;

    // 🔹 Можно также сбросить испытательный срок с текущей даты
    intern.dateJoined = new Date();

    await intern.save();

    res.json({
      message: `Грейд стажёра повышен до "${normalizedGrade}"`,
      intern,
    });
  } catch (error) {
    console.error("Ошибка при повышении грейда:", error);
    res.status(500).json({ error: error.message });
  }
};
