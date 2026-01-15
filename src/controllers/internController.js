const Intern = require("../models/internModel");
const Branch = require("../models/branchModel");
const Mentor = require("../models/mentorModel");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Lesson = require("../models/lessonModel");
const grades = require("../config/grades");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const internService = require("../services/internService");

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
        id: intern._id,
        role: "intern", // Default role for interns
        branchId: intern.branch,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );
    const refreshToken = jwt.sign(
      { _id: intern._id },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.status(200).json({
      token,
      refreshToken,
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

exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken)
      return res.status(401).json({ error: "Refresh token required" });

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    const newToken = jwt.sign(
      {
        _id: decoded._id,
        role: "intern",
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ token: newToken });
  } catch (err) {
    res.status(401).json({ error: "Invalid refresh token" });
  }
};

// Создание стажёра
// Создание стажёра
exports.createIntern = catchAsync(async (req, res, next) => {
  const intern = await internService.createIntern(req.body);
  res.status(201).json(intern);
});

exports.getPendingInterns = async (req, res) => {
  try {
    // Check role from req.user (set by auth middleware)
    if (req.user?.role !== "mentor") {
      return res.status(403).json({ error: "Доступ только для менторов" });
    }

    const mentorId = req.user.id || req.user._id; // Handle both id formats

    // Find all interns who have pending tasks for this mentor
    const interns = await Intern.find({
      "pendingMentors.mentorId": mentorId,
    })
      .populate("branch", "name")
      .populate("mentor", "name lastName")
      .populate("pendingMentors.lessonId", "topic date time group");

    // Transform data to flatten the structure for frontend (InternCard expects topic, time, lessonId at root)
    const flattenedInterns = [];

    interns.forEach(intern => {
      // Find all pending tasks for this mentor
      const userPendingTasks = intern.pendingMentors.filter(
        pm => {
          if (!pm.mentorId || !mentorId) return false;
          return String(pm.mentorId) === String(mentorId) && pm.lessonId;
        }
      );

      // Create a separate entry for each pending lesson
      userPendingTasks.forEach(task => {
        const lesson = task.lessonId; // Populated lesson object

        flattenedInterns.push({
          _id: intern._id,
          name: intern.name,
          lastName: intern.lastName,
          branch: intern.branch,
          grade: intern.grade,
          score: intern.score,
          lessonsVisited: intern.lessonsVisited,

          // Fields from the specific lesson
          lessonId: lesson._id,
          topic: lesson.topic,
          time: lesson.time,
          date: lesson.date,
          group: lesson.group
        });
      });
    });

    res.json(flattenedInterns);
  } catch (error) {
    console.error("Error in getPendingInterns:", error);
    res.status(500).json({ error: error.message });
  }
};

// Получение профиля стажёра
exports.getInternProfile = catchAsync(async (req, res) => {
  const profile = await internService.getInternProfile(
    req.user,
    req.params.id
  );
  res.json(profile);
});

// Получение стажёров по филиалу (из JWT)
exports.getInterns = catchAsync(async (req, res) => {
  const interns = await internService.getInterns(req.user);
  res.json(interns);
});

// Обновление стажёра
exports.updateIntern = catchAsync(async (req, res) => {
  const intern = await internService.updateIntern(
    req.params.id,
    req.body
  );
  res.json(intern);
});

exports.deleteIntern = catchAsync(async (req, res) => {
  await internService.deleteIntern(req.params.id);
  res.status(204).json({ message: "Intern deleted successfully" });
});

exports.rateIntern = catchAsync(async (req, res) => {
  const { lessonId, stars, feedback } = req.body;
  // Use req.user.id because auth middleware typically attaches the decoded token (which has 'id') or the user doc (which has '_id')
  // Login payload: { id: mentor._id ... }
  const mentorId = req.user.id || req.user._id;
  console.log(lessonId, mentorId, stars, feedback, "InternController")

  const result = await internService.rateIntern(
    mentorId,
    lessonId,
    stars,
    feedback
  );
  res.json(result);
});

// Добавление посещённых уроков
exports.addLessonVisit = catchAsync(async (req, res) => {
  const result = await internService.addLessonVisit(
    req.body.mentorId,
    req.params.id,
    req.body
  );
  res.json(result);
});

exports.getInternsRating = catchAsync(async (req, res) => {
  const result = await internService.getInternsRating();
  res.json(result);
});

exports.upgradeInternGrade = catchAsync(async (req, res) => {
  const result = await internService.upgradeInternGrade(
    req.params.id,
    req.body.newGrade,
    {
      withConcession: req.body.withConcession,
      percentage: req.body.percentage,
      note: req.body.note,
      promotedBy: req.user?.id, // ID админа если есть
    }
  );
  res.json(result);
});

exports.getRatings = catchAsync(async (req, res, next) => {
  const ratings = await internService.getRatings();
  res.json(ratings);
});