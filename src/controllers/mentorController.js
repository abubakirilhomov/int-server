const Mentor = require("../models/mentorModel");
const Branch = require("../models/branchModel");
const RevokedToken = require("../models/revokedTokenModel");
const mentorService = require("../services/mentorService");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { setRefreshCookie, clearRefreshCookie } = require("../utils/refreshCookie");

exports.createMentor = catchAsync(async (req, res) => {
  const { name, lastName, password, branch, branches, role, profilePhoto, telegramChatId } = req.body;
  if (!name || !password) {
    throw new AppError("Name and password are required", 400);
  }

  // Support both: single branch (legacy) and branches array
  const branchList = branches
    ? branches
    : branch
    ? [branch]
    : [];

  // Hash password manually since model doesn't seem to have pre-save hook for it based on verification
  const hashedPassword = await bcrypt.hash(password, 10);

  const mentor = await Mentor.create({
    name,
    lastName,
    password: hashedPassword,
    branches: branchList,
    role: ["mentor", "admin", "branchManager"].includes(role) ? role : "mentor",
    profilePhoto: profilePhoto || "",
    telegramChatId: typeof telegramChatId === "string" ? telegramChatId.trim() : "",
  });

  mentor.password = undefined; // Hide password in response
  res.status(201).json(mentor);
});

exports.getMentors = catchAsync(async (req, res) => {
  const select = req.user?.role === "admin" ? "+telegramChatId" : "";
  const mentors = await Mentor.find().select(select).populate("branches", "name");
  res.json(mentors);
});

exports.deleteMentor = catchAsync(async (req, res) => {
  await Mentor.findByIdAndDelete(req.params.id);
  res.status(204).json({ message: "Mentor deleted" });
});

exports.updateMentor = catchAsync(async (req, res) => {
  const { name, lastName, password, branch, branches, role, profilePhoto, telegramChatId } = req.body;
  const { id } = req.params;

  // Find the mentor (select password field for potential update)
  const mentor = await Mentor.findById(id).select('+password');
  if (!mentor) {
    throw new AppError("Mentor not found", 404);
  }

  // Update fields
  if (name) mentor.name = name;
  if (lastName !== undefined) mentor.lastName = lastName;
  // Support both: single branch (legacy) and branches array
  if (branches) {
    mentor.branches = branches;
  } else if (branch) {
    mentor.branches = [branch];
  }
  if (role && ['mentor', 'admin', 'branchManager'].includes(role)) mentor.role = role;
  if (profilePhoto !== undefined) mentor.profilePhoto = profilePhoto;
  if (telegramChatId !== undefined) {
    mentor.telegramChatId = typeof telegramChatId === "string" ? telegramChatId.trim() : "";
  }

  // Only update password if provided
  if (password && password.trim()) {
    mentor.password = await bcrypt.hash(password, 10);
  }

  await mentor.save();

  // Populate branches and hide password
  const updatedMentor = await Mentor.findById(id)
    .select("+telegramChatId")
    .populate("branches", "name");

  res.json(updatedMentor);
});

exports.resetPassword = catchAsync(async (req, res) => {
  const { id } = req.params;

  // Find the mentor (select password field for reset)
  const mentor = await Mentor.findById(id).select('+password');
  if (!mentor) {
    throw new AppError("Mentor not found", 404);
  }

  // Generate a temporary password (8 random characters)
  const tempPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8).toUpperCase();

  // Hash and save the new password
  mentor.password = await bcrypt.hash(tempPassword, 10);
  await mentor.save();

  // Return the temporary password
  res.json({
    success: true,
    message: "Password reset successfully",
    tempPassword: tempPassword,
    mentor: {
      _id: mentor._id,
      name: mentor.name,
      lastName: mentor.lastName
    }
  });
});

exports.loginMentor = catchAsync(async (req, res) => {
  const { name, lastName, password } = req.body;
  if (!name || !lastName || !password) throw new AppError("Name, lastName and password required", 400);

  const query = {
    name: String(name).trim(),
    lastName: String(lastName).trim(),
  };

  // 1. Находим всех менторов с таким именем (explicitly select password,
  //    populate branches so the response can carry names for the runtime
  //    branch switcher in the UI).
  const mentors = await Mentor.find(query)
    .select('+password')
    .populate('branches', 'name');

  if (!mentors || mentors.length === 0) {
    throw new AppError("Invalid credentials", 401);
  }

  let mentor = null;

  // 2. Перебираем кандидатов — только bcrypt, plain-text fallback удалён
  for (const candidate of mentors) {
    const isMatch = await bcrypt.compare(password, candidate.password);
    if (isMatch) {
      mentor = candidate;
      break;
    }
  }

  if (!mentor) {
    throw new AppError("Invalid credentials", 401);
  }

  // branches is now populated → split into raw IDs (for JWT + back-compat
  // branchIds) and {_id, name} objects (for the switcher).
  const branchObjs = (mentor.branches || []).map((b) => ({ _id: b._id, name: b.name }));
  const branchIds = branchObjs.map((b) => b._id);

  // Generate tokens
  const token = jwt.sign(
    {
      id: mentor._id,
      role: mentor.role,
      branchIds,
      branchId: branchIds[0] || null,
      name: mentor.name,
      lastName: mentor.lastName || "",
      jti: crypto.randomUUID(),
    },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
  const refreshToken = jwt.sign(
    { id: mentor._id, jti: crypto.randomUUID() },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
  setRefreshCookie(res, "refresh_mentor", refreshToken);

  res.json({
    token,
    refreshToken,
    user: {
      _id: mentor._id,
      name: mentor.name,
      lastName: mentor.lastName,
      role: mentor.role,
      branchIds,
      branchId: branchIds[0] || null,
      branches: branchObjs,
      profilePhoto: mentor.profilePhoto || "",
    }
  });
});

exports.refreshMentorToken = catchAsync(async (req, res) => {
  // Cookie first, body fallback for migration window.
  const refreshToken = req.cookies?.refresh_mentor || req.body?.refreshToken;
  if (!refreshToken) throw new AppError("Refresh token required", 401);

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);

    if (decoded.jti) {
      const revoked = await RevokedToken.exists({ jti: decoded.jti });
      if (revoked) throw new AppError("Refresh token revoked", 401);
    }

    const mentor = await Mentor.findById(decoded.id || decoded._id)
      .populate('branches', 'name');
    if (!mentor) throw new AppError("Mentor not found", 404);

    const branchObjs = (mentor.branches || []).map((b) => ({ _id: b._id, name: b.name }));
    const branchIds = branchObjs.map((b) => b._id);

    const newToken = jwt.sign(
      {
        id: mentor._id,
        role: mentor.role,
        branchIds,
        branchId: branchIds[0] || null,
        name: mentor.name,
        lastName: mentor.lastName || "",
        jti: crypto.randomUUID(),
      },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    // Rotate refresh cookie.
    const newRefresh = jwt.sign(
      { id: mentor._id, jti: crypto.randomUUID() },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );
    setRefreshCookie(res, "refresh_mentor", newRefresh);

    res.json({
      token: newToken,
      user: {
        _id: mentor._id,
        name: mentor.name,
        lastName: mentor.lastName,
        role: mentor.role,
        branchIds,
        branchId: branchIds[0] || null,
        branches: branchObjs,
        profilePhoto: mentor.profilePhoto || "",
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("Invalid refresh token", 401);
  }
});

exports.logoutMentor = catchAsync(async (req, res) => {
  const { jti, exp, id } = req.user;
  if (jti && exp) {
    await RevokedToken.create({
      jti,
      exp: new Date(exp * 1000),
      userId: String(id),
      userType: req.user.role === "admin" ? "admin" : "mentor",
    }).catch((err) => {
      if (err.code !== 11000) throw err;
    });
  }

  const refreshToken = req.cookies?.refresh_mentor || req.body?.refreshToken;
  if (refreshToken) {
    try {
      const decoded = jwt.verify(
        refreshToken,
        process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
      );
      if (decoded.jti && decoded.exp) {
        await RevokedToken.create({
          jti: decoded.jti,
          exp: new Date(decoded.exp * 1000),
          userId: String(decoded.id || id),
          userType: req.user.role === "admin" ? "admin" : "mentor",
        }).catch((err) => {
          if (err.code !== 11000) throw err;
        });
      }
    } catch {
      // Refresh token уже невалиден — ничего не делаем, logout всё равно успешен
    }
  }

  clearRefreshCookie(res, "refresh_mentor");
  res.json({ message: "Вы вышли из системы" });
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

exports.getMentorsActivity = catchAsync(async (req, res) => {
  const data = await mentorService.getMentorsWithActivity();
  res.json({ success: true, data });
});

exports.getInternsActivity = catchAsync(async (req, res) => {
  const data = await mentorService.getInternsActivityForMentor(req.params.id);
  res.json({ success: true, data });
});

exports.changePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    throw new AppError("currentPassword and newPassword are required", 400);
  }
  if (newPassword.length < 6) {
    throw new AppError("New password must be at least 6 characters", 400);
  }

  const mentor = await Mentor.findById(req.user.id).select("+password");
  if (!mentor) throw new AppError("Mentor not found", 404);

  const isMatch = await bcrypt.compare(currentPassword, mentor.password);
  if (!isMatch) throw new AppError("Current password is incorrect", 401);

  mentor.password = await bcrypt.hash(newPassword, 10);
  await mentor.save();

  res.json({ success: true, message: "Password changed successfully" });
});
