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

    const validGrades = Object.keys(grades);
    if (grade && !validGrades.includes(grade)) {
      return res.status(400).json({
        error: `Недопустимый уровень: ${validGrades.join(", ")}`,
      });
    }

    const joinedDate = dateJoined ? new Date(dateJoined) : new Date();
    const gradeConfig = grades[grade || "junior"];

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
      grade: grade || "junior",
      mentorsEvaluated: {},
      dateJoined: joinedDate,
      probationPeriod: gradeConfig.probationPeriod,
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
      updateData.probationPeriod = gradeConfig.probationPeriod;
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

// Удаление стажёра
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
    const { mentorId, stars, feedback, violations = [] } = req.body;
    const intern = await Intern.findById(req.params.id);
    if (!intern) return res.status(404).json({ error: "Стажёр не найден" });

    const mentorExists = await mongoose.model("Mentor").findById(mentorId);
    if (!mentorExists)
      return res.status(400).json({ error: "Ментор не найден" });

    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return res
        .status(400)
        .json({ error: "Оценка должна быть целым числом от 1 до 5" });
    }

    // Validate violations
    if (violations.length > 0) {
      const validRuleIds = await mongoose
        .model("Rule")
        .find({
          _id: { $in: violations },
        })
        .distinct("_id");
      if (validRuleIds.length !== violations.length) {
        return res
          .status(400)
          .json({ error: "Одно или несколько нарушений недействительны" });
      }
    }

    function getWeekOfYear(date) {
      const start = new Date(date.getFullYear(), 0, 1);
      const diff =
        date -
        start +
        (start.getTimezoneOffset() - date.getTimezoneOffset()) * 60000;
      return Math.floor(diff / (7 * 24 * 60 * 60 * 1000));
    }

    const now = new Date();
    const lastFeedback = intern.feedbacks.find(
      (fb) =>
        fb.mentorId.toString() === mentorId &&
        getWeekOfYear(new Date(fb.date)) === getWeekOfYear(now) &&
        new Date(fb.date).getFullYear() === now.getFullYear()
    );

    if (lastFeedback) {
      return res
        .status(400)
        .json({ message: "Можно оценить только раз в неделю" });
    }

    // Add feedback
    intern.feedbacks.push({ mentorId, stars, feedback, date: now });

    // Add violations
    violations.forEach((ruleId) => {
      intern.violations.push({
        ruleId,
        date: now,
        notes: feedback || "", // Use feedback as notes if provided
      });
    });

    intern.mentorsEvaluated.set(mentorId, true);

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

    intern.lessonsVisited.set(
      month,
      (intern.lessonsVisited.get(month) || 0) + count
    );
    await intern.save();

    res.json(intern);
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

