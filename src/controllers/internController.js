const Intern = require("../models/internModel");
const Branch = require("../models/branchModel");
const Mentor = require("../models/mentorModel");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const Lesson = require("../models/lessonModel");
const RevokedToken = require("../models/revokedTokenModel");
const grades = require("../config/grades");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const internService = require("../services/internService");
const { getInternPlanStatus } = require("../utils/internPlanStatus");
const { getAllBadgeStatuses } = require("../services/badgeService");
const { setRefreshCookie, clearRefreshCookie } = require("../utils/refreshCookie");

exports.loginIntern = catchAsync(async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Имя пользователя и пароль обязательны" });
    }
    const intern = await Intern.findOne({ username })
      .select("+password")
      .populate("branches.branch", "name");
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

    if (intern.status === "archived") {
      return res
        .status(403)
        .json({ error: "Аккаунт архивирован. Обратитесь к администратору." });
    }

    const branchIds = intern.branches.map((b) => b.branch?._id || b.branch);
    const token = jwt.sign(
      {
        id: intern._id,
        role: "intern",
        branchIds,
        branchId: branchIds[0] || null,
        isHeadIntern: intern.branches.some((b) => b.isHeadIntern),
        jti: crypto.randomUUID(),
      },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );
    const refreshToken = jwt.sign(
      { id: intern._id, jti: crypto.randomUUID() },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );
    setRefreshCookie(res, "refresh_intern", refreshToken);
    const planStatus = await getInternPlanStatus(intern);

    const surveyCompleted = Boolean(intern.internshipSurvey?.submittedAt);

    res.status(200).json({
      token,
      refreshToken,
      user: {
        _id: intern._id,
        name: intern.name,
        lastName: intern.lastName,
        username: intern.username,
        role: "intern",
        branchIds,
        branchId: branchIds[0] || null,
        branches: intern.branches,
        isHeadIntern: intern.branches.some((b) => b.isHeadIntern),
        phoneNumber: intern.phoneNumber || "",
        telegram: intern.telegram || "",
        sphere: intern.sphere || "",
        profilePhoto: intern.profilePhoto || "",
        avatar: intern.profilePhoto || "",
        isPlanBlocked: planStatus.isPlanBlocked,
        planBlockReason: planStatus.reason,
        status: intern.status || "active",
        isFrozen: intern.status === "frozen",
        freezeInfo: intern.status === "frozen" ? {
          startedAt: intern.freezeInfo?.startedAt || null,
          expectedReturn: intern.freezeInfo?.expectedReturn || null,
          reason: intern.freezeInfo?.reason || null,
          note: intern.freezeInfo?.note || "",
        } : null,
        surveyCompleted,
        internshipSurvey: surveyCompleted ? intern.internshipSurvey : null,
      },
    });
});

exports.refreshToken = async (req, res) => {
  try {
    // Cookie first, body fallback for migration window from clients that
    // still send refreshToken in the request body.
    const refreshToken = req.cookies?.refresh_intern || req.body?.refreshToken;
    if (!refreshToken)
      return res.status(401).json({ error: "Refresh token required" });

    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
    );

    if (decoded.jti) {
      const revoked = await RevokedToken.exists({ jti: decoded.jti });
      if (revoked) {
        return res.status(401).json({ error: "Refresh token revoked" });
      }
    }

    const intern = await Intern.findById(decoded.id);
    if (!intern) return res.status(404).json({ error: "Intern not found" });

    if (intern.status === "archived") {
      return res.status(403).json({ error: "Аккаунт архивирован" });
    }

    const newToken = jwt.sign(
      {
        id: intern._id,
        role: "intern",
        branchIds: intern.branches.map((b) => b.branch),
        branchId: intern.branches[0]?.branch || null,
        isHeadIntern: intern.branches.some((b) => b.isHeadIntern),
        jti: crypto.randomUUID(),
      },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    // Rotate the refresh cookie so each refresh issues a fresh jti.
    const newRefresh = jwt.sign(
      { id: intern._id, jti: crypto.randomUUID() },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );
    setRefreshCookie(res, "refresh_intern", newRefresh);

    res.json({ token: newToken });
  } catch (err) {
    res.status(401).json({ error: "Invalid refresh token" });
  }
};

exports.logoutIntern = catchAsync(async (req, res) => {
  const { jti, exp, id } = req.user;
  if (jti && exp) {
    await RevokedToken.create({
      jti,
      exp: new Date(exp * 1000),
      userId: String(id),
      userType: "intern",
    }).catch((err) => {
      if (err.code !== 11000) throw err;
    });
  }

  const refreshToken = req.cookies?.refresh_intern || req.body?.refreshToken;
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
          userType: "intern",
        }).catch((err) => {
          if (err.code !== 11000) throw err;
        });
      }
    } catch {
      // Refresh token уже невалиден — ничего не делаем, logout всё равно успешен
    }
  }

  clearRefreshCookie(res, "refresh_intern");
  res.json({ message: "Вы вышли из системы" });
});

// Создание стажёра
// Создание стажёра
exports.createIntern = catchAsync(async (req, res, next) => {
  const intern = await internService.createIntern(req.body);
  res.status(201).json(intern);
});

exports.getPendingInterns = catchAsync(async (req, res) => {
    if (!["mentor", "branchManager"].includes(req.user?.role)) {
      return res.status(403).json({ error: "Доступ только для менторов и branch manager" });
    }

    const mentorId = req.user.id || req.user._id; // Handle both id formats

    // Find all interns who have pending tasks for this mentor.
    // Архивных не показываем — у замороженных pending уроки могут оставаться
    // (по решению user'а pending не отменяются при заморозке), поэтому
    // фронт получает их с признаком status, чтобы отметить бейджем.
    const interns = await Intern.find({
      "pendingMentors.mentorId": mentorId,
      status: { $ne: "archived" },
    })
      .populate("branches.branch", "name telegramLink")
      .populate("branches.mentor", "name lastName")
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
          branch: intern.branches[0]?.branch || null,
          branches: intern.branches,
          grade: intern.grade,
          score: intern.score,
          lessonsVisited: intern.lessonsVisited,
          profilePhoto: intern.profilePhoto || "",
          status: intern.status || "active",
          isFrozen: intern.status === "frozen",

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
});

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

exports.updateOwnProfile = catchAsync(async (req, res) => {
  const internId = req.user?.id || req.user?._id;
  const intern = await internService.updateOwnProfile(internId, req.body);
  res.json(intern);
});

exports.resetPassword = catchAsync(async (req, res) => {
  const intern = await Intern.findById(req.params.id);
  if (!intern) throw new AppError("Intern not found", 404);

  const tempPassword = Math.random().toString(36).slice(-8);
  intern.password = tempPassword; // pre-save hook will hash it
  await intern.save();

  res.json({
    success: true,
    tempPassword,
    intern: { _id: intern._id, name: intern.name, lastName: intern.lastName, username: intern.username },
  });
});

exports.deleteIntern = catchAsync(async (req, res) => {
  await internService.deleteIntern(req.params.id);
  res.status(204).json({ message: "Intern deleted successfully" });
});

exports.rateIntern = catchAsync(async (req, res) => {
  const { lessonId, stars, feedback, violations } = req.body;

  const starsNum = Number(stars);
  if (!Number.isFinite(starsNum) || starsNum < 1 || starsNum > 5) {
    throw new AppError("stars must be a number between 1 and 5", 400);
  }

  // Use req.user.id because auth middleware typically attaches the decoded token (which has 'id') or the user doc (which has '_id')
  // Login payload: { id: mentor._id ... }
  const mentorId = req.user.id || req.user._id;

  const result = await internService.rateIntern(
    mentorId,
    lessonId,
    starsNum,
    feedback,
    violations
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

exports.addBonusLessons = catchAsync(async (req, res, next) => {
  const { count, reason, notes } = req.body;
  const adminId = req.user?.id;
  const result = await internService.addBonusLessons(
    req.params.id,
    { count, reason, notes, addedBy: adminId }
  );
  res.json(result);
});

exports.setHeadIntern = catchAsync(async (req, res, next) => {
  const { isHeadIntern, branchId } = req.body;
  const result = await internService.setHeadIntern(req.params.id, isHeadIntern, branchId);
  res.json(result);
});

exports.headInternWarning = catchAsync(async (req, res, next) => {
  const headInternId = req.user?.id || req.user?._id;
  const { ruleId, notes } = req.body;
  const result = await internService.headInternWarning(
    headInternId,
    req.params.id,
    { ruleId, notes }
  );
  res.json(result);
});

exports.getBranchManagerInterns = catchAsync(async (req, res) => {
  const result = await internService.getBranchManagerInterns(req.user);
  res.json(result);
});

exports.addBranchManagerComplaint = catchAsync(async (req, res) => {
  const result = await internService.addBranchManagerComplaint(
    req.user,
    req.params.id,
    req.body
  );
  res.json(result);
});

exports.setInternActivation = catchAsync(async (req, res) => {
  const { isEnabled, note } = req.body;
  const result = await internService.setInternActivation(req.params.id, {
    isEnabled,
    note,
    adminId: req.user?.id || req.user?._id,
  });
  res.json(result);
});

exports.freezeIntern = catchAsync(async (req, res) => {
  const { reason, note, expectedReturn } = req.body;
  const result = await internService.freezeIntern(req.params.id, {
    reason,
    note,
    expectedReturn,
    adminId: req.user?.id || req.user?._id,
  });
  res.json(result);
});

exports.unfreezeIntern = catchAsync(async (req, res) => {
  const result = await internService.unfreezeIntern(req.params.id);
  res.json(result);
});

exports.archiveIntern = catchAsync(async (req, res) => {
  const { reason, note, becameTutor, tutorMentorId } = req.body;
  const result = await internService.archiveIntern(req.params.id, {
    reason,
    note,
    becameTutor,
    tutorMentorId,
    adminId: req.user?.id || req.user?._id,
  });
  res.json(result);
});

exports.unarchiveIntern = catchAsync(async (req, res) => {
  const result = await internService.unarchiveIntern(req.params.id);
  res.json(result);
});

exports.getFrozenInterns = catchAsync(async (req, res) => {
  const result = await internService.getFrozenInterns();
  res.json(result);
});

exports.getArchivedInterns = catchAsync(async (req, res) => {
  const result = await internService.getArchivedInterns();
  res.json(result);
});

exports.changePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    throw new AppError("currentPassword and newPassword are required", 400);
  }
  if (newPassword.length < 6) {
    throw new AppError("New password must be at least 6 characters", 400);
  }

  const intern = await Intern.findById(req.user.id).select("+password");
  if (!intern) throw new AppError("Intern not found", 404);

  const isMatch = await bcrypt.compare(currentPassword, intern.password);
  if (!isMatch) throw new AppError("Current password is incorrect", 401);

  intern.password = newPassword; // pre-save hook will hash it
  await intern.save();

  res.json({ success: true, message: "Password changed successfully" });
});


exports.getMyBadges = catchAsync(async (req, res) => {
  const badges = await getAllBadgeStatuses(req.user.id);
  res.json({ badges });
});

// One-time participant survey. Submitted by the intern from the dashboard
// modal. Idempotent — second attempt is a 409. Body shape validated by
// validations/internshipSurveyValidation.js (dates ordered, proCourse
// required only when studyStatus = "graduated", forbidden otherwise).
exports.submitInternshipSurvey = catchAsync(async (req, res, next) => {
  if (req.user.role !== "intern") {
    return next(new AppError("Доступ только для интернов", 403));
  }

  const intern = await Intern.findById(req.user.id);
  if (!intern) return next(new AppError("Intern not found", 404));

  if (intern.internshipSurvey?.submittedAt) {
    return next(new AppError("Анкета уже отправлена", 409));
  }

  const {
    marsStudyStartedAt,
    becameInternAt,
    studyStatus,
    proCourseCompleted,
  } = req.body;

  intern.internshipSurvey = {
    submittedAt: new Date(),
    marsStudyStartedAt,
    becameInternAt,
    studyStatus,
    // For currently_studying, schema forbids the field — store null.
    proCourseCompleted:
      studyStatus === "graduated" ? proCourseCompleted : null,
  };
  await intern.save();

  res.json({
    surveyCompleted: true,
    internshipSurvey: intern.internshipSurvey,
  });
});

// Admin-only aggregation for marketing. Returns counts split by status and
// by Pro-course completion, plus average gap between Mars study start and
// becoming an intern.
exports.getSurveyStats = catchAsync(async (req, res) => {
  const docs = await Intern.find({ "internshipSurvey.submittedAt": { $ne: null } })
    .select("internshipSurvey name lastName username sphere status")
    .lean();

  const total = docs.length;
  const byStatus = { currently_studying: 0, graduated: 0 };
  const proCourse = { yes: 0, no: 0, unknown: 0 };
  let gapDaysSum = 0;
  let gapDaysCount = 0;

  for (const d of docs) {
    const s = d.internshipSurvey || {};
    if (byStatus[s.studyStatus] !== undefined) byStatus[s.studyStatus] += 1;

    if (s.studyStatus === "graduated") {
      if (s.proCourseCompleted === true) proCourse.yes += 1;
      else if (s.proCourseCompleted === false) proCourse.no += 1;
      else proCourse.unknown += 1;
    }

    if (s.marsStudyStartedAt && s.becameInternAt) {
      const gap = (new Date(s.becameInternAt) - new Date(s.marsStudyStartedAt)) / 86400000;
      if (gap >= 0) {
        gapDaysSum += gap;
        gapDaysCount += 1;
      }
    }
  }

  res.json({
    total,
    byStatus,
    proCourse, // only counts among graduated
    averageStudyToInternDays:
      gapDaysCount > 0 ? Math.round((gapDaysSum / gapDaysCount) * 10) / 10 : null,
    submissions: docs.map((d) => ({
      _id: d._id,
      name: d.name,
      lastName: d.lastName,
      username: d.username,
      sphere: d.sphere,
      status: d.status,
      internshipSurvey: d.internshipSurvey,
    })),
  });
});
