const crypto = require("crypto");
const mongoose = require("mongoose");
const MonthlyInterviewSession = require("../models/monthlyInterviewSessionModel");
const MonthlyInterview = require("../models/monthlyInterviewModel");
const Intern = require("../models/internModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { sendNotificationToUser } = require("./notificationController");
const { tashkentWallClockToDate } = require("../utils/tashkentTime");

const isValidObjectId = (id) => mongoose.isValidObjectId(id);

// Heartbeat shundan kech kelmasa — uzilgan hisoblanadi.
const PRESENCE_TIMEOUT_MS = 60 * 1000;
// scheduledAt dan keyin shuncha kutib, keyin avtomatik yakunlanadi.
const GRACE_MINUTES = 10;

const getHeadInternBranch = (user) => {
  const branchIds = user.branchIds || [];
  return branchIds[0] || null;
};

// ─── Sessiya yaratish: link tarqatish + roster snapshot ──────────────────────
exports.create = catchAsync(async (req, res, next) => {
  const { month, scheduledAt, meetingUrl } = req.body;
  const branchId = getHeadInternBranch(req.user);

  if (!branchId) {
    return next(new AppError("Filial topilmadi", 400));
  }
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return next(new AppError("Oy formatini kiriting (YYYY-MM)", 400));
  }
  if (!meetingUrl || !meetingUrl.trim()) {
    return next(new AppError("Meeting link kiritilishi shart", 400));
  }

  // scheduledAt: "YYYY-MM-DDTHH:mm" (Toshkent devor vaqti) yoki to'liq ISO
  const scheduledDate =
    tashkentWallClockToDate(scheduledAt) ||
    (scheduledAt && !Number.isNaN(new Date(scheduledAt).getTime()) ? new Date(scheduledAt) : null);
  if (!scheduledDate) {
    return next(new AppError("Nog'ri sana/vaqt formati", 400));
  }

  const existing = await MonthlyInterviewSession.findOne({ branch: branchId, month });
  if (existing) {
    return next(new AppError("Bu oy uchun sessiya allaqachon yaratilgan", 400));
  }

  const headInternId = req.user.id || req.user._id;

  const interns = await Intern.find({
    "branches.branch": branchId,
    status: "active",
    grade: { $ne: "senior" },
    _id: { $ne: headInternId },
  }).select("_id name lastName");

  const joinToken = crypto.randomBytes(20).toString("hex");

  const session = await MonthlyInterviewSession.create({
    branch: branchId,
    headIntern: headInternId,
    month,
    scheduledAt: scheduledDate,
    meetingUrl: meetingUrl.trim(),
    joinToken,
    attendance: interns.map((i) => ({ intern: i._id })),
  });

  const fmtTime = new Intl.DateTimeFormat("uz-UZ", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(scheduledDate);

  const frontendUrl = process.env.FRONTEND_URL || "";
  const link = `${frontendUrl}/suhbat/${joinToken}`;

  await Promise.all(
    interns.map((intern) =>
      sendNotificationToUser(
        intern._id,
        "intern",
        "📅 Oylik online suhbat",
        `${fmtTime}da oylik suhbat bo'lib o'tadi. Link: ${link}`
      )
    )
  );

  res.status(201).json({ session, notified: interns.length });
});

// ─── Joriy oy sessiyasi (head intern paneli uchun) ────────────────────────────
exports.getCurrent = catchAsync(async (req, res, next) => {
  const { month } = req.query;
  const branchId = getHeadInternBranch(req.user);

  if (!branchId) {
    return next(new AppError("Filial topilmadi", 400));
  }
  const targetMonth = month || new Date().toISOString().slice(0, 7);

  const session = await MonthlyInterviewSession.findOne({
    branch: branchId,
    month: targetMonth,
  }).populate("attendance.intern", "name lastName grade profilePhoto");

  if (!session) return res.json({ session: null });
  res.json({ session });
});

// ─── Head intern qo'lda erta yakunlaydi ───────────────────────────────────────
exports.finalizeNow = catchAsync(async (req, res, next) => {
  if (!isValidObjectId(req.params.id)) {
    return next(new AppError("Nog'ri ID", 400));
  }
  const branchId = getHeadInternBranch(req.user);
  const session = await MonthlyInterviewSession.findOne({ _id: req.params.id, branch: branchId });
  if (!session) return next(new AppError("Sessiya topilmadi", 404));

  const result = await finalizeSession(session);
  res.json(result);
});

// ─── Intern: sessiya haqida ma'lumot (token orqali) ───────────────────────────
exports.getByToken = catchAsync(async (req, res, next) => {
  const internId = req.user.id || req.user._id;
  const session = await MonthlyInterviewSession.findOne({ joinToken: req.params.token });
  if (!session) return next(new AppError("Sessiya topilmadi", 404));

  const entry = session.attendance.find((a) => String(a.intern) === String(internId));
  if (!entry) return next(new AppError("Siz bu sessiyaga tegishli emassiz", 403));

  res.json({
    scheduledAt: session.scheduledAt,
    meetingUrl: session.meetingUrl,
    status: session.status,
    myAttendance: entry,
  });
});

// ─── Intern: kirdi (join) ─────────────────────────────────────────────────────
exports.join = catchAsync(async (req, res, next) => {
  const internId = req.user.id || req.user._id;
  const session = await MonthlyInterviewSession.findOne({ joinToken: req.params.token });
  if (!session) return next(new AppError("Sessiya topilmadi", 404));
  if (session.status === "finalized") {
    return next(new AppError("Sessiya yakunlangan", 400));
  }

  const entry = session.attendance.find((a) => String(a.intern) === String(internId));
  if (!entry) return next(new AppError("Siz bu sessiyaga tegishli emassiz", 403));

  const now = new Date();
  if (!entry.joinedAt) entry.joinedAt = now;
  entry.lastHeartbeatAt = now;
  entry.leftAt = null;
  await session.save();

  res.json({ success: true });
});

// ─── Intern: sahifa ochiq turgani (heartbeat) ─────────────────────────────────
exports.heartbeat = catchAsync(async (req, res, next) => {
  const internId = req.user.id || req.user._id;
  const session = await MonthlyInterviewSession.findOne({ joinToken: req.params.token });
  if (!session) return next(new AppError("Sessiya topilmadi", 404));

  const entry = session.attendance.find((a) => String(a.intern) === String(internId));
  if (!entry) return next(new AppError("Siz bu sessiyaga tegishli emassiz", 403));

  entry.lastHeartbeatAt = new Date();
  entry.leftAt = null;
  await session.save();

  res.json({ success: true });
});

// ─── Intern: kira olmasligi sababini yozadi (ixtiyoriy, join o'rniga) ────────
exports.excuse = catchAsync(async (req, res, next) => {
  const internId = req.user.id || req.user._id;
  const reason = (req.body.reason || "").trim();
  if (!reason) {
    return next(new AppError("Sababni kiriting", 400));
  }

  const session = await MonthlyInterviewSession.findOne({ joinToken: req.params.token });
  if (!session) return next(new AppError("Sessiya topilmadi", 404));
  if (session.status === "finalized") {
    return next(new AppError("Sessiya yakunlangan", 400));
  }

  const entry = session.attendance.find((a) => String(a.intern) === String(internId));
  if (!entry) return next(new AppError("Siz bu sessiyaga tegishli emassiz", 403));

  entry.excuseReason = reason;
  entry.excusedAt = new Date();
  await session.save();

  res.json({ success: true });
});

// ─── Intern: sahifani tark etdi ───────────────────────────────────────────────
exports.leave = catchAsync(async (req, res, next) => {
  const internId = req.user.id || req.user._id;
  const session = await MonthlyInterviewSession.findOne({ joinToken: req.params.token });
  if (!session) return res.json({ success: true }); // sendBeacon — jim javob

  const entry = session.attendance.find((a) => String(a.intern) === String(internId));
  if (entry) {
    entry.leftAt = new Date();
    await session.save();
  }

  res.json({ success: true });
});

// ─── Finalize: present/missed hisoblash + kirmaganlarga avtomatik yozuv ──────
// Boshqa joydan (cron) ham chaqiriladi — shuning uchun eksport qilingan.
async function finalizeSession(session) {
  const now = new Date();
  let missedCount = 0;
  let presentCount = 0;

  for (const entry of session.attendance) {
    const present =
      !!entry.joinedAt &&
      !entry.leftAt &&
      entry.lastHeartbeatAt &&
      now - entry.lastHeartbeatAt <= PRESENCE_TIMEOUT_MS;

    entry.result = present ? "present" : "missed";

    if (present) {
      presentCount += 1;
    } else {
      missedCount += 1;
      // Agar shu oy uchun allaqachon o'tkazilgan (passed/failed) yozuv bo'lsa —
      // ustidan yozmaymiz, faqat hali "pending" bo'lgan/mavjud bo'lmagan holatda
      // avtomatik "missed" yaratamiz.
      const existing = await MonthlyInterview.findOne({ intern: entry.intern, month: session.month });
      if (!existing || existing.status === "pending") {
        await MonthlyInterview.findOneAndUpdate(
          { intern: entry.intern, month: session.month },
          {
            $set: {
              branch: session.branch,
              headIntern: session.headIntern,
              status: "missed",
              attendance: "missed",
              session: session._id,
              resultNote: entry.excuseReason || "",
            },
            $setOnInsert: { questions: [], passedCount: 0, failedCount: 0, percentage: 0 },
          },
          { upsert: true, setDefaultsOnInsert: true }
        );
      }
    }
  }

  session.status = "finalized";
  session.finalizedAt = now;
  await session.save();

  if (missedCount > 0) {
    await sendNotificationToUser(
      session.headIntern,
      "intern",
      "⚠️ Oylik suhbat yakunlandi",
      `${missedCount} ta intern suhbatga kirmadi.`
    );
  }

  return { presentCount, missedCount };
}

exports.finalizeSession = finalizeSession;

// Cron uchun: muddati o'tgan, hali finalize qilinmagan sessiyalarni topib yakunlaydi.
exports.finalizeDueSessions = async () => {
  const cutoff = new Date(Date.now() - GRACE_MINUTES * 60 * 1000);
  const dueSessions = await MonthlyInterviewSession.find({
    status: "scheduled",
    scheduledAt: { $lte: cutoff },
  });

  let finalized = 0;
  for (const session of dueSessions) {
    await finalizeSession(session);
    finalized += 1;
  }
  return finalized;
};
