const Lesson = require("../models/lessonModel.js");
const Intern = require("../models/internModel");
const LessonCriteria = require("../models/lessonCriteriaModel");
const grades = require("../config/grades.js");
const GradeConfig = require("../models/gradeConfigModel");
const { sendNotificationToUser } = require("./notificationController.js");
const { getInternPlanStatus } = require("../utils/internPlanStatus");

// Only lessons younger than this window force an intern to leave feedback.
// Anything older is grandfathered: it still appears on the admin "stuck
// feedbacks" page, but it does NOT block the intern from adding new
// lessons and it does NOT auto-open the feedback modal.
const FEEDBACK_REQUIRED_WINDOW_MS = 48 * 60 * 60 * 1000;
const feedbackWindowStart = () =>
  new Date(Date.now() - FEEDBACK_REQUIRED_WINDOW_MS);
// Создать урок
exports.createLesson = async (req, res) => {
  try {
    const payload = { ...req.body };

    if (req.user?.role === "intern") {
      payload.intern = req.user.id;
      const intern = await Intern.findById(req.user.id);
      if (!intern) {
        return res.status(404).json({ message: "Стажёр не найден" });
      }
      const planStatus = await getInternPlanStatus(intern);
      if (planStatus.isPlanBlocked) {
        return res.status(403).json({
          message:
            "Аккаунт ограничен: план к текущей дате не выполнен. Основные функции временно недоступны.",
          planStatus,
        });
      }

      // Block adding a new lesson only if the intern has a RECENT pending
      // feedback. Older lessons are grandfathered to avoid an endless
      // modal cascade when an intern has a historical backlog of unrated
      // lessons from before the feedback feature shipped or from a time
      // when the submission path was broken.
      const pendingFeedback = await Lesson.findOne({
        intern: req.user.id,
        "internFeedback.submittedAt": { $exists: false },
        createdAt: { $gte: feedbackWindowStart() },
      })
        .sort({ createdAt: -1 })
        .lean();

      if (pendingFeedback) {
        return res.status(409).json({
          message: "Аввалги дарсни баҳолаб юборинг",
          pendingFeedbackLessonId: pendingFeedback._id,
        });
      }
    }

    // Prevent duplicate lessons: same intern + mentor + date
    if (payload.intern && payload.mentor && payload.date) {
      const dayStart = new Date(payload.date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(payload.date);
      dayEnd.setHours(23, 59, 59, 999);

      const existing = await Lesson.findOne({
        intern: payload.intern,
        mentor: payload.mentor,
        date: { $gte: dayStart, $lte: dayEnd },
      });

      if (existing) {
        return res.status(409).json({
          message: "Урок с этим ментором на эту дату уже существует.",
        });
      }
    }

    const lesson = await Lesson.create(payload);

    // После создания урока — обновляем посещения интерна
    if (lesson.intern) {
      const intern = await Intern.findById(lesson.intern);

      if (intern) {
        const existing = intern.lessonsVisited.find(
          (lv) =>
            lv.lessonId.toString() === lesson._id.toString() &&
            lv.mentorId.toString() === lesson.mentor.toString()
        );
        if (existing) {
          existing.count += 1;
        } else {
          intern.lessonsVisited.push({
            mentorId: lesson.mentor,
            lessonId: lesson._id,
            count: 1,
            date: lesson.date,
          });
        }

        await intern.save();

        // ✅ Отправляем уведомление ментору
        await sendNotificationToUser(
          lesson.mentor, // ID ментора
          "mentor", // тип пользователя
          "🧑‍🎓 Новый урок добавлен", // заголовок
          `Интерн ${intern.name} ${intern.lastName || ""} добавил урок с вами.` // текст уведомления
        );
      }
    }

    res.status(201).json(lesson);
  } catch (err) {
    console.error("Ошибка при создании урока:", err);
    res.status(400).json({ message: err.message });
  }
};

// Получить все уроки
exports.getLessons = async (req, res) => {
  try {
    const lessons = await Lesson.find()
      .populate("intern", "name lastName")
      .populate("mentor", "name lastName");
    res.json(lessons);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Получить урок по ID
exports.getLessonById = async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id)
      .populate("intern", "name lastName")
      .populate("mentor", "name lastName");

    if (!lesson) return res.status(404).json({ message: "Lesson not found" });

    res.json(lesson);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Получить список интернов, которых нужно оценить
exports.getPendingLessons = async (req, res) => {
  try {
    const mentorId = req.user.id || req.user._id; // Fix: use id instead of mentorId

    const lessons = await Lesson.find({ mentor: mentorId, status: "pending" })
      .populate(
        "intern",
        "name lastName username branch grade score lessonsVisited feedbacks"
      )
      .sort({ createdAt: -1 });

    const interns = lessons
      .filter((l) => l.intern) // ✅ защищает от populate(null)
      .map((l) => ({
        ...l.intern.toObject(),
        lessonId: l._id,
        topic: l.topic,
        time: l.time,
        date: l.date,
        group: l.group,
      }));
    res.json(interns);
  } catch (error) {
    res.status(500).json({ message: "Ошибка при получении уроков" });
  }
};

// Обновить урок
exports.updateLesson = async (req, res) => {
  try {
    const lesson = await Lesson.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!lesson) return res.status(404).json({ message: "Lesson not found" });
    res.json(lesson);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// Удалить урок
exports.deleteLesson = async (req, res) => {
  try {
    const lesson = await Lesson.findByIdAndDelete(req.params.id);
    if (!lesson) return res.status(404).json({ message: "Lesson not found" });
    res.json({ message: "Lesson deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/lessons/pending-feedback — returns the oldest lesson of the current
// intern that still has no internFeedback submitted. Used by the frontend to
// self-heal when localStorage lost track of a pending feedback.
exports.getPendingFeedback = async (req, res) => {
  try {
    if (req.user?.role !== "intern") {
      return res.status(403).json({ message: "Только для интернов" });
    }
    const lesson = await Lesson.findOne({
      intern: req.user.id,
      "internFeedback.submittedAt": { $exists: false },
      createdAt: { $gte: feedbackWindowStart() },
    })
      .sort({ createdAt: 1 })
      .select("_id mentor topic date")
      .lean();
    if (!lesson) return res.json({ pending: null });
    return res.json({ pending: lesson });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/lessons/stuck-feedbacks — admin view of every lesson still
// awaiting intern feedback. Used by the admin "Застрявшие фидбеки" page
// to spot and unblock stuck interns.
exports.getStuckFeedbacks = async (req, res) => {
  try {
    const lessons = await Lesson.find({
      "internFeedback.submittedAt": { $exists: false },
    })
      .populate("intern", "name lastName")
      .populate("mentor", "name lastName")
      .sort({ createdAt: 1 })
      .lean();
    res.json(lessons);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/lessons/:id/force-feedback — admin unblocks a stuck intern by
// stamping internFeedback.submittedAt so the lesson no longer appears in
// /lessons/pending-feedback. Used when the intern is unable to submit via
// the normal flow (broken criteria catalog, deleted lesson metadata, etc).
exports.forceCloseInternFeedback = async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) return res.status(404).json({ message: "Урок не найден" });

    if (lesson.internFeedback?.submittedAt) {
      return res.json({ message: "Фидбек уже был закрыт", lesson });
    }

    lesson.internFeedback = {
      criteria: [],
      score: 5,
      comment: `admin-force-closed by ${req.user?.name || req.user?.id}${req.body?.note ? `: ${String(req.body.note).slice(0, 200)}` : ""}`,
      submittedAt: new Date(),
    };

    await lesson.save();
    res.json({ message: "Фидбек принудительно закрыт", lesson });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PATCH /api/lessons/:id/intern-feedback — intern submits feedback on their lesson
exports.submitInternFeedback = async (req, res) => {
  try {
    const { criteria: criteriaIds, comment = "" } = req.body;

    if (!Array.isArray(criteriaIds)) {
      return res.status(400).json({ message: "criteria должен быть массивом" });
    }

    const trimmedComment = String(comment).trim();
    if (criteriaIds.length === 0 && trimmedComment.length === 0) {
      return res.status(400).json({
        message: "Нужно выбрать хотя бы один критерий или написать комментарий",
      });
    }

    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) {
      return res.status(404).json({ message: "Урок не найден" });
    }

    if (lesson.intern.toString() !== req.user.id) {
      return res.status(403).json({ message: "Нет доступа к этому уроку" });
    }

    if (lesson.internFeedback?.submittedAt) {
      return res.status(409).json({ message: "Фидбек уже отправлен" });
    }

    const criteriaList = await LessonCriteria.find({
      _id: { $in: criteriaIds },
      isActive: true,
    }).lean();

    let score = 5;
    let positiveCount = 0;
    for (const c of criteriaList) {
      if (c.type === "negative") score -= c.weight;
      else if (c.type === "positive") positiveCount += 1;
    }
    score += 0.5 * positiveCount;
    score = Math.max(0, Math.min(5, score));

    lesson.internFeedback = {
      criteria: criteriaList.map((c) => c._id),
      score,
      comment: trimmedComment.slice(0, 500),
      submittedAt: new Date(),
    };

    await lesson.save();
    res.json(lesson);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getAttendanceStats = async (req, res) => {
  try {
    const { period = "month", startDate, endDate, prevMonth } = req.query;
    const now = new Date();

    // 🔹 Определяем диапазон дат для фильтрации уроков
    let firstDay, lastDay;

    if (period === "month") {
      if (prevMonth === "true") {
        firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      } else {
        firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      }
    } else if (period === "week") {
      // Monday through Sunday, inclusive. Sunday is a non-working day in the
      // plan logic but should still appear in week-scoped stats, otherwise
      // Sunday lessons are silently dropped from the report.
      const dayOfWeek = now.getDay();
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      firstDay = new Date(now);
      firstDay.setDate(now.getDate() - daysToMonday);
      lastDay = new Date(firstDay);
      lastDay.setDate(firstDay.getDate() + 6);
    } else if (startDate && endDate) {
      firstDay = new Date(startDate);
      lastDay = new Date(endDate);
    }

    // 🔹 Параллельно грузим интернов, уроки (агрегация) и конфиги грейдов
    const [interns, lessonAgg, gradeConfigsFromDB] = await Promise.all([
      Intern.find()
        .select("name lastName grade branches probationStartDate createdAt isHeadIntern bonusLessons")
        .populate("branches.branch", "name")
        .lean(),

      // Считаем уроки прямо в MongoDB — не грузим все документы в JS
      Lesson.aggregate([
        { $match: { date: { $gte: firstDay, $lte: lastDay } } },
        {
          $group: {
            _id: { intern: "$intern", status: "$status" },
            count: { $sum: 1 },
          },
        },
      ]),

      // Конфиги грейдов из БД (с фолбэком на grades.js ниже)
      GradeConfig.find().lean(),
    ]);

    // Строим карту: grade → config (DB первичен, grades.js как фолбэк)
    const gradeConfigMap = { ...grades };
    gradeConfigsFromDB.forEach((cfg) => {
      gradeConfigMap[cfg.grade] = cfg;
    });

    // Карта: internId → { confirmed, pending }
    const lessonMap = {};
    lessonAgg.forEach(({ _id, count }) => {
      const id = _id.intern.toString();
      if (!lessonMap[id]) lessonMap[id] = { confirmed: 0, pending: 0 };
      if (_id.status === "confirmed") lessonMap[id].confirmed = count;
      if (_id.status === "pending") lessonMap[id].pending = count;
    });

    // 🔹 Функция для подсчета дней между датами
    const daysBetween = (start, end) => {
      const diffTime = Math.abs(end - start);
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    };

    // 🔹 Обрабатываем каждого интерна
    const stats = interns.map((intern) => {
      const internId = intern._id.toString();
      const startWorkDate = intern.probationStartDate || intern.createdAt;
      const daysWorking = daysBetween(startWorkDate, now);

      const confirmedLessonsCount = lessonMap[internId]?.confirmed || 0;
      const pendingLessonsCount = lessonMap[internId]?.pending || 0;

      // 🔹 Получаем конфиг грейда
      const gradeMap = {
        junior: "junior",
        "strong-junior": "strongJunior",
        strongjunior: "strongJunior",
        middle: "middle",
        "strong-middle": "strongMiddle",
        strongmiddle: "strongMiddle",
        senior: "senior",
      };

      const gradeKey =
        gradeMap[intern.grade?.toLowerCase()?.replace(/\s/g, "")] || intern.grade || "junior";
      const gradeConfig = gradeConfigMap[gradeKey];

      if (!gradeConfig) {
        return {
          internId: intern._id,
          name: `${intern.name} ${intern.lastName}`,
          grade: intern.grade,
          branchId: intern.branches?.[0]?.branch?._id,
          branch: intern.branches?.[0]?.branch || null,
          branches: intern.branches,
          confirmedCount: confirmedLessonsCount,
          pendingCount: pendingLessonsCount,
          attended: confirmedLessonsCount,
          daysWorking: daysWorking,
          norm: null,
          percentage: null,
          meetsNorm: null,
          createdAt: intern.createdAt,
        };
      }

      // 🔹 Расчет нормы на основе дней работы
      let norm;

      if (period === "month" && !prevMonth) {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const effectiveStart = startWorkDate > monthStart ? startWorkDate : monthStart;
        const daysInMonth = daysBetween(effectiveStart, now);
        norm = Math.ceil((daysInMonth / 30) * gradeConfig.lessonsPerMonth);
      } else if (period === "month" && prevMonth === "true") {
        const prevMonthStart = firstDay;
        const prevMonthEnd = lastDay;
        if (startWorkDate <= prevMonthStart) {
          norm = gradeConfig.lessonsPerMonth;
        } else if (startWorkDate <= prevMonthEnd) {
          const daysInPrevMonth = daysBetween(startWorkDate, prevMonthEnd);
          norm = Math.ceil((daysInPrevMonth / 30) * gradeConfig.lessonsPerMonth);
        } else {
          norm = 0;
        }
      } else if (period === "week") {
        norm = Math.round(gradeConfig.lessonsPerMonth / 4);
      } else if (startDate && endDate) {
        const periodDays = daysBetween(firstDay, lastDay);
        norm = Math.ceil((periodDays / 30) * gradeConfig.lessonsPerMonth);
      }

      norm = Math.max(norm, 0);

      // 🔹 Расчет испытательного периода и дедлайнов
      const trialPeriodDays = gradeConfig.trialPeriod * 30;
      const daysRemaining = trialPeriodDays - daysWorking;
      const nearDeadline = daysRemaining <= 7;
      const isOverdue = daysRemaining < 0;

      // 🎁 Бонусные уроки за период — явное преобразование в Date
      const bonusCount = (intern.bonusLessons || [])
        .filter((b) => {
          const d = b.date ? new Date(b.date) : null;
          return d && !isNaN(d) && d >= firstDay && d <= lastDay;
        })
        .reduce((sum, b) => sum + (b.count || 0), 0);

      const effectiveConfirmedCount = confirmedLessonsCount + bonusCount;
      const percentage = norm > 0 ? Math.round((effectiveConfirmedCount / norm) * 100) : 0;
      const canPromoteWithConcession = percentage >= 50 && percentage <= 60 && nearDeadline;

      return {
        internId: intern._id,
        name: `${intern.name} ${intern.lastName}`,
        grade: gradeKey,
        branchId: intern.branches?.[0]?.branch?._id,
        branch: intern.branches?.[0]?.branch || null,
        branches: intern.branches,
        confirmedCount: effectiveConfirmedCount,
        confirmedLessonsCount: confirmedLessonsCount,
        bonusCount: bonusCount,
        pendingCount: pendingLessonsCount,
        attended: effectiveConfirmedCount,
        daysWorking: daysWorking,
        norm: norm,
        percentage: percentage,
        meetsNorm: norm > 0 ? effectiveConfirmedCount >= norm : null,
        createdAt: intern.createdAt,
        trialPeriodDays: trialPeriodDays,
        daysRemaining: daysRemaining,
        nearDeadline: nearDeadline,
        isOverdue: isOverdue,
        canPromoteWithConcession: canPromoteWithConcession,
        isHeadIntern: intern.isHeadIntern || false,
      };
    });

    // Сортируем по проценту выполнения (по убыванию)
    stats.sort((a, b) => (b.percentage || 0) - (a.percentage || 0));

    res.json({ stats, grades: gradeConfigMap });
  } catch (err) {
    console.error("Ошибка в getAttendanceStats:", err);
    res.status(500).json({ message: err.message });
  }
};
