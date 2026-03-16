const Lesson = require("../models/lessonModel");
const User = require("../models/internModel");
const grades = require("../config/grades");
const { getInternPlanStatus } = require("../utils/internPlanStatus");

const MAX_SCORE = 5;
const PROMOTION_THRESHOLD = 50;

exports.getDashboardStats = async (req, res) => {
    try {
        const userId = req.user.id;

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

        // 1. Fetch User
        const user = await User.findById(userId).lean();
        if (!user) {
            return res.status(404).json({ message: "Пользователь не найден" });
        }

        const gradeKey = user.grade;
        const gradeConfig = grades[gradeKey];

        if (!gradeConfig) {
            return res.status(400).json({ message: "Некорректный грейд пользователя" });
        }

        const bonusLessons = Array.isArray(user.bonusLessons) ? user.bonusLessons : [];

        // 2. Dates for Trial Period
        const probationStartDate = user.probationStartDate || user.createdAt;
        const startDate = new Date(probationStartDate);

        // 3. Parallel Queries
        const [
            monthLessonsData,
            trialLessonsData,
            monthlyHistoryData,
            recentLessonsData
        ] = await Promise.all([
            // A. Current Month (for existing logic)
            Lesson.find({
                intern: userId,
                createdAt: { $gte: startOfMonth, $lt: endOfMonth },
            }).lean(),

            // B. Entire Trial Period (New Request)
            Lesson.find({
                intern: userId,
                createdAt: { $gte: startDate },
            }).lean(),

            // C. Monthly History (Aggregation)
            Lesson.aggregate([
                {
                    $match: {
                        intern: user._id,
                        $or: [{ status: "confirmed" }, { status: undefined, isRated: true }]
                    }
                },
                {
                    $group: {
                        _id: {
                            year: { $year: "$createdAt" },
                            month: { $month: "$createdAt" }
                        },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { "_id.year": -1, "_id.month": -1 } },
                { $limit: 6 }
            ]),

            // D. Recent Lessons
            Lesson.find({ intern: userId })
                .sort({ createdAt: -1 })
                .limit(5)
                .populate('mentor', 'name lastName') // Populate for potential usage (filtering later)
                .lean()
        ]);

        // --- Process Current Month ---
        const lessonsConfirmedRaw = monthLessonsData.filter(l =>
            l.status === "confirmed" || (l.status === undefined && l.isRated)
        ).length;
        const lessonsPending = monthLessonsData.filter(l =>
            l.status === "pending" || (l.status === undefined && !l.isRated)
        ).length;

        const bonusThisMonth = bonusLessons.reduce((sum, bonus) => {
            const bonusDate = bonus?.date ? new Date(bonus.date) : null;
            if (!bonusDate || Number.isNaN(bonusDate.getTime())) return sum;
            if (bonusDate >= startOfMonth && bonusDate < endOfMonth) {
                return sum + (bonus.count || 0);
            }
            return sum;
        }, 0);

        const lessonsConfirmed = lessonsConfirmedRaw + bonusThisMonth;

        // Calculate total lessons visited (historical total)
        const totalLessonsRaw = user.lessonsVisited?.reduce((sum, l) => sum + (l.count || 0), 0) || 0;
        const totalBonusLessons = bonusLessons.reduce((sum, bonus) => sum + (bonus.count || 0), 0);
        const totalLessons = totalLessonsRaw + totalBonusLessons;


        // --- Process Trial Period ---
        const trialLessonsConfirmedRaw = trialLessonsData.filter(l =>
            l.status === "confirmed" || (l.status === undefined && l.isRated)
        ).length;
        const trialBonusLessons = bonusLessons.reduce((sum, bonus) => {
            const bonusDate = bonus?.date ? new Date(bonus.date) : null;
            if (!bonusDate || Number.isNaN(bonusDate.getTime())) return sum;
            if (bonusDate >= startDate) {
                return sum + (bonus.count || 0);
            }
            return sum;
        }, 0);
        const trialLessonsConfirmed = trialLessonsConfirmedRaw + trialBonusLessons;

        const trialTotalGoal = gradeConfig.lessonsPerMonth * gradeConfig.trialPeriod;

        // Days Calculations
        const daysWorking = Math.ceil((now - startDate) / (1000 * 60 * 60 * 24));
        const trialPeriodDays = gradeConfig.trialPeriod * 30;
        const daysRemaining = Math.max(trialPeriodDays - daysWorking, 0);

        // Adjusted Monthly Goal (Kept for compatibility)
        const monthlyGoal = gradeConfig.lessonsPerMonth;
        const daysInMonth = Math.min(daysWorking, 30);
        const adjustedMonthlyGoal = Math.ceil((daysInMonth / 30) * gradeConfig.lessonsPerMonth);

        // --- Notification Flags ---
        const percentage = adjustedMonthlyGoal > 0
            ? Math.round((lessonsConfirmed / adjustedMonthlyGoal) * 100)
            : 0;

        // --- Average Score ---
        const averageScore = user.score.toFixed(2) || 0;
        const planStatus = await getInternPlanStatus(user, now);

        // --- Probation Object ---
        let probation = null;
        if (probationStartDate) {
            const TRIAL_MONTHS = gradeConfig.trialPeriod;
            const endDate = new Date(startDate);
            endDate.setMonth(endDate.getMonth() + TRIAL_MONTHS);
            const diffMs = endDate.getTime() - now.getTime();

            probation = {
                grade: gradeKey,
                trialMonths: TRIAL_MONTHS,
                probationStartAt: startDate,
                probationEndAt: endDate,
                daysLeft: Math.max(Math.ceil(diffMs / (1000 * 60 * 60 * 24)), 0),
                isExpired: diffMs <= 0,
            };
        }

        // --- Recent Reviews (Anonymized) ---
        // Using user.feedbacks if available, OR extracting feedback from Recent Lessons if stored there.
        // The user request said "recent reviews... hidden from which mentor". 
        // Assuming user.feedbacks is the source.
        const recentReviews = (user.feedbacks || [])
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 5)
            .map(review => ({
                ...review,
                mentorId: undefined,
                mentorName: "Анонимный ментор"
            }));

        // --- Format Monthly History ---
        const monthlyHistoryMap = new Map();
        monthlyHistoryData.forEach((item) => {
            const key = `${item._id.year}-${String(item._id.month).padStart(2, "0")}`;
            monthlyHistoryMap.set(key, (monthlyHistoryMap.get(key) || 0) + item.count);
        });

        bonusLessons.forEach((bonus) => {
            const bonusDate = bonus?.date ? new Date(bonus.date) : null;
            if (!bonusDate || Number.isNaN(bonusDate.getTime())) return;
            const year = bonusDate.getFullYear();
            const month = bonusDate.getMonth() + 1;
            const key = `${year}-${String(month).padStart(2, "0")}`;
            monthlyHistoryMap.set(key, (monthlyHistoryMap.get(key) || 0) + (bonus.count || 0));
        });

        const monthlyHistory = Array.from(monthlyHistoryMap.entries())
            .map(([key, count]) => {
                const [yearStr, monthStr] = key.split("-");
                return {
                    year: Number(yearStr),
                    month: Number(monthStr),
                    count,
                };
            })
            .sort((a, b) => {
                if (a.year !== b.year) return b.year - a.year;
                return b.month - a.month;
            })
            .slice(0, 6)
            .reverse()
            .map((item) => {
                const date = new Date(item.year, item.month - 1);
                return {
                    monthName: date.toLocaleString("ru-RU", { month: "short" }),
                    fullDate: date,
                    year: item.year,
                    count: item.count,
                };
            });

        // --- Overall Progress for Compatibility ---
        const lessonsProgress = adjustedMonthlyGoal > 0 ? Math.min((lessonsConfirmed / adjustedMonthlyGoal) * 100, 100) : 0;
        const scoreProgress = averageScore > 0 ? Math.min((averageScore / MAX_SCORE) * 100, 100) : 0;
        const overallProgress = Math.round((lessonsProgress + scoreProgress) / 2);

        const autoPromotionEligible = overallProgress >= PROMOTION_THRESHOLD && probation?.isExpired === true;


        return res.json({
            grade: gradeKey,
            lessonsThisMonth: lessonsConfirmed,
            lessonsConfirmed,
            lessonsPending,
            totalLessons,
            monthlyGoal,
            adjustedMonthlyGoal,
            averageScore,
            overallProgress,
            probation,
            autoPromotionEligible,
            perks: gradeConfig.plus,

            daysWorking,
            trialPeriodDays,
            daysRemaining,
            percentage,
            nearDeadline: daysRemaining <= 7 && daysRemaining > 0,
            canGetConcession: percentage >= 50 && percentage <= 60 && daysRemaining <= 7,

            // 🆕 New Data
            trialStats: {
                totalLessons: trialLessonsConfirmed,
                targetLessons: trialTotalGoal,
                progressPercentage: trialTotalGoal > 0 ? Math.round((trialLessonsConfirmed / trialTotalGoal) * 100) : 0
            },
            history: monthlyHistory,
            recentLessons: recentLessonsData,
            recentReviews: recentReviews,
            planStatus,
        });

    } catch (err) {
        console.error("Dashboard stats error:", err);
        res.status(500).json({ message: "Ошибка получения статистики" });
    }
};
