const Mentor = require("../models/mentorModel");
const Branch = require("../models/branchModel");
const mentorService = require("../services/mentorService");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

exports.createMentor = catchAsync(async (req, res) => {
  const { name, lastName, password, branch, branches, role, profilePhoto } = req.body;
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
  });

  mentor.password = undefined; // Hide password in response
  res.status(201).json(mentor);
});

exports.getMentors = catchAsync(async (req, res) => {
  const mentors = await Mentor.find().populate("branches", "name");
  res.json(mentors);
});

exports.deleteMentor = catchAsync(async (req, res) => {
  await Mentor.findByIdAndDelete(req.params.id);
  res.status(204).json({ message: "Mentor deleted" });
});

exports.updateMentor = catchAsync(async (req, res) => {
  const { name, lastName, password, branch, branches, role, profilePhoto } = req.body;
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

  // Only update password if provided
  if (password && password.trim()) {
    mentor.password = await bcrypt.hash(password, 10);
  }

  await mentor.save();

  // Populate branches and hide password
  const updatedMentor = await Mentor.findById(id).populate("branches", "name");

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

  // 1. Находим всех менторов с таким именем (explicitly select password)
  const mentors = await Mentor.find(query).select('+password');

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

  // Generate tokens
  const token = jwt.sign(
    {
      id: mentor._id,
      role: mentor.role,
      branchIds: mentor.branches || [],
      branchId: mentor.branches?.[0] || null,
      name: mentor.name,
      lastName: mentor.lastName || "",
    },
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
      branchIds: mentor.branches || [],
      branchId: mentor.branches?.[0] || null,
      profilePhoto: mentor.profilePhoto || "",
    }
  });
});

exports.refreshMentorToken = catchAsync(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new AppError("Refresh token required", 401);

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
    const mentor = await Mentor.findById(decoded.id || decoded._id);
    if (!mentor) throw new AppError("Mentor not found", 404);

    const newToken = jwt.sign(
      {
        id: mentor._id,
        role: mentor.role,
        branchIds: mentor.branches || [],
        branchId: mentor.branches?.[0] || null,
        name: mentor.name,
        lastName: mentor.lastName || "",
      },
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
