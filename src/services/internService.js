const Intern = require("../models/internModel");
const Branch = require("../models/branchModel");
const Mentor = require("../models/mentorModel");
const Lesson = require("../models/lessonModel");
const grades = require("../config/grades");
const AppError = require("../utils/AppError");
const bcrypt = require("bcrypt");
const { getInternPlanStatus } = require("../utils/internPlanStatus");

class InternService {
    async createIntern(data) {
        const {
            name,
            lastName,
            username,
            password,
            phoneNumber,
            telegram,
            sphere,
            profilePhoto,
            branch,
            mentor,
            grade,
            dateJoined,
            lessonsVisitedFake,
        } = data;

        const branchExists = await Branch.findById(branch);
        if (!branchExists) {
            throw new AppError("Указанный филиал не найден", 400);
        }

        const mentorExists = await Mentor.findById(mentor);
        if (!mentorExists) {
            throw new AppError("Указанный ментор не найден", 400);
        }

        const existingUser = await Intern.findOne({ username });
        if (existingUser) {
            throw new AppError("Имя пользователя уже существует", 400);
        }

        const normalizedGrade = (grade || "junior").toString().trim();
        if (!grades[normalizedGrade]) {
            throw new AppError(`Недопустимый уровень: ${normalizedGrade}`, 400);
        }

        const joinedDate = dateJoined ? new Date(dateJoined) : new Date();
        const gradeConfig = grades[normalizedGrade];

        const intern = await Intern.create({
            name,
            lastName,
            username,
            password,
            phoneNumber: phoneNumber || "",
            telegram: telegram || "",
            sphere: sphere || "backend-nodejs",
            profilePhoto: profilePhoto || "",
            branch,
            mentor,
            score: 0,
            feedbacks: [],
            lessonsVisited: [],
            grade: normalizedGrade,
            mentorsEvaluated: {},
            dateJoined: joinedDate,
            probationPeriod: gradeConfig.trialPeriod,
            lessonsPerMonth: gradeConfig.lessonsPerMonth,
            pluses: gradeConfig.plus,
        });

        if (lessonsVisitedFake && lessonsVisitedFake > 0) {
            const placeholderLessons = Array.from(
                { length: lessonsVisitedFake },
                (_, i) => ({
                    intern: intern._id,
                    mentor,
                    topic: "Placeholder",
                    time: "00:00",
                    date: new Date(joinedDate.getTime() - (i + 1) * 86400000),
                    group: "Legacy",
                    feedback: "👍",
                })
            );

            const createdLessons = await Lesson.insertMany(placeholderLessons);

            createdLessons.forEach((lesson) => {
                intern.lessonsVisited.push({
                    mentorId: mentor,
                    lessonId: lesson._id,
                    count: 1,
                });
            });

            await intern.save();
        }

        return intern;
    }

    async getRatings() {
        const interns = await Intern.find()
            .populate("branch", "name")
            .populate("mentor", "name");

        const internRatings = interns.map((intern) => {
            const feedbacks = intern.feedbacks || [];
            const lessons = intern.lessonsVisited || [];

            const feedbackCount = feedbacks.length;
            const lessonCount = lessons.length || 1;

            const averageStars =
                feedbacks.reduce((sum, f) => sum + (f.stars || 0), 0) /
                (feedbackCount || 1);

            const activityRate = Math.min(feedbackCount / lessonCount, 1);
            const attendanceFactor = Math.log(lessonCount + 1) / Math.log(30 + 1);

            const planCompletion = Math.min(
                lessonCount / (intern.lessonsPerMonth || 24),
                1
            );

            const ratingScore =
                averageStars * 0.5 +
                activityRate * 5 * 0.2 +
                planCompletion * 5 * 0.2 +
                attendanceFactor * 5 * 0.1;

            return {
                internId: intern._id,
                name: `${intern.name} ${intern.lastName}`,
                branch: intern.branch?.name || "No branch",
                grade: intern.grade,
                averageStars: +averageStars.toFixed(2),
                activityRate: +activityRate.toFixed(2),
                planCompletion: +(planCompletion * 100).toFixed(1), // в %
                lessons: lessonCount,
                feedbacks: feedbackCount,
                ratingScore: +ratingScore.toFixed(2),
            };
        });

        internRatings.sort((a, b) => b.ratingScore - a.ratingScore);

        // Рейтинг филиалов
        const branchMap = {};
        for (const i of internRatings) {
            if (!branchMap[i.branch]) branchMap[i.branch] = [];
            branchMap[i.branch].push(i.ratingScore);
        }

        const branchRatings = Object.entries(branchMap)
            .map(([branch, scores]) => ({
                branch,
                average: +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(
                    2
                ),
                internsCount: scores.length,
            }))
            .sort((a, b) => b.average - a.average);


        return {
            success: true,
            interns: internRatings,
            branches: branchRatings,
        };
    }

    async getInternProfile(user, id) {
        let intern;

        // 🔹 Если админ и указан ID → можно смотреть чужой профиль
        if (user?.role === "admin" && id) {
            intern = await Intern.findById(id)
                .populate("branch", "name")
                .populate("mentor", "name lastName");
        } else {
            const internId = user?._id || id;
            if (!internId) {
                throw new AppError("Нет доступа", 403);
            }

            intern = await Intern.findById(internId)
                .populate("branch", "name")
                .populate("mentor", "name lastName");
        }

        if (!intern) throw new AppError("Стажёр не найден", 404);

        // 🔹 Инфо о грейде
        const gradeConfig = grades[intern.grade] || null;
        const goal = gradeConfig ? gradeConfig.lessonsPerMonth : null;

        // 🔹 createdAt в ташкентском времени
        const createdAtLocal = new Intl.DateTimeFormat("ru-RU", {
            timeZone: "Asia/Tashkent",
            dateStyle: "short",
            timeStyle: "medium",
        }).format(intern.createdAt);

        // 🔹 Расчёт даты окончания испытательного срока
        const probationStart = intern.probationStartDate || intern.createdAt;
        const probationEnd = new Date(probationStart);
        probationEnd.setMonth(
            probationEnd.getMonth() + (intern.probationPeriod || 1)
        );

        // 🔹 Локальное отображение (Ташкент)
        const probationEndLocal = new Intl.DateTimeFormat("ru-RU", {
            timeZone: "Asia/Tashkent",
            dateStyle: "short",
            timeStyle: "medium",
        }).format(probationEnd);
        const safeFeedbacks =
            intern.feedbacks?.map((fb) => {
                const { mentorId, ...rest } = fb.toObject ? fb.toObject() : fb;
                return rest;
            }) || [];

        return {
            _id: intern._id,
            name: intern.name,
            lastName: intern.lastName,
            username: intern.username,
            phoneNumber: intern.phoneNumber || "",
            telegram: intern.telegram || "",
            sphere: intern.sphere || "",
            profilePhoto: intern.profilePhoto || "",
            avatar: intern.profilePhoto || "",
            branch: intern.branch,
            mentor: intern.mentor,
            score: intern.score,
            grade: intern.grade,
            goal,
            lessonsVisited: intern.lessonsVisited,
            feedbacks: safeFeedbacks,
            probationPeriod: intern.probationPeriod,
            probationStartDate: intern.probationStartDate,
            probationEndDate: probationEnd,
            probationEndDateLocal: probationEndLocal,
            pluses: intern.pluses,
            helpedStudents: intern.helpedStudents,
            createdAt: intern.createdAt, // UTC
            createdAtLocal, // Ташкент
            grades,
            complaints: intern.complaints || [],
            planStatus: await getInternPlanStatus(intern),
        };
    }

    async getInterns(user) {
        const applyPlanStatus = async (list) => {
            return Promise.all(
                list.map(async (intern) => {
                    const planStatus = await getInternPlanStatus(intern);
                    return {
                        ...intern.toObject(),
                        ...planStatus,
                    };
                })
            );
        };

        if (user?.role === "admin") {
            const interns = await Intern.find()
                .populate("branch", "name")
                .populate("mentor", "name lastName");
            return applyPlanStatus(interns);
        }

        const branchId = user?.branchId;
        if (!branchId) {
            throw new AppError("Нет доступа", 403);
        }

        const interns = await Intern.find({ branch: branchId })
            .populate("branch", "name")
            .populate("mentor", "name lastName");
        return applyPlanStatus(interns);
    }

    async updateIntern(id, updateData) {
        const allowedFields = [
            "name",
            "lastName",
            "username",
            "password",
            "branch",
            "mentor",
            "grade",
            "dateJoined",
            "phoneNumber",
            "telegram",
            "sphere",
            "profilePhoto",
        ];

        const payload = {};
        allowedFields.forEach((field) => {
            if (Object.prototype.hasOwnProperty.call(updateData, field)) {
                payload[field] = updateData[field];
            }
        });

        if (payload.password !== undefined && !String(payload.password).trim()) {
            delete payload.password;
        }

        if (payload.grade) {
            const gradeConfig = grades[payload.grade];
            if (!gradeConfig) {
                throw new AppError(
                    `Недопустимый уровень: ${Object.keys(grades).join(", ")}`,
                    400
                );
            }
            payload.probationPeriod = gradeConfig.trialPeriod;
            payload.lessonsPerMonth = gradeConfig.lessonsPerMonth;
            payload.pluses = gradeConfig.plus;
            payload.probationStartDate = new Date();
        }

        const intern = await Intern.findById(id);

        if (!intern) throw new AppError("Стажёр не найден", 404);

        if (payload.password) {
            payload.password = await bcrypt.hash(payload.password, 10);
        }

        Object.assign(intern, payload);
        await intern.save();

        return intern;
    }

    async updateOwnProfile(internId, updateData) {
        const intern = await Intern.findById(internId);
        if (!intern) throw new AppError("Стажёр не найден", 404);

        const allowedFields = [
            "name",
            "lastName",
            "username",
            "phoneNumber",
            "telegram",
            "sphere",
            "profilePhoto",
        ];

        allowedFields.forEach((field) => {
            if (Object.prototype.hasOwnProperty.call(updateData, field)) {
                intern[field] = updateData[field];
            }
        });

        await intern.save();
        return intern;
    }

    async getBranchManagerInterns(user) {
        if (!["branchManager", "admin"].includes(user?.role)) {
            throw new AppError("Доступ только для branch manager или admin", 403);
        }

        const branchId = user?.branchId;
        if (!branchId) {
            throw new AppError("Не найден филиал в токене", 400);
        }

        const interns = await Intern.find({ branch: branchId })
            .populate("branch", "name")
            .populate("mentor", "name lastName profilePhoto")
            .sort({ createdAt: -1 });

        return Promise.all(
            interns.map(async (intern) => {
                const lastLessons = await Lesson.find({ intern: intern._id })
                    .sort({ date: -1 })
                    .limit(3)
                    .populate("mentor", "name lastName profilePhoto");

                const planStatus = await getInternPlanStatus(intern);

                return {
                    ...intern.toObject(),
                    ...planStatus,
                    lastLessons,
                };
            })
        );
    }

    async addBranchManagerComplaint(user, targetInternId, text) {
        if (!["branchManager", "admin"].includes(user?.role)) {
            throw new AppError("Только branch manager или admin может отправлять жалобы", 403);
        }
        if (!text || !text.trim()) {
            throw new AppError("Текст жалобы обязателен", 400);
        }

        const intern = await Intern.findById(targetInternId).populate("branch", "name");
        if (!intern) throw new AppError("Стажёр не найден", 404);

        if (user.role !== "admin" && String(intern.branch._id) !== String(user.branchId)) {
            throw new AppError("Можно отправлять жалобы только на стажёров своего филиала", 403);
        }

        intern.complaints.push({
            text: text.trim(),
            createdAt: new Date(),
            createdById: user.id || user._id,
            createdByName: user.name ? `${user.name} ${user.lastName || ""}`.trim() : "",
            createdByRole: user.role === "admin" ? "admin" : "branchManager",
            status: "new",
        });

        await intern.save();

        return {
            message: "Жалоба отправлена",
            complaints: intern.complaints,
        };
    }

    async deleteIntern(id) {
        await Intern.findByIdAndDelete(id);
    }

    async rateIntern(mentorId, lessonId, stars, feedback, violations = []) {
        // Validation for lessonId before usage
        if (!lessonId) {
            throw new AppError("ID урока обязателен для оценки", 400);
        }

        const lesson = await Lesson.findById(lessonId).populate("intern");
        if (!lesson) throw new AppError("Урок не найден", 404);
        if (lesson.isRated) throw new AppError("Урок уже оценен", 400);

        // Check if mentor field exists and owns the lesson
        if (!lesson.mentor) {
            throw new AppError("У урока не указан ментор", 500);
        }

        if (lesson.mentor.toString() !== mentorId.toString()) {
            throw new AppError("Вы не можете оценить чужой урок", 403);
        }

        const intern = await Intern.findById(lesson.intern._id);

        // Добавляем новый отзыв
        intern.feedbacks.push({
            mentorId,
            stars,
            feedback,
        });

        // 🆕 Добавляем нарушения (если есть)
        if (violations && violations.length > 0) {
            violations.forEach((ruleId) => {
                intern.violations.push({
                    ruleId,
                    date: new Date(),
                    notes: feedback ? `При оценке урока. Комментарий: ${feedback}` : "При оценке урока",
                });
            });
        }

        // Пересчитываем общий балл (среднее арифметическое)
        const totalStars = intern.feedbacks.reduce((sum, fb) => sum + fb.stars, 0);
        intern.score = totalStars / intern.feedbacks.length;

        await intern.save();

        // Отмечаем урок как оценённый и подтверждённый
        lesson.isRated = true;
        lesson.status = "confirmed";
        await lesson.save();

        return {
            message: "Стажёр успешно оценён",
            score: intern.score.toFixed(1),
        };
    }

    async addLessonVisit(mentorId, internId, lessonData) {
        const { topic, time, date, group } = lessonData;
        const lessonDate = date ? new Date(date) : new Date();

        const intern = await Intern.findById(internId).populate("lessonsVisited.lessonId");
        if (!intern) throw new AppError("Стажёр не найден", 404);

        // 1. Защита от дубликатов (intern + mentor + date)
        // Проверяем начало дня и конец дня, чтобы избежать дублей в один день
        const startOfDay = new Date(lessonDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(lessonDate);
        endOfDay.setHours(23, 59, 59, 999);

        const existingLesson = await Lesson.findOne({
            intern: intern._id,
            mentor: mentorId,
            date: { $gte: startOfDay, $lte: endOfDay },
        });

        if (existingLesson) {
            throw new AppError("Урок с этим ментором уже добавлен на сегодня", 400);
        }

        // 2. Лимит на "висящие" уроки
        const pendingCount = await Lesson.countDocuments({
            intern: intern._id,
            status: "pending",
        });

        if (pendingCount >= 3) {
            throw new AppError(
                "У вас слишком много неподтверждённых уроков. Попросите менторов оценить прошлые занятия.",
                400
            );
        }

        // 3. Зависимость от фидбэков (ratio < 70%)
        // Получаем актуальные данные из lessonsVisited (или считаем напрямую из Lesson collection)
        const totalLessons = await Lesson.countDocuments({ intern: intern._id });
        const totalFeedbacks = intern.feedbacks.length; // или считаем уроки со статусом confirmed

        // Если уроков мало (например, < 5), валидацию можно пропустить
        if (totalLessons > 5) {
            const ratio = totalFeedbacks / totalLessons;
            if (ratio < 0.7) {
                throw new AppError(
                    `Ваш рейтинг отзывов слишком низок (${(ratio * 100).toFixed(0)}%). Менторы должны оставлять фидбэк чаще.`,
                    400
                );
            }
        }

        // 4. Лимит на занятия со своим ментором (30% в месяц)
        if (intern.mentor.toString() === mentorId) {
            // Считаем уроки в этом месяце
            const startOfMonth = new Date(lessonDate.getFullYear(), lessonDate.getMonth(), 1);
            const endOfMonth = new Date(lessonDate.getFullYear(), lessonDate.getMonth() + 1, 0);

            const monthlyLessons = await Lesson.find({
                intern: intern._id,
                date: { $gte: startOfMonth, $lte: endOfMonth }
            });

            const totalMonthly = monthlyLessons.length;
            const ownMentorLessons = monthlyLessons.filter(l => l.mentor.toString() === intern.mentor.toString()).length;

            // +1 так как мы сейчас добавляем урок
            if ((ownMentorLessons + 1) / (totalMonthly + 1) > 0.3) {
                throw new AppError("Превышен лимит занятий со своим ментором (макс. 30%)", 400);
            }
        }

        // Создаём Lesson со статусом pending
        const lesson = await Lesson.create({
            intern: intern._id,
            mentor: mentorId,
            topic: topic || "Без темы",
            time: time || "00:00",
            date: lessonDate,
            group: group || "General",
            status: "pending"
        });

        // Добавляем в lessonsVisited
        intern.lessonsVisited.push({
            mentorId,
            lessonId: lesson._id,
            count: 1,
        });

        // Добавляем задачу для ментора "оценить этого стажёра"
        intern.pendingMentors.push({
            mentorId,
            lessonId: lesson._id,
        });

        await intern.save();

        return {
            message: "Урок добавлен и ожидает подтверждения ментора",
            intern,
        };
    }

    async upgradeInternGrade(id, newGrade, options = {}) {
        if (!newGrade) {
            throw new AppError("Новый уровень обязателен", 400);
        }

        const intern = await Intern.findById(id);
        if (!intern) {
            throw new AppError("Стажёр не найден", 404);
        }

        const validGrades = Object.keys(grades);
        const normalizedGrade = newGrade.toString().trim();

        if (!validGrades.includes(normalizedGrade)) {
            throw new AppError(
                `Недопустимый уровень. Возможные: ${validGrades.join(", ")}`,
                400
            );
        }

        const gradeConfig = grades[normalizedGrade];
        const oldGrade = intern.grade;

        // 🎁 Сохраняем в историю повышений
        intern.promotionHistory.push({
            date: new Date(),
            fromGrade: oldGrade,
            toGrade: normalizedGrade,
            withConcession: options.withConcession || false,
            promotedBy: options.promotedBy || null,
            percentage: options.percentage || 0,
            note: options.note || "",
        });

        // 🔹 Обновляем грейд и параметры
        intern.grade = normalizedGrade;
        intern.probationPeriod = gradeConfig.trialPeriod;
        intern.lessonsPerMonth = gradeConfig.lessonsPerMonth;
        intern.pluses = gradeConfig.plus;

        // 🔹 Сбрасываем испытательный срок (а не дату присоединения)
        intern.probationStartDate = new Date();

        await intern.save();

        return {
            message: options.withConcession
                ? `Грейд стажёра повышен до "${normalizedGrade}" с уступкой 🎁`
                : `Грейд стажёра повышен до "${normalizedGrade}"`,
            intern,
            wasWithConcession: options.withConcession || false,
        };
    }


    async addBonusLessons(id, { count, reason, notes, addedBy }) {
        if (!count || count <= 0) {
            throw new AppError("Количество бонусных уроков должно быть больше 0", 400);
        }
        const allowedCounts = [5, 10, 15];
        if (!allowedCounts.includes(Number(count))) {
            throw new AppError("Разрешённые значения бонуса: 5, 10 или 15", 400);
        }
        if (!reason) {
            throw new AppError("Причина обязательна", 400);
        }

        const intern = await Intern.findById(id);
        if (!intern) throw new AppError("Стажёр не найден", 404);

        intern.bonusLessons.push({
            count: Number(count),
            reason,
            notes: notes || "",
            date: new Date(),
            addedBy,
        });

        await intern.save();

        return {
            message: `Бонус +${count} уроков добавлен стажёру ${intern.name} ${intern.lastName}`,
            intern,
        };
    }

    async setHeadIntern(id, isHeadIntern) {
        const intern = await Intern.findById(id).populate("branch", "name");
        if (!intern) throw new AppError("Стажёр не найден", 404);

        if (isHeadIntern) {
            // Remove head intern status from others in the same branch
            await Intern.updateMany(
                { branch: intern.branch._id, _id: { $ne: intern._id } },
                { $set: { isHeadIntern: false } }
            );
        }

        intern.isHeadIntern = Boolean(isHeadIntern);
        await intern.save();

        return {
            message: isHeadIntern
                ? `${intern.name} ${intern.lastName} назначен Head Intern в филиале ${intern.branch?.name}`
                : `${intern.name} ${intern.lastName} снят с должности Head Intern`,
            intern,
        };
    }

    async headInternWarning(headInternId, targetInternId, { ruleId, notes }) {
        if (!ruleId) throw new AppError("ID правила обязателен", 400);

        const headIntern = await Intern.findById(headInternId);
        if (!headIntern) throw new AppError("Стажёр не найден", 404);
        if (!headIntern.isHeadIntern) {
            throw new AppError("Только Head Intern может выдавать предупреждения", 403);
        }

        const targetIntern = await Intern.findById(targetInternId);
        if (!targetIntern) throw new AppError("Целевой стажёр не найден", 404);

        if (headIntern.branch.toString() !== targetIntern.branch.toString()) {
            throw new AppError("Head Intern может выдавать предупреждения только интернам своего филиала", 403);
        }

        if (headInternId.toString() === targetInternId.toString()) {
            throw new AppError("Нельзя выдать предупреждение самому себе", 400);
        }

        targetIntern.violations.push({
            ruleId,
            date: new Date(),
            notes: notes || "",
            issuedBy: "headIntern",
            issuedById: headInternId,
        });

        await targetIntern.save();

        return {
            message: `Предупреждение выдано стажёру ${targetIntern.name} ${targetIntern.lastName}`,
            intern: targetIntern,
        };
    }

    async getInternsRating() {
        const interns = await Intern.find()
            .populate("branch", "name")
            .populate("mentor", "name lastName");

        const now = new Date();
        const currentMonth = now.getMonth() + 1; // Yanvar = 1

        // grade mapping
        const gradeMap = {
            junior: "junior",
            "strong-junior": "strongJunior",
            middle: "middle",
            "strong-middle": "strongMiddle",
            senior: "senior",
        };

        const withRating = interns.map((intern) => {
            const totalLessons = intern.lessonsVisited.reduce(
                (sum, l) => sum + l.count,
                0
            );

            const gradeKey = gradeMap[intern.grade] || intern.grade;
            const gradeConfig = grades[gradeKey];

            if (!gradeConfig) {
                return {
                    _id: intern._id,
                    name: intern.name,
                    lastName: intern.lastName,
                    branch: intern.branch,
                    mentor: intern.mentor,
                    grade: intern.grade,
                    score: intern.score,
                    attendance: "N/A",
                    rating: "N/A",
                    lessonsPerMonth: null,
                    totalLessonsRequired: null,
                    totalLessonsVisited: totalLessons,
                };
            }

            // Hozirgi oyning normasi
            const maxLessons = gradeConfig.lessonsPerMonth * currentMonth;

            const attendance = maxLessons > 0 ? totalLessons / maxLessons : 0;

            // umumiy reyting formulasi
            const rating = intern.score * 0.7 + attendance * 5 * 0.3;

            return {
                _id: intern._id,
                name: intern.name,
                lastName: intern.lastName,
                branch: intern.branch,
                mentor: intern.mentor,
                grade: intern.grade,
                score: intern.score,
                attendance: (attendance * 100).toFixed(1) + "%",
                rating: rating.toFixed(2),
                lessonsPerMonth: gradeConfig.lessonsPerMonth, // 1 oy uchun norma
                totalLessonsRequired: maxLessons, // hozirgi oyning oxirigacha bo‘lishi kerak bo‘lgan jami darslar
                totalLessonsVisited: totalLessons,
            };
        });

        withRating.sort((a, b) => b.rating - a.rating);

        return withRating;
    }
}
module.exports = new InternService();
