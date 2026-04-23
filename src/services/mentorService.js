const Mentor = require("../models/mentorModel");
const Lesson = require("../models/lessonModel");
const AppError = require("../utils/AppError");

const ACTIVITY_WINDOW_DAYS = 30;

const startOfDay = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

const isSunday = (date) => new Date(date).getDay() === 0;

const countWorkingDaysInclusive = (from, to) => {
    const start = startOfDay(from);
    const end = startOfDay(to);
    if (start > end) return 0;
    let count = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
        if (!isSunday(cursor)) count += 1;
        cursor.setDate(cursor.getDate() + 1);
    }
    return count;
};

const computeActivity = ({ lessonList, monthlyNorm, totalWorkingDays }) => {
    const confirmed = lessonList.filter((l) => l.status === "confirmed").length;
    const total = lessonList.length;
    const norm = Math.max(Number(monthlyNorm) || 24, 1);

    const planCompletion = Math.min(confirmed / norm, 1);
    const feedbackRate = total > 0 ? confirmed / total : 0;
    const daysWithLesson = new Set(
        lessonList.map((l) => startOfDay(l.date).getTime())
    ).size;
    const attendanceRate =
        totalWorkingDays > 0 ? Math.min(daysWithLesson / totalWorkingDays, 1) : 0;

    const activity = planCompletion * 0.5 + feedbackRate * 0.25 + attendanceRate * 0.25;
    const percent = Math.round(activity * 100);
    const range =
        percent >= 80 ? "active" :
        percent >= 50 ? "onTrack" :
        percent >= 25 ? "behind" : "inactive";

    return {
        percent,
        range,
        planCompletion: Math.round(planCompletion * 100),
        feedbackRate: Math.round(feedbackRate * 100),
        attendanceRate: Math.round(attendanceRate * 100),
        lessonsConfirmed30d: confirmed,
        lessonsTotal30d: total,
        monthlyNorm: norm,
    };
};

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
        const monthFeedbacks = await Lesson.countDocuments({
            mentor: mentorId,
            date: { $gte: startOfMonth, $lte: endOfMonth },
            status: "confirmed",
        });

        // 3. Задолженность (все уроки, которые не оценены, не зависимо от месяца, так как долг висит)
        const pendingLessons = await Lesson.find({
            mentor: mentorId,
            status: "pending",
        })
            .populate("intern", "name lastName");

        // Формируем список должников для отображения
        const debtDetails = pendingLessons.map(l => ({
            lessonId: l._id,
            internName: l.intern ? `${l.intern.name} ${l.intern.lastName}` : "Unknown",
            date: l.date,
            topic: l.topic
        }));

        // 4. qualityScore — среднее internFeedback.score за последние 30 дней
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
        const feedbackLessons = await Lesson.find({
            mentor: mentorId,
            "internFeedback.submittedAt": { $gte: thirtyDaysAgo },
        }).select("internFeedback.score").lean();

        const qualityScore = feedbackLessons.length > 0
            ? +(feedbackLessons.reduce((s, l) => s + (l.internFeedback?.score || 0), 0) / feedbackLessons.length).toFixed(2)
            : null;

        return {
            monthLessons,
            monthFeedbacks,
            totalDebt: pendingLessons.length,
            debtDetails,
            qualityScore,
            qualityFeedbackCount: feedbackLessons.length,
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
                    branches: mentor.branches,
                    branch: mentor.branches?.[0] || null,
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

    async getMentorsWithActivity() {
        const Intern = require("../models/internModel");

        const now = new Date();
        const windowStart = new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * 24 * 3600 * 1000);
        const totalWorkingDays = countWorkingDaysInclusive(windowStart, now);

        const mentors = await Mentor.find({ role: { $ne: "admin" } })
            .select("name lastName branches role profilePhoto")
            .populate("branches", "name")
            .lean();

        const interns = await Intern.find({ "branches.0": { $exists: true } })
            .select("name lastName grade sphere lessonsPerMonth branches")
            .lean();

        const internIds = interns.map((i) => i._id);
        const lessons = internIds.length
            ? await Lesson.find({
                  intern: { $in: internIds },
                  date: { $gte: windowStart, $lte: now },
              })
                  .select("intern mentor date status")
                  .lean()
            : [];

        const lessonsByIntern = {};
        for (const l of lessons) {
            const k = String(l.intern);
            (lessonsByIntern[k] = lessonsByIntern[k] || []).push(l);
        }

        const internActivity = {};
        for (const intern of interns) {
            const list = lessonsByIntern[String(intern._id)] || [];
            internActivity[String(intern._id)] = computeActivity({
                lessonList: list,
                monthlyNorm: intern.lessonsPerMonth,
                totalWorkingDays,
            });
        }

        const mentorIndex = {};
        for (const intern of interns) {
            for (const b of intern.branches || []) {
                if (!b?.mentor) continue;
                const mId = String(b.mentor);
                (mentorIndex[mId] = mentorIndex[mId] || []).push(
                    internActivity[String(intern._id)]
                );
            }
        }

        const mentorIds = mentors.map((m) => m._id);
        const feedbackLessons = mentorIds.length
            ? await Lesson.find({
                  mentor: { $in: mentorIds },
                  "internFeedback.submittedAt": { $gte: windowStart },
              })
                  .select("mentor internFeedback.score")
                  .lean()
            : [];

        const qualityByMentor = {};
        for (const fl of feedbackLessons) {
            const k = String(fl.mentor);
            if (!qualityByMentor[k]) qualityByMentor[k] = { sum: 0, count: 0 };
            qualityByMentor[k].sum += fl.internFeedback?.score || 0;
            qualityByMentor[k].count += 1;
        }

        return mentors.map((m) => {
            const myInterns = mentorIndex[String(m._id)] || [];
            const totalInterns = myInterns.length;
            const averageActivity = totalInterns > 0
                ? Math.round(myInterns.reduce((s, i) => s + i.percent, 0) / totalInterns)
                : 0;
            const distribution = {
                active: myInterns.filter((i) => i.range === "active").length,
                onTrack: myInterns.filter((i) => i.range === "onTrack").length,
                behind: myInterns.filter((i) => i.range === "behind").length,
                inactive: myInterns.filter((i) => i.range === "inactive").length,
            };
            const q = qualityByMentor[String(m._id)];
            const qualityScore = q && q.count > 0
                ? +(q.sum / q.count).toFixed(2)
                : null;

            return {
                _id: m._id,
                name: m.name,
                lastName: m.lastName,
                profilePhoto: m.profilePhoto || "",
                branches: m.branches || [],
                role: m.role,
                totalInterns,
                averageActivity,
                distribution,
                qualityScore,
                qualityFeedbackCount: q?.count || 0,
            };
        });
    }

    async getInternsActivityForMentor(mentorId) {
        const Intern = require("../models/internModel");
        const mongoose = require("mongoose");

        if (!mongoose.Types.ObjectId.isValid(mentorId)) {
            throw new AppError("Invalid mentor ID", 400);
        }
        const mid = new mongoose.Types.ObjectId(mentorId);

        const now = new Date();
        const windowStart = new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * 24 * 3600 * 1000);
        const totalWorkingDays = countWorkingDaysInclusive(windowStart, now);

        const interns = await Intern.find({ "branches.mentor": mid })
            .select("name lastName username grade sphere profilePhoto lessonsPerMonth branches")
            .populate("branches.branch", "name")
            .lean();

        if (interns.length === 0) return [];

        const internIds = interns.map((i) => i._id);
        const lessons = await Lesson.find({
            intern: { $in: internIds },
            date: { $gte: windowStart, $lte: now },
        })
            .select("intern date status")
            .lean();

        const lessonsByIntern = {};
        for (const l of lessons) {
            const k = String(l.intern);
            (lessonsByIntern[k] = lessonsByIntern[k] || []).push(l);
        }

        const results = interns.map((intern) => {
            const list = lessonsByIntern[String(intern._id)] || [];
            const activity = computeActivity({
                lessonList: list,
                monthlyNorm: intern.lessonsPerMonth,
                totalWorkingDays,
            });
            const lastLessonDate = list.length > 0
                ? list.reduce(
                      (max, l) => (new Date(l.date) > max ? new Date(l.date) : max),
                      new Date(0)
                  )
                : null;
            const mentorBranch = (intern.branches || []).find(
                (b) => String(b.mentor) === String(mid)
            );
            return {
                internId: intern._id,
                name: intern.name,
                lastName: intern.lastName,
                username: intern.username,
                grade: intern.grade,
                sphere: intern.sphere,
                profilePhoto: intern.profilePhoto || "",
                branchName: mentorBranch?.branch?.name || null,
                activity: {
                    ...activity,
                    lastLessonDate,
                },
            };
        });

        return results.sort((a, b) => b.activity.percent - a.activity.percent);
    }
}

module.exports = new MentorService();
