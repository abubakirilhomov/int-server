const Mentor = require("../models/mentorModel");
const Branch = require("../models/branchModel");
const mentorService = require("../services/mentorService");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

exports.createMentor = catchAsync(async (req, res) => {
  const { name, lastName, password, branch } = req.body;
  if (!name || !password || !branch) {
    throw new AppError("Name, password and branch are required", 400);
  }

  // Hash password manually since model doesn't seem to have pre-save hook for it based on verification
  const hashedPassword = await bcrypt.hash(password, 10);

  const mentor = await Mentor.create({
    name,
    lastName,
    password: hashedPassword,
    branch
  });

  mentor.password = undefined; // Hide password in response
  res.status(201).json(mentor);
});

exports.getMentors = catchAsync(async (req, res) => {
  const mentors = await Mentor.find().populate("branch", "name");
  res.json(mentors);
});

exports.deleteMentor = catchAsync(async (req, res) => {
  await Mentor.findByIdAndDelete(req.params.id);
  res.status(204).json({ message: "Mentor deleted" });
});

exports.loginMentor = catchAsync(async (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) throw new AppError("Name and password required", 400);

  // 1. Находим всех менторов с таким именем
  const mentors = await Mentor.find({ name });

  if (!mentors || mentors.length === 0) {
    throw new AppError("Invalid credentials", 401);
  }

  let mentor = null;

  // 2. Перебираем кандидатов
  for (const candidate of mentors) {
    // А. Пробуем сравнить как хеш
    let isMatch = await bcrypt.compare(password, candidate.password);

    // Б. Если не подошло, пробуем сравнить как обычный текст (для старых аккаунтов)
    if (!isMatch) {
      if (password === candidate.password) {
        isMatch = true;

        // (Опционально) Можно здесь автоматически обновить пароль на хеш
        // candidate.password = await bcrypt.hash(password, 10);
        // await candidate.save();
      }
    }

    if (isMatch) {
      mentor = candidate;
      break; // Нашли нужного, выходим из цикла
    }
  }

  if (!mentor) {
    throw new AppError("Invalid credentials", 401);
  }

  // Generate tokens
  const token = jwt.sign(
    { id: mentor._id, role: mentor.role, branchId: mentor.branch },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
  const refreshToken = jwt.sign(
    { id: mentor._id },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );

  res.json({
    token,
    refreshToken,
    user: {
      _id: mentor._id,
      name: mentor.name,
      lastName: mentor.lastName,
      role: mentor.role,
      branchId: mentor.branch
    }
  });
});

exports.refreshMentorToken = catchAsync(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new AppError("Refresh token required", 401);

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);

    const newToken = jwt.sign(
      { id: decoded.id, role: "mentor" }, // Defaulting to mentor role, logic can be refined
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ token: newToken });
  } catch (err) {
    throw new AppError("Invalid refresh token", 401);
  }
});

exports.getMentorStats = catchAsync(async (req, res) => {
  const stats = await mentorService.getMentorStats(req.params.id);
  res.json({
    success: true,
    data: stats,
  });
});

exports.getAllMentorsDebt = catchAsync(async (req, res) => {
  const mentorsWithDebt = await mentorService.getAllMentorsWithDebt();
  res.json({
    success: true,
    data: mentorsWithDebt,
  });
});

exports.getMentorDebtDetails = catchAsync(async (req, res) => {
  const debtDetails = await mentorService.getMentorDebtDetails(req.params.id);
  res.json({
    success: true,
    data: debtDetails,
  });
});
