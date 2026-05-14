const crypto = require("crypto");
const mongoose = require("mongoose");

const Application = require("../models/applicationModel");
const Branch = require("../models/branchModel");
const Mentor = require("../models/mentorModel");
const Intern = require("../models/internModel");
const grades = require("../config/grades");

const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { notifyApplication, SPHERE_LABELS, SHIFT_LABELS } =
  require("../services/telegramService");

const DEDUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = ["pending", "contacted", "interview_scheduled"];

const isValidObjectId = (id) => mongoose.isValidObjectId(id);

const normalizePhone = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  const trimmed = digits.startsWith("998") ? digits.slice(3) : digits;
  return `+998${trimmed.slice(0, 9)}`;
};

const normalizeUsername = (raw) =>
  String(raw || "").trim().replace(/^@+/, "").toLowerCase();

const splitFullName = (full) => {
  const parts = String(full || "").trim().split(/\s+/);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") || "" };
};

const PHONE_RE = /^\+998\d{9}$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

// ─── PUBLIC: form data ────────────────────────────────────────────────────────
exports.getFormData = catchAsync(async (req, res) => {
  const branches = await Branch.find().select("name").lean();
  const mentors = await Mentor.find().select("name lastName branches role").lean();

  const branchOptions = branches.map((b) => {
    const branchMentors = mentors
      .filter((m) => m.role !== "admin" && (m.branches || []).some((br) => String(br) === String(b._id)))
      .map((m) => ({
        id: String(m._id),
        name: `${m.name || ""} ${m.lastName || ""}`.trim(),
      }))
      .filter((m) => m.name);

    return {
      id: String(b._id),
      name: b.name,
      mentors: branchMentors,
    };
  });

  const spheres = Application.SPHERES.map((value) => ({
    value,
    label: SPHERE_LABELS[value] || value,
  }));

  const shifts = Application.SHIFTS.map((value) => ({
    value,
    label: SHIFT_LABELS[value] || value,
  }));

  res.set("Cache-Control", "public, max-age=300");
  res.json({ branches: branchOptions, spheres, shifts });
});

// ─── PUBLIC: submit application ───────────────────────────────────────────────
exports.submit = catchAsync(async (req, res, next) => {
  const { fullName, phone, telegramUsername, age, branchId, mentorId, sphere, shift } =
    req.body;

  const normalizedPhone = normalizePhone(phone);
  if (!PHONE_RE.test(normalizedPhone)) {
    return next(new AppError("Telefon raqami noto'g'ri formatda", 400));
  }

  const normalizedUsername = normalizeUsername(telegramUsername);
  if (!USERNAME_RE.test(normalizedUsername)) {
    return next(new AppError("Telegram username noto'g'ri", 400));
  }

  if (!isValidObjectId(branchId) || !isValidObjectId(mentorId)) {
    return next(new AppError("Некорректный филиал или ментор", 400));
  }

  const { firstName, lastName } = splitFullName(fullName);
  if (!firstName || !lastName) {
    return next(new AppError("Iltimos, ism va familiyangizni to'liq kiriting", 400));
  }

  const branch = await Branch.findById(branchId).lean();
  if (!branch) return next(new AppError("Филиал не найден", 400));

  const mentor = await Mentor.findById(mentorId).lean();
  if (!mentor) return next(new AppError("Ментор не найден", 400));

  const mentorBranches = (mentor.branches || []).map(String);
  if (!mentorBranches.includes(String(branchId))) {
    return next(new AppError("Этот ментор не работает в выбранном филиале", 400));
  }

  // Dedup window
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS);
  const existing = await Application.findOne({
    $or: [{ phone: normalizedPhone }, { telegramUsername: normalizedUsername }],
    createdAt: { $gte: cutoff },
    status: { $in: ACTIVE_STATUSES },
  }).lean();

  if (existing) {
    return res.status(409).json({
      error: "Sizda faol arizangiz mavjud. Iltimos, keyingi haftagacha kutib turing.",
      existingStatus: existing.status,
    });
  }

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "";

  const application = await Application.create({
    firstName,
    lastName,
    phone: normalizedPhone,
    telegramUsername: normalizedUsername,
    age,
    branch: branchId,
    mentor: mentorId,
    sphere,
    shift,
    submitterIp: ip,
    source: req.body.source || "internUp",
  });

  res.status(201).json({ id: String(application._id), status: application.status });

  // Fire-and-forget notify (after response)
  Promise.resolve()
    .then(() => notifyApplication(application))
    .catch((err) => console.error("notifyApplication failed:", err));
});

// ─── ADMIN: list ──────────────────────────────────────────────────────────────
exports.list = catchAsync(async (req, res) => {
  const {
    status,
    branch,
    from,
    to,
    q,
    page = 1,
    limit = 50,
    sort = "-createdAt",
  } = req.query;

  const filter = {};
  if (status) {
    filter.status = { $in: String(status).split(",").map((s) => s.trim()) };
  }
  if (branch && isValidObjectId(branch)) filter.branch = branch;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }
  if (q) {
    const re = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { firstName: re },
      { lastName: re },
      { phone: re },
      { telegramUsername: re },
    ];
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

  const [items, total] = await Promise.all([
    Application.find(filter)
      .sort(sort)
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate("branch", "name")
      .populate("mentor", "name lastName")
      .populate("reviewedBy", "name lastName")
      .populate("convertedToIntern", "username name lastName")
      .lean(),
    Application.countDocuments(filter),
  ]);

  res.json({ items, total, page: pageNum, limit: limitNum });
});

// ─── ADMIN: get one ───────────────────────────────────────────────────────────
exports.getOne = catchAsync(async (req, res, next) => {
  if (!isValidObjectId(req.params.id)) {
    return next(new AppError("Некорректный ID", 400));
  }
  const app = await Application.findById(req.params.id)
    .populate("branch", "name")
    .populate("mentor", "name lastName")
    .populate("reviewedBy", "name lastName")
    .populate("convertedToIntern", "username name lastName")
    .lean();

  if (!app) return next(new AppError("Заявка не найдена", 404));
  res.json(app);
});

// ─── ADMIN: update status ─────────────────────────────────────────────────────
exports.updateStatus = catchAsync(async (req, res, next) => {
  if (!isValidObjectId(req.params.id)) {
    return next(new AppError("Некорректный ID", 400));
  }

  const { status, notes, rejectionReason, interviewDate } = req.body;

  const app = await Application.findById(req.params.id);
  if (!app) return next(new AppError("Заявка не найдена", 404));

  if (app.convertedToIntern && status !== "accepted") {
    return next(new AppError("Заявка уже конвертирована — статус нельзя изменить", 409));
  }

  app.status = status;
  if (notes !== undefined) app.notes = notes;
  if (rejectionReason !== undefined) app.rejectionReason = rejectionReason;
  if (interviewDate !== undefined) app.interviewDate = interviewDate;
  app.reviewedBy = req.user.id || req.user._id;
  app.reviewedAt = new Date();

  await app.save();
  res.json(app);
});

// ─── ADMIN: convert to Intern ─────────────────────────────────────────────────
exports.convert = catchAsync(async (req, res, next) => {
  if (!isValidObjectId(req.params.id)) {
    return next(new AppError("Некорректный ID", 400));
  }

  const app = await Application.findById(req.params.id);
  if (!app) return next(new AppError("Заявка не найдена", 404));

  if (app.convertedToIntern) {
    return next(new AppError("Заявка уже конвертирована", 409));
  }

  // Resolve username — telegramUsername might collide with existing intern
  let username = app.telegramUsername;
  const collision = await Intern.findOne({ username }).lean();
  if (collision) {
    return next(
      new AppError(
        `Имя пользователя "${username}" уже занято. Измените telegramUsername в заявке вручную или используйте другое.`,
        409
      )
    );
  }

  const tempPassword = crypto.randomBytes(6).toString("hex"); // 12 hex chars
  const now = new Date();
  const gradeConfig = grades["junior"];

  const intern = await Intern.create({
    name: app.firstName,
    lastName: app.lastName,
    username,
    password: tempPassword, // hashed by pre-save hook
    phoneNumber: app.phone,
    telegram: app.telegramUsername,
    sphere: app.sphere,
    branches: [{ branch: app.branch, mentor: app.mentor, isHeadIntern: false, joinedAt: now }],
    grade: "junior",
    dateJoined: now,
    probationStartDate: now,
    probationPeriod: gradeConfig?.trialPeriod,
    lessonsPerMonth: gradeConfig?.lessonsPerMonth,
  });

  app.status = "accepted";
  app.convertedToIntern = intern._id;
  app.reviewedBy = req.user.id || req.user._id;
  app.reviewedAt = now;
  await app.save();

  res.status(201).json({
    intern: {
      _id: String(intern._id),
      username: intern.username,
      name: intern.name,
      lastName: intern.lastName,
    },
    tempPassword,
  });
});

// ─── ADMIN: retry telegram notify ─────────────────────────────────────────────
exports.retryNotify = catchAsync(async (req, res, next) => {
  if (!isValidObjectId(req.params.id)) {
    return next(new AppError("Некорректный ID", 400));
  }
  const app = await Application.findById(req.params.id);
  if (!app) return next(new AppError("Заявка не найдена", 404));

  const result = await notifyApplication(app);
  res.json({
    sent: result.sent,
    failed: result.failed,
    errors: result.errors,
    telegramNotified: app.telegramNotified,
    telegramError: app.telegramError,
  });
});
