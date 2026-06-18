const crypto = require("crypto");

const InternRequest = require("../models/internRequestModel");
const Intern = require("../models/internModel");
const Mentor = require("../models/mentorModel");
const internService = require("../services/internService");

const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { sendMessage } = require("../services/telegramService");
const { sendNotificationToUser } = require("./notificationController");

// Best-effort: уведомить админов (web-push + Telegram) о новой заявке.
// Никогда не валит сабмит — все ошибки глотаются.
async function notifyAdminsOfRequest(request, branchName) {
  try {
    const admins = await Mentor.find({
      $or: [{ isAdmin: true }, { role: "admin" }],
    }).select("_id +telegramChatId");

    const title = "Новая заявка на интерна";
    const body = `${request.requestedByName} предлагает создать интерна ${request.name} ${request.lastName} (@${request.username})${branchName ? `, филиал ${branchName}` : ""}`;

    await Promise.allSettled(
      admins.map((a) => sendNotificationToUser(a._id, "mentor", title, body))
    );

    const chatIds = admins.map((a) => a.telegramChatId).filter(Boolean);
    if (chatIds.length) {
      await sendMessage(chatIds, `📝 ${title}\n${body}`);
    }
  } catch (err) {
    console.error("notifyAdminsOfRequest error:", err.message);
  }
}

// POST /api/intern-requests  (head intern)
exports.submit = catchAsync(async (req, res, next) => {
  const activeBranch = req.user.activeBranchId;
  if (!activeBranch) {
    return next(new AppError("Не указан активный филиал", 400));
  }

  // Authoritative head-intern check for the ACTIVE branch (token flag may be
  // stale after a branch switch).
  const intern = await Intern.findById(req.user.id);
  if (!intern || !intern.isHeadInternAt(activeBranch)) {
    return next(
      new AppError("Требуется статус хед-интерна в этом филиале", 403)
    );
  }

  const {
    name,
    lastName,
    username,
    mentor,
    sphere,
    phoneNumber,
    telegram,
    profilePhoto,
    dateJoined,
  } = req.body;

  // Mentor must belong to the head intern's active branch.
  const mentorDoc = await Mentor.findById(mentor);
  if (!mentorDoc) {
    return next(new AppError("Ментор не найден", 400));
  }
  const mentorBranches = (mentorDoc.branches || []).map(String);
  if (!mentorBranches.includes(String(activeBranch))) {
    return next(new AppError("Ментор не относится к вашему филиалу", 400));
  }

  // UX pre-check for username collisions (authoritative check happens again in
  // createIntern at approval time).
  const taken = await Intern.findOne({ username }).lean();
  if (taken) {
    return next(new AppError("Имя пользователя уже существует", 409));
  }
  const pendingDup = await InternRequest.findOne({
    username,
    status: "pending",
  }).lean();
  if (pendingDup) {
    return next(
      new AppError("Заявка с таким username уже на рассмотрении", 409)
    );
  }

  const request = await InternRequest.create({
    requestedBy: intern._id,
    requestedByName: `${intern.name} ${intern.lastName}`.trim(),
    branch: activeBranch,
    mentor,
    name,
    lastName,
    username,
    sphere: sphere || "backend-nodejs",
    phoneNumber: phoneNumber || "",
    telegram: telegram || "",
    profilePhoto: profilePhoto || "",
    dateJoined: dateJoined ? new Date(dateJoined) : new Date(),
    status: "pending",
  });

  notifyAdminsOfRequest(request);

  res.status(201).json(request);
});

// GET /api/intern-requests/mine  (head intern)
exports.listMine = catchAsync(async (req, res) => {
  const requests = await InternRequest.find({ requestedBy: req.user.id })
    .populate("branch", "name")
    .populate("mentor", "name lastName")
    .sort({ createdAt: -1 })
    .lean();
  res.json(requests);
});

// GET /api/intern-requests?status=pending  (admin)
exports.listForAdmin = catchAsync(async (req, res) => {
  const status = req.query.status || "pending";
  const filter = status === "all" ? {} : { status };
  const requests = await InternRequest.find(filter)
    .populate("branch", "name")
    .populate("mentor", "name lastName")
    .populate("requestedBy", "name lastName")
    .sort({ createdAt: -1 })
    .lean();
  const pendingCount = await InternRequest.countDocuments({
    status: "pending",
  });
  res.json({ requests, pendingCount });
});

// PATCH /api/intern-requests/:id/approve  (admin) — edit-before-approve + create
exports.approve = catchAsync(async (req, res, next) => {
  const request = await InternRequest.findById(req.params.id);
  if (!request) {
    return next(new AppError("Заявка не найдена", 404));
  }
  if (request.createdIntern || request.status === "approved") {
    return next(new AppError("Заявка уже одобрена", 409));
  }

  // Merge admin's edited fields over the stored request values.
  const merged = {
    name: req.body.name ?? request.name,
    lastName: req.body.lastName ?? request.lastName,
    username: req.body.username ?? request.username,
    sphere: req.body.sphere ?? request.sphere,
    phoneNumber: req.body.phoneNumber ?? request.phoneNumber,
    telegram: req.body.telegram ?? request.telegram,
    profilePhoto: req.body.profilePhoto ?? request.profilePhoto,
    dateJoined: req.body.dateJoined ?? request.dateJoined,
    mentor: req.body.mentor ?? request.mentor,
  };

  const tempPassword = crypto.randomBytes(6).toString("hex");

  // Reuse the canonical create path: validates branch/mentor, enforces username
  // uniqueness, derives grade config, hashes password. Grade hard-forced junior.
  const intern = await internService.createIntern({
    name: merged.name,
    lastName: merged.lastName,
    username: merged.username,
    password: tempPassword,
    phoneNumber: merged.phoneNumber,
    telegram: merged.telegram,
    sphere: merged.sphere,
    profilePhoto: merged.profilePhoto,
    grade: "junior",
    dateJoined: merged.dateJoined,
    branches: [
      { branch: request.branch, mentor: merged.mentor, isHeadIntern: false },
    ],
  });

  request.name = merged.name;
  request.lastName = merged.lastName;
  request.username = merged.username;
  request.sphere = merged.sphere;
  request.phoneNumber = merged.phoneNumber;
  request.telegram = merged.telegram;
  request.profilePhoto = merged.profilePhoto;
  request.dateJoined = merged.dateJoined;
  request.mentor = merged.mentor;
  request.status = "approved";
  request.reviewedBy = req.user.id || req.user._id;
  request.reviewedAt = new Date();
  request.createdIntern = intern._id;
  request.tempPassword = tempPassword;
  await request.save();

  res.status(201).json({
    intern: {
      _id: intern._id,
      username: intern.username,
      name: intern.name,
      lastName: intern.lastName,
    },
    tempPassword,
  });
});

// PATCH /api/intern-requests/:id/reject  (admin)
exports.reject = catchAsync(async (req, res, next) => {
  const request = await InternRequest.findById(req.params.id);
  if (!request) {
    return next(new AppError("Заявка не найдена", 404));
  }
  if (request.createdIntern) {
    return next(new AppError("Заявка уже одобрена", 409));
  }

  request.status = "rejected";
  request.rejectionReason = req.body.rejectionReason || "";
  request.reviewedBy = req.user.id || req.user._id;
  request.reviewedAt = new Date();
  await request.save();

  res.json(request);
});
