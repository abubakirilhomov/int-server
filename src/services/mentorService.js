const Mentor = require("../models/mentorModel");
const Lesson = require("../models/lessonModel");
const AppError = require("../utils/AppError");

class MentorService {
    async getMentorStats(mentorId) {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        // 1. Количество уроков за текущий месяц
        const monthLessons = await Lesson.countDocuments({
            mentor: mentorId,
            date: { $gte: startOfMonth, $lte: endOfMonth },
        });

        // 2. Количество оставленных фидбэков за месяц
        // Фидбэк считается оставленным, если урок имеет статус "confirmed" и isRated: true
        const monthFeedbacks = await Lesson.countDocuments({
            mentor: mentorId,
            date: { $gte: startOfMonth, $lte: endOfMonth },
            status: "confirmed",
            isRated: true,
        });

        // 3. Задолженность (все уроки, которые не оценены, не зависимо от месяца, так как долг висит)
        const pendingLessons = await Lesson.find({
            mentor: mentorId,
            status: "pending", // или isRated: false
        })
            .populate("intern", "name lastName");

        // Формируем список должников для отображения
        const debtDetails = pendingLessons.map(l => ({
            lessonId: l._id,
            internName: l.intern ? `${l.intern.name} ${l.intern.lastName}` : "Unknown",
            date: l.date,
            topic: l.topic
        }));

        return {
            monthLessons,
            monthFeedbacks,
            totalDebt: pendingLessons.length,
            debtDetails
        };
    }

    async getAllMentorsWithDebt() {
        const Mentor = require("../models/mentorModel");
        const Lesson = require("../models/lessonModel");

        // Get all mentors
        const mentors = await Mentor.find().select("name lastName branch");

        // Calculate debt for each mentor
        const mentorsWithDebt = await Promise.all(
            mentors.map(async (mentor) => {
                const debtCount = await Lesson.countDocuments({
                    mentor: mentor._id,
                    status: "pending"
                });

                return {
                    _id: mentor._id,
                    name: mentor.name,
                    lastName: mentor.lastName,
                    branch: mentor.branch,
                    totalDebt: debtCount
                };
            })
        );

        // Sort by debt (highest first) and filter out mentors with 0 debt
        const sorted = mentorsWithDebt
            .filter(m => m.totalDebt > 0)
            .sort((a, b) => b.totalDebt - a.totalDebt);

        return sorted;
    }

    async getMentorDebtDetails(mentorId) {
        const Lesson = require("../models/lessonModel");

        const pendingLessons = await Lesson.find({
            mentor: mentorId,
            status: "pending"
        })
            .populate("intern", "name lastName grade")
            .sort({ date: -1 });

        return pendingLessons.map(lesson => ({
            lessonId: lesson._id,
            intern: {
                _id: lesson.intern._id,
                name: lesson.intern.name,
                lastName: lesson.intern.lastName,
                grade: lesson.intern.grade
            },
            topic: lesson.topic,
            date: lesson.date,
            time: lesson.time,
            group: lesson.group
        }));
    }
}

module.exports = new MentorService();
