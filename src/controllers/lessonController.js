const Lesson = require("../models/lessonModel.js");
const Intern = require("../models/internModel");
const grades = require("../config/grades.js");
const { sendNotificationToUser } = require("./notificationController.js");
const { getInternPlanStatus } = require("../utils/internPlanStatus");
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
            "Аккаунт ограничен: недельный план не выполнен. Основные функции временно недоступны.",
          planStatus,
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

    const lessons = await Lesson.find({ mentor: mentorId, isRated: false })
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
    console.log(interns);
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
      const dayOfWeek = now.getDay();
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      firstDay = new Date(now);
      firstDay.setDate(now.getDate() - daysToMonday);
      lastDay = new Date(firstDay);
      lastDay.setDate(firstDay.getDate() + 5);
    } else if (startDate && endDate) {
      firstDay = new Date(startDate);
      lastDay = new Date(endDate);
    }

    // 🔹 Получаем всех интернов и их уроки
    const interns = await Intern.find()
      .populate("branch", "name")
      .lean();

    const allLessons = await Lesson.find({
      date: { $gte: firstDay, $lte: lastDay },
    }).lean();

    // 🔹 Функция для подсчета дней между датами
    const daysBetween = (start, end) => {
      const diffTime = Math.abs(end - start);
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    };

    // 🔹 Обрабатываем каждого интерна
    const stats = interns.map((intern) => {
      // Определяем дату начала работы
      const startWorkDate = intern.probationStartDate || intern.createdAt;
      const daysWorking = daysBetween(startWorkDate, now);

      // Фильтруем уроки этого интерна за период
      const internLessons = allLessons.filter(
        (l) => l.intern.toString() === intern._id.toString()
      );

      // 🔹 Разделяем уроки на confirmed и pending
      // Старые уроки без status: isRated=true → confirmed, иначе → pending
      const confirmedLessons = internLessons.filter(
        (l) =>
          l.status === "confirmed" || (l.status === undefined && l.isRated)
      );

      const pendingLessons = internLessons.filter(
        (l) =>
          l.status === "pending" ||
          (l.status === undefined && !l.isRated)
      );

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
        gradeMap[intern.grade?.toLowerCase()?.replace(/\s/g, "")] || "junior";
      const gradeConfig = grades[gradeKey];

      if (!gradeConfig) {
        return {
          internId: intern._id,
          name: `${intern.name} ${intern.lastName}`,
          grade: intern.grade,
          branchId: intern.branch?._id,
          branch: intern.branch,
          confirmedCount: confirmedLessons.length,
          pendingCount: pendingLessons.length,
          attended: confirmedLessons.length,
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
        // Текущий месяц: норма = (дни_работы_в_месяце / 30) * lessonsPerMonth
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const effectiveStart =
          startWorkDate > monthStart ? startWorkDate : monthStart;
        const daysInMonth = daysBetween(effectiveStart, now);
        norm = Math.ceil((daysInMonth / 30) * gradeConfig.lessonsPerMonth);
      } else if (period === "month" && prevMonth === "true") {
        // Прошлый месяц: полная норма если работал весь месяц
        const prevMonthStart = firstDay;
        const prevMonthEnd = lastDay;
        if (startWorkDate <= prevMonthStart) {
          norm = gradeConfig.lessonsPerMonth;
        } else if (startWorkDate <= prevMonthEnd) {
          const daysInPrevMonth = daysBetween(startWorkDate, prevMonthEnd);
          norm = Math.ceil((daysInPrevMonth / 30) * gradeConfig.lessonsPerMonth);
        } else {
          norm = 0; // Еще не работал в прошлом месяце
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
      // ⚠️ Исправление: "близко к дедлайну" включает и тех, у кого срок истёк (отрицательное число)
      const nearDeadline = daysRemaining <= 7;
      const isOverdue = daysRemaining < 0;
      // 🎁 Бонусные уроки за период
      const bonusCount = (intern.bonusLessons || [])
        .filter((b) => b.date >= firstDay && b.date <= lastDay)
        .reduce((sum, b) => sum + (b.count || 0), 0);

      const effectiveConfirmedCount = confirmedLessons.length + bonusCount;
      const percentage = norm > 0 ? Math.round((effectiveConfirmedCount / norm) * 100) : 0;
      const canPromoteWithConcession = percentage >= 50 && percentage <= 60 && nearDeadline;

      return {
        internId: intern._id,
        name: `${intern.name} ${intern.lastName}`,
        grade: gradeKey,
        branchId: intern.branch?._id,
        branch: intern.branch,
        confirmedCount: effectiveConfirmedCount,
        confirmedLessonsCount: confirmedLessons.length,
        bonusCount: bonusCount,
        pendingCount: pendingLessons.length,
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

    res.json({ stats, grades });
  } catch (err) {
    console.error("Ошибка в getAttendanceStats:", err);
    res.status(500).json({ message: err.message });
  }
};
