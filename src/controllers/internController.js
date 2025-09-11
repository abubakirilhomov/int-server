const Intern = require("../models/internModel");
const Branch = require("../models/branchModel");
const Mentor = require("../models/mentorModel");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Lesson = require("../models/lessonModel")

exports.loginIntern = async (req, res) => {
  try {
    const { username, password } = req.body;
    // Validate required fields
    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Имя пользователя и пароль обязательны" });
    }
    //asd
    // Find intern by username
    const intern = await Intern.findOne({ username }).select("+password");
    if (!intern) {
      return res
        .status(401)
        .json({ error: "Неверное имя пользователя или пароль" });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, intern.password);
    if (!isMatch) {
      return res
        .status(401)
        .json({ error: "Неверное имя пользователя или пароль" });
    }

    // Generate JWT
    const token = jwt.sign(
      {
        _id: intern._id,
        role: "intern", // Default role for interns
        branchId: intern.branch,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" } // Token expires in 1 day
    );

    // Return user details and token
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
      lessonsVisitedFake, // <-- приходит с фронта
    } = req.body;

    // Validate required fields
    if (!name || !lastName || !username || !password || !branch || !mentor) {
      return res
        .status(400)
        .json({ error: "Все обязательные поля должны быть заполнены" });
    }

    // Validate branch existence
    const branchExists = await Branch.findById(branch);
    if (!branchExists) {
      return res.status(400).json({ error: "Указанный филиал не найден" });
    }

    // Validate mentor existence
    const mentorExists = await Mentor.findById(mentor);
    if (!mentorExists) {
      return res.status(400).json({ error: "Указанный ментор не найден" });
    }

    // Validate grade if provided
    const validGrades = [
      "junior",
      "strong-junior",
      "middle",
      "strong-middle",
      "senior",
    ];
    if (grade && !validGrades.includes(grade)) {
      return res.status(400).json({
        error: `Недопустимое значение уровня: должен быть один из: ${validGrades.join(", ")}`,
      });
    }

    // 1. Создаём стажёра
    const joinedDate = dateJoined ? new Date(dateJoined) : new Date();
    const intern = await Intern.create({
      name,
      lastName,
      username,
      password, // Password will be hashed by the schema's pre-save hook
      branch,
      mentor,
      score: 0,
      feedbacks: [],
      lessonsVisited: [],
      grade: grade || "junior",
      mentorsEvaluated: {},
      dateJoined: joinedDate,
    });

    // 2. Если есть "старые посещения" → создаём placeholder уроки
    if (lessonsVisitedFake && lessonsVisitedFake > 0) {
      const placeholderLessons = Array.from(
        { length: lessonsVisitedFake },
        (_, i) => ({
          intern: intern._id,
          mentor,
          topic: "Placeholder",
          time: "00:00",
          // распределяем даты до dateJoined (каждый день назад)
          date: new Date(joinedDate.getTime() - (i + 1) * 24 * 60 * 60 * 1000),
          group: "Legacy",
          feedback: "👍",
        })
      );

      const createdLessons = await Lesson.insertMany(placeholderLessons);

      // 3. Привязываем уроки к intern.lessonsVisited
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
    // Если админ запрашивает, он может получить любого стажёра по ID
    if (req.user?.role === "admin" && req.params.id) {
      const intern = await Intern.findById(req.params.id)
        .populate("branch", "name")
        .populate("mentor", "name lastName");
      if (!intern) return res.status(404).json({ error: "Стажёр не найден" });
      return res.json(intern);
    }

    // Для стажёра - берем ID из токена
    const internId = req.user?._id || req.params.id;
    if (!internId) {
      return res.status(403).json({ error: "Нет доступа" });
    }

    const intern = await Intern.findById(internId)
      .populate("branch", "name")
      .populate("mentor", "name lastName");

    if (!intern) return res.status(404).json({ error: "Стажёр не найден" });

    res.json({
      _id: intern._id,
      name: intern.name,
      lastName: intern.lastName,
      username: intern.username,
      branch: intern.branch,
      mentor: intern.mentor,
      score: intern.score,
      grade: intern.grade,
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
    const intern = await Intern.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
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
    console.log(req);
    const interns = await Intern.find()
      .populate("branch", "name")
      .populate("mentor", "name lastName");

    // Определяем общий рейтинг
    const withRating = interns.map((intern) => {
      const totalLessons = intern.lessonsVisited.reduce(
        (sum, l) => sum + l.count,
        0
      );

      // допустим в месяц должно быть 12 уроков
      const maxLessons = 12 * new Date().getMonth();
      const attendance = maxLessons > 0 ? totalLessons / maxLessons : 0;

      // считаем рейтинг (70% оценка, 30% посещаемость)
      const rating = intern.score * 0.7 + attendance * 5 * 0.3;

      return {
        _id: intern._id,
        name: intern.name,
        lastName: intern.lastName,
        branch: intern.branch,
        mentor: intern.mentor,
        score: intern.score,
        attendance: (attendance * 100).toFixed(1) + "%",
        rating: rating.toFixed(2),
      };
    });

    // сортируем по рейтингу
    withRating.sort((a, b) => b.rating - a.rating);

    res.json(withRating);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
