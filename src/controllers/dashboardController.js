const Lesson = require("../models/lessonModel");
const User = require("../models/internModel");
const grades = require("../config/grades");

const MAX_SCORE = 5;
const PROMOTION_THRESHOLD = 50;

exports.getDashboardStats = async (req, res) => {
    try {
        const userId = req.user.id;

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

        // ⚡ Параллельные запросы
        const [user, lessonsThisMonth] = await Promise.all([
            User.findById(userId).lean(),
            Lesson.countDocuments({
                intern: userId,
                createdAt: {
                    $gte: startOfMonth,
                    $lt: endOfMonth,
                },
            }),
        ]);

        if (!user) {
            return res.status(404).json({ message: "Пользователь не найден" });
        }

        const gradeKey = user.grade;
        const gradeConfig = grades[gradeKey];

        if (!gradeConfig) {
            return res.status(400).json({
                message: "Некорректный грейд пользователя",
            });
        }

        // --- Основные показатели ---
        const totalLessons =
            user.lessonsVisited?.reduce((sum, l) => sum + (l.count || 0), 0) || 0;

        const monthlyGoal = gradeConfig.lessonsPerMonth;
        const averageScore = user.score.toFixed(2) || 0;

        // --- Прогресс ---
        const lessonsProgress =
            monthlyGoal > 0
                ? Math.min((lessonsThisMonth / monthlyGoal) * 100, 100)
                : 0;

        const scoreProgress =
            averageScore > 0
                ? Math.min((averageScore / MAX_SCORE) * 100, 100)
                : 0;

        const overallProgress = Math.round(
            (lessonsProgress + scoreProgress) / 2
        );

        // --- Испытательный срок (динамический) ---
        const probationStartDate = user.gradeStartedAt || user.probationStartDate;
        let probation = null;

        if (probationStartDate) {
            const startDate = new Date(probationStartDate);

            const TRIAL_MONTHS = gradeConfig.trialPeriod;

            const endDate = new Date(startDate);
            endDate.setMonth(endDate.getMonth() + TRIAL_MONTHS);

            const nowMs = now.getTime();
            const endMs = endDate.getTime();

            const diffMs = endMs - nowMs;
            const daysLeft = Math.max(Math.ceil(diffMs / (1000 * 60 * 60 * 24)), 0);

            probation = {
                grade: gradeKey,
                trialMonths: TRIAL_MONTHS,
                probationStartAt: startDate,
                probationEndAt: endDate,
                daysLeft,
                isExpired: diffMs <= 0,
            };
        }

        // --- Готовность к повышению ---
        const autoPromotionEligible =
            overallProgress >= PROMOTION_THRESHOLD &&
            probation?.isExpired === true;

        return res.json({
            grade: gradeKey,
            lessonsThisMonth,
            totalLessons,
            monthlyGoal,
            averageScore,
            overallProgress,
            probation,
            autoPromotionEligible,
            perks: gradeConfig.plus,
        });
    } catch (err) {
        console.error("Dashboard stats error:", err);
        res.status(500).json({ message: "Ошибка получения статистики" });
    }
};
