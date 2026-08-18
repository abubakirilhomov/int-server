const Intern = require("../models/internModel");
const Branch = require("../models/branchModel");
const Mentor = require("../models/mentorModel");
const Lesson = require("../models/lessonModel");
const Rule = require("../models/rulesModel");
const grades = require("../config/grades");
const AppError = require("../utils/AppError");
const bcrypt = require("bcrypt");
const { getInternPlanStatus } = require("../utils/internPlanStatus");
const isAdminUser = require("../utils/isAdminUser");
const { computePenalties, buildRuleMap, PENALTY_WEIGHTS, demoteGrade } = require("../utils/penaltyUtils");
const BADGE_DEFINITIONS = require("../config/badges");

const BADGE_POINTS_BY_KEY = BADGE_DEFINITIONS.reduce((map, def) => {
    map[def.key] = def.points || 1;
    return map;
}, {});

// Reytingdagi badge bonusi shu qiymatga yetganda to'liq (100%) hisoblanadi.
// Faqat oddiy badge'larni yig'ish bilan emas, qiyin/mas'uliyatli
// yutuqlarni (masalan: senior, perfect_score, top_3) olish bilan tezroq to'ladi.
const BADGE_BONUS_CAP = 80;

// Shtraf berilganda intern darajasiga va reytingiga ta'sir qiladi.
// category: green | yellow | red | black. Qaytarilgan demoted — daraja
// pasaygan bo'lsa { from, to }, aks holda null.
function applyViolationPenalty(intern, category) {
  intern.violationsCount = (intern.violationsCount || 0) + 1;
  intern.lastViolationAt = new Date();

  // intern.score'ni shu yerda kamaytirmaymiz — u navbatdagi feedback kelganda
  // baribir totalStars/feedbacks.length bilan qayta yoziladi (qarang: pastda
  // "Пересчитываем общий балл"), ya'ni bu ayirish vaqtinchalik va beqaror
  // edi. Jarima reytingga penaltyInfo.totalDeduction orqali bir marta va
  // barqaror qo'llaniladi (getRatings() va boshqa reyting funksiyalarida).
  const weight = PENALTY_WEIGHTS[category] || 0;

  const demoteSteps = category === "red" ? 1 : category === "black" ? 1 : 0;
  const demoted = demoteGrade(intern.grade, demoteSteps);
  if (demoted) intern.grade = demoted.to;

  return { weight, demoted };
}

class InternService {
    async createIntern(data) {
        const {
            name,
            lastName,
            username,
            password,
            phoneNumber,
            telegram,
            age,
            sphere,
            profilePhoto,
            branch,
            mentor,
            branches,   // new: array format [{ branch, mentor, isHeadIntern }]
            grade,
            dateJoined,
            lessonsVisitedFake,
        } = data;

        // Normalize to branches array (support both legacy and new format)
        let branchList;
        if (branches && Array.isArray(branches) && branches.length > 0) {
            branchList = branches;
        } else if (branch && mentor) {
            branchList = [{ branch, mentor, isHeadIntern: false }];
        } else {
            throw new AppError("Необходимо указать филиал и ментора", 400);
        }

        // Validate all branches/mentors
        for (const entry of branchList) {
            const branchExists = await Branch.findById(entry.branch);
            if (!branchExists) throw new AppError(`Филиал ${entry.branch} не найден`, 400);
            const mentorExists = await Mentor.findById(entry.mentor);
            if (!mentorExists) throw new AppError(`Ментор ${entry.mentor} не найден`, 400);
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
            age: (age === "" || age === null || age === undefined) ? undefined : age,
            sphere: sphere || "backend-nodejs",
            profilePhoto: profilePhoto || "",
            branches: branchList.map((b) => ({
                branch: b.branch,
                mentor: b.mentor,
                isHeadIntern: b.isHeadIntern || false,
                joinedAt: joinedDate,
            })),
            score: 0,
            feedbacks: [],
            lessonsVisited: [],
            grade: normalizedGrade,
            mentorsEvaluated: {},
            dateJoined: joinedDate,
            probationStartDate: joinedDate,
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
        // Archived and frozen excluded. Interns with missing status (e.g. imported during DB recovery) are treated as active.
        const interns = await Intern.find({ status: { $nin: ["frozen", "archived"] } })
            .populate("branches.branch", "name telegramLink")
            .populate("branches.mentor", "name");

        // Fetch all rules once to build a ruleId → category map for penalty computation.
        const allRules = await Rule.find({}).select("category").lean();
        const ruleMap = buildRuleMap(allRules);

        const internRatings = interns.map((intern) => {
            const feedbacks = intern.feedbacks || [];
            const lessonsVisited = intern.lessonsVisited || [];
            const bonusLessons = intern.bonusLessons || [];

            // Correct lesson count: sum all visit counts + bonus lessons
            const visitedCount = lessonsVisited.reduce((sum, l) => sum + (l.count || 0), 0);
            const bonusCount = bonusLessons.reduce((sum, b) => sum + (b.count || 0), 0);
            const lessonCount = Math.max(visitedCount + bonusCount, 1);

            const feedbackCount = feedbacks.length;

            const averageStars =
                feedbacks.reduce((sum, f) => sum + (f.stars || 0), 0) /
                (feedbackCount || 1);

            // activityRate uses only real lessons (visitedCount) as denominator
            // because bonus lessons don't generate mentor feedbacks by design
            const activityRate = Math.min(feedbackCount / Math.max(visitedCount, 1), 1);
            // Repodagi kabi cheklanmagan — juda ko'p dars kirgan intern uchun
            // bu qism 1 dan oshishi mumkin (masalan 500+ darsda ~1.8), reyting
            // shu sababli 5 dan yuqori chiqishi repo bilan bir xil kutilgan holat.
            const attendanceFactor = Math.log(lessonCount + 1) / Math.log(30 + 1);

            // Сравниваем с целью за весь пробационный период (lessonsPerMonth × trialPeriod),
            // а не за один месяц — иначе любой интерн с 24+ уроками мгновенно получает 100%.
            const gradeConfig = grades[intern.grade];
            const trialPeriod = gradeConfig?.trialPeriod || 1;
            // Senior (requiresLessons: false) darslarga kirish talabi yo'q — tutor
            // rejimida ishlaydi, shuning uchun reja bajarilishi doim 100% hisoblanadi.
            // Aks holda gradeConfig.lessonsPerMonth=0 bo'lgani uchun
            // `intern.lessonsPerMonth || 24` falsy-fallback tufayli 24 ga tushib,
            // senior real darslar soni bo'yicha kunma-kun sekin to'lib borar edi —
            // ular esa umuman dars kirishga majbur emas.
            const planCompletion = gradeConfig?.requiresLessons === false
                ? 1
                : Math.min(lessonCount / ((intern.lessonsPerMonth || 24) * trialPeriod), 1);

            // Kolleksiyalar (profildagi unvonlar/badge'lar) reytingga ta'sir qiladi —
            // oddiy badge emas, aynan qiyin/mas'uliyatli badge'lar (senior, perfect_score,
            // top_3 va h.k.) ko'proq og'irlik beradi. BADGE_BONUS_CAP ballga yetganda
            // bonus 100% ga to'ladi.
            const badgePoints = (intern.badges || []).reduce(
                (sum, b) => sum + (b.points || BADGE_POINTS_BY_KEY[b.key] || 1),
                0
            );
            const badgeFactor = Math.min(badgePoints / BADGE_BONUS_CAP, 1);

            // Asosiy formula repodagi (GitHub main) bilan bir xil: stars 50%,
            // activity 20%, plan 20%, attendance 10% — hech qanday sun'iy 5
            // balllik yuqori chegara yo'q (repoda ham yo'q). Badge bonusi bu
            // ulushlardan birortasini kamaytirmaydi — ustiga qo'shiladigan
            // alohida, kichik bonus (maks. +0.25).
            const ratingScore =
                averageStars * 0.5 +
                activityRate * 5 * 0.2 +
                planCompletion * 5 * 0.2 +
                attendanceFactor * 5 * 0.1 +
                badgeFactor * 0.25;

            // 🔹 Shtrafga ta'sir: har bir categoriyaga qarab reytingdan ayirish.
            const penaltyInfo = computePenalties(intern.violations || [], ruleMap);

            const adjustedRatingScore = Math.max(0, ratingScore - penaltyInfo.totalDeduction);

            // Distinct branch names — used so a multi-branch intern is counted
            // once per branch in the branch leaderboard below, instead of being
            // bucketed under a phantom combined "A, B" key.
            const branchNames = [
                ...new Set(
                    (intern.branches || [])
                        .map((b) => b.branch?.name)
                        .filter(Boolean)
                ),
            ];

            return {
                internId: intern._id,
                name: `${intern.name} ${intern.lastName}`,
                profilePhoto: intern.profilePhoto || "",
                branch: branchNames.length ? branchNames.join(", ") : "No branch",
                branchNames,
                grade: intern.grade,
                averageStars: +averageStars.toFixed(2),
                activityRate: +activityRate.toFixed(2),
                planCompletion: +(planCompletion * 100).toFixed(1),
                lessons: lessonCount,
                feedbacks: feedbackCount,
                ratingScore: +adjustedRatingScore.toFixed(2),
                // Shtraf (penaltyInfo) ataylab bu yerda qaytarilmaydi — bu ochiq
                // reyting ro'yxati (client-rating), hammaga ko'rinadi. Jarima faqat
                // intern o'z profilida ko'rishi kerak (getInternProfile).
                // 🔹 Premium/VIP belgilari + yutuqlar (reyting sahifasi uchun)
                isHeadIntern: (intern.branches || []).some((b) => b.isHeadIntern),
                isSenior: intern.grade === "senior",
                badgeCount: (intern.badges || []).length,
                badgePoints,
                badgeFactor: +(badgeFactor * 100).toFixed(1),
                username: intern.username,
            };
        });

        internRatings.sort((a, b) => b.ratingScore - a.ratingScore);

        // Рейтинг филиалов — интерн с двумя филиалами учитывается в каждом
        // филиале по одному разу (а не под объединённым ключом "A, B").
        const branchMap = {};
        for (const i of internRatings) {
            const names = i.branchNames.length ? i.branchNames : ["No branch"];
            for (const name of names) {
                if (!branchMap[name]) branchMap[name] = [];
                branchMap[name].push(i.ratingScore);
            }
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

    async getInternRank(internId) {
        const { interns } = await this.getRatings();
        const idx = interns.findIndex((i) => i.internId.toString() === internId.toString());
        const total = interns.length;
        if (idx === -1 || total === 0) return { rank: 0, percentile: 0, totalInterns: total };
        const rank = idx + 1;
        const percentile = Math.round(((total - rank) / total) * 100);
        return { rank, percentile, totalInterns: total };
    }

    async getInternProfile(user, id) {
        let intern;

        // 🔹 Если админ и указан ID → можно смотреть чужой профиль
        if (isAdminUser(user) && id) {
            intern = await Intern.findById(id)
                .select("-password")
                .populate("branches.branch", "name telegramLink")
                .populate("branches.mentor", "name lastName")
                .populate("violations.ruleId", "category title consequence");
        } else {
            const internId = user?._id || id;
            if (!internId) {
                throw new AppError("Нет доступа", 403);
            }

            intern = await Intern.findById(internId)
                .select("-password")
                .populate("branches.branch", "name telegramLink")
                .populate("branches.mentor", "name lastName")
                .populate("violations.ruleId", "category title consequence");
        }

        if (!intern) throw new AppError("Стажёр не найден", 404);

        // 🔹 PII сокрытие: phoneNumber/telegram видят только сам интерн и админ
        const requesterId = String(user?._id || user?.id || "");
        const isSelf = requesterId && requesterId === String(intern._id);
        const isAdmin = isAdminUser(user);
        const canSeePII = isSelf || isAdmin;

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

        // 🔹 Shtraf ma'lumotlari: violations ro'yxati + penaltyInfo
        const safeViolations = (intern.violations || []).map((v) => {
            const obj = v.toObject ? v.toObject() : v;
            return {
                ...obj,
                rule: obj.ruleId || null,
            };
        });
        const penaltyInfo = computePenalties(intern.violations || [], {});

        return {
            _id: intern._id,
            name: intern.name,
            lastName: intern.lastName,
            username: intern.username,
            phoneNumber: canSeePII ? (intern.phoneNumber || "") : "",
            telegram: canSeePII ? (intern.telegram || "") : "",
            sphere: intern.sphere || "",
            profilePhoto: intern.profilePhoto || "",
            avatar: intern.profilePhoto || "",
            branches: intern.branches,
            branch: intern.branches?.[0]?.branch || null,
            mentor: intern.branches?.[0]?.mentor || null,
            score: intern.score,
            grade: intern.grade,
            status: intern.status || "active",
            isFrozen: intern.status === "frozen",
            isArchived: intern.status === "archived",
            freezeInfo: intern.status === "frozen" ? intern.freezeInfo || null : null,
            archiveInfo: intern.status === "archived" || isAdminUser(user)
                ? intern.archiveInfo || null
                : null,
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
            // 🔹 Shtraf: violations ro'yxati + penaltyInfo (eng yomon daraja, sonlar)
            violations: safeViolations,
            violationsCount: intern.violationsCount || 0,
            lastViolationAt: intern.lastViolationAt || null,
            penaltyInfo,
            planStatus: await getInternPlanStatus(intern),
        };
    }

    // Reyting sahifasidan boshqa internning profilini ko'rish (PII siz).
    // Profil rasmi, ism, daraja, head-intern/premium belgilari, yutuqlar
    // (badges) va kirgan darslar soni ko'rsatiladi.
    async getPublicProfile(internId) {
        const intern = await Intern.findById(internId)
            .select("-password -phoneNumber -telegram -feedbacks -violations -complaints")
            .lean();
        if (!intern) throw new AppError("Стажёр не найден", 404);

        const visitedCount = (intern.lessonsVisited || []).reduce(
            (sum, l) => sum + (l.count || 0),
            0
        );
        const bonusCount = (intern.bonusLessons || []).reduce(
            (sum, b) => sum + (b.count || 0),
            0
        );

        return {
            _id: intern._id,
            name: intern.name,
            lastName: intern.lastName,
            username: intern.username,
            profilePhoto: intern.profilePhoto || "",
            grade: intern.grade,
            sphere: intern.sphere || "",
            isHeadIntern: (intern.branches || []).some((b) => b.isHeadIntern),
            isSenior: intern.grade === "senior",
            badges: intern.badges || [],
            badgeCount: (intern.badges || []).length,
            totalLessons: visitedCount + bonusCount,
            helpedStudents: intern.helpedStudents || 0,
            pluses: intern.pluses || [],
            status: intern.status || "active",
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

        // Основной список интернов: показываем активных и замороженных
        // (заморожённые видны в админке с бейджем). Архивные — скрыты,
        // для них есть отдельный эндпоинт /interns/archived.
        const baseFilter = { status: { $ne: "archived" } };

        // PII / sensitive fields: hidden from peer-intern responses;
        // admin and mentors get full data (mentors need phone/telegram for outreach).
        const isAdmin = isAdminUser(user);
        const isMentor = user?.role === "mentor" || user?.role === "branchManager";
        const peerProjection = "-password -phoneNumber -telegram -violations -feedbacks -complaints";
        const adminMentorProjection = "-password";
        const projection = isAdmin || isMentor ? adminMentorProjection : peerProjection;

        if (isAdmin) {
            const interns = await Intern.find(baseFilter)
                .select(projection)
                .populate("branches.branch", "name telegramLink")
                .populate("branches.mentor", "name lastName");
            return applyPlanStatus(interns);
        }

        const branchId = user?.activeBranchId || user?.branchId;
        if (!branchId) {
            throw new AppError("Нет доступа", 403);
        }

        const interns = await Intern.find({ ...baseFilter, "branches.branch": branchId })
            .select(projection)
            .populate("branches.branch", "name telegramLink")
            .populate("branches.mentor", "name lastName");
        return applyPlanStatus(interns);
    }

    async updateIntern(id, updateData) {
        const allowedFields = [
            "name",
            "lastName",
            "username",
            "password",
            "branches",
            "grade",
            "dateJoined",
            "phoneNumber",
            "telegram",
            "age",
            "sphere",
            "profilePhoto",
        ];

        const payload = {};
        allowedFields.forEach((field) => {
            if (Object.prototype.hasOwnProperty.call(updateData, field)) {
                payload[field] = updateData[field];
            }
        });

        // Пустое значение возраста из формы → снять поле (не писать "" в Number).
        if (payload.age === "" || payload.age === null) {
            payload.age = undefined;
        }

        if (payload.password !== undefined && !String(payload.password).trim()) {
            delete payload.password;
        }

        const intern = await Intern.findById(id);

        if (!intern) throw new AppError("Стажёр не найден", 404);

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
            // Сбрасываем дату начала испытательного ТОЛЬКО при реальной смене
            // грейда. Раньше сброс срабатывал при любом сохранении формы (она
            // всегда шлёт grade) → probationStartDate уезжал на "сегодня", и все
            // ранее проведённые уроки выпадали из зачёта trial-периода.
            if (payload.grade !== intern.grade) {
                payload.probationStartDate = new Date();
            }
        }

        // Password hashing is handled by the pre-save hook in internModel.js
        // Do NOT hash here — it would cause double-hashing

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

        const branchId = user?.activeBranchId || user?.branchId;
        if (!branchId) {
            throw new AppError("Не найден филиал в токене", 400);
        }

        const interns = await Intern.find({
            "branches.branch": branchId,
            status: { $ne: "archived" },
        })
            .populate("branches.branch", "name telegramLink")
            .populate("branches.mentor", "name lastName profilePhoto")
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

    async addBranchManagerComplaint(user, targetInternId, payload = {}) {
        const text = String(payload.text || "").trim();
        const rawRuleIds = Array.isArray(payload.ruleIds) ? payload.ruleIds : [];
        const category = payload.category || "other";

        if (!["branchManager", "admin"].includes(user?.role)) {
            throw new AppError("Только branch manager или admin может отправлять жалобы", 403);
        }
        if (!text && rawRuleIds.length === 0) {
            throw new AppError("Добавьте текст жалобы или выберите правило", 400);
        }

        const intern = await Intern.findById(targetInternId).populate("branches.branch", "name telegramLink");
        if (!intern) throw new AppError("Стажёр не найден", 404);

        const activeBranchId = user.activeBranchId || user.branchId;
        if (!isAdminUser(user) && !intern.isInBranch(activeBranchId)) {
            throw new AppError("Можно отправлять жалобы только на стажёров своего филиала", 403);
        }

        const uniqueRuleIds = [...new Set(rawRuleIds.map(String))];
        const rules = uniqueRuleIds.length
            ? await Rule.find({ _id: { $in: uniqueRuleIds } }).select("category title")
            : [];

        if (uniqueRuleIds.length && rules.length !== uniqueRuleIds.length) {
            throw new AppError("Некоторые правила не найдены", 400);
        }

        const severity = { green: 1, yellow: 2, red: 3, black: 4 };
        const complaintCategory = rules.length
            ? rules
                .map((rule) => rule.category)
                .sort((a, b) => (severity[b] || 0) - (severity[a] || 0))[0]
            : category || "other";

        rules.forEach((rule) => {
            const { demoted } = applyViolationPenalty(intern, rule.category);

            intern.violations.push({
                ruleId: rule._id,
                date: new Date(),
                notes: text || `Жалоба от branch manager: ${rule.title}`,
                issuedBy: isAdminUser(user) ? "admin" : "branchManager",
                issuedById: user.id || user._id,
                consequenceApplied: demoted
                    ? `Daraja pasaytirildi: ${demoted.from} → ${demoted.to}`
                    : `Reyting ta'siri: -${PENALTY_WEIGHTS[rule.category] || 0}`,
            });
        });

        intern.complaints.push({
            text: text || `Жалоба по правилам: ${rules.map((r) => r.title).join(", ")}`,
            category: complaintCategory,
            ruleIds: rules.map((rule) => rule._id),
            createdAt: new Date(),
            createdById: user.id || user._id,
            createdByName: user.name ? `${user.name} ${user.lastName || ""}`.trim() : "",
            createdByRole: isAdminUser(user) ? "admin" : "branchManager",
            status: "new",
        });

        await intern.save();

        return {
            message: "Жалоба отправлена",
            complaints: intern.complaints,
        };
    }

    async freezeIntern(id, { reason, note, expectedReturn, adminId } = {}) {
        const intern = await Intern.findById(id);
        if (!intern) throw new AppError("Стажёр не найден", 404);

        if (intern.status === "archived") {
            throw new AppError("Архивный стажёр не может быть заморожен", 400);
        }
        if (intern.status === "frozen") {
            throw new AppError("Стажёр уже заморожен", 400);
        }

        intern.status = "frozen";
        intern.freezeInfo = {
            ...(intern.freezeInfo?.toObject ? intern.freezeInfo.toObject() : intern.freezeInfo || {}),
            startedAt: new Date(),
            expectedReturn: expectedReturn ? new Date(expectedReturn) : null,
            reason: reason || "other",
            note: note || "",
            frozenBy: adminId || null,
            totalFrozenDays: intern.freezeInfo?.totalFrozenDays || 0,
        };

        await intern.save();
        return { message: "Стажёр заморожен", intern };
    }

    async unfreezeIntern(id) {
        const intern = await Intern.findById(id);
        if (!intern) throw new AppError("Стажёр не найден", 404);

        if (intern.status !== "frozen") {
            throw new AppError("Стажёр не находится в заморозке", 400);
        }

        const startedAt = intern.freezeInfo?.startedAt
            ? new Date(intern.freezeInfo.startedAt)
            : null;
        const now = new Date();

        // Сдвигаем probationStartDate на длительность заморозки, чтобы интерн
        // не был оштрафован за пропущенные дни. Также сохраняем суммарное
        // количество замороженных дней в freezeInfo.totalFrozenDays.
        if (startedAt) {
            const frozenMs = Math.max(0, now.getTime() - startedAt.getTime());
            const frozenDays = Math.round(frozenMs / 86400000);

            const probationBase = intern.probationStartDate
                ? new Date(intern.probationStartDate)
                : null;
            if (probationBase) {
                probationBase.setTime(probationBase.getTime() + frozenMs);
                intern.probationStartDate = probationBase;
            }

            intern.freezeInfo = {
                ...(intern.freezeInfo?.toObject ? intern.freezeInfo.toObject() : intern.freezeInfo || {}),
                totalFrozenDays: (intern.freezeInfo?.totalFrozenDays || 0) + frozenDays,
                startedAt: null,
                expectedReturn: null,
            };
        }

        intern.status = "active";
        await intern.save();

        return { message: "Стажёр разморожен", intern };
    }

    async archiveIntern(id, { reason, note, becameTutor, tutorMentorId, adminId } = {}) {
        const intern = await Intern.findById(id);
        if (!intern) throw new AppError("Стажёр не найден", 404);

        if (intern.status === "archived") {
            throw new AppError("Стажёр уже в архиве", 400);
        }

        // Архивирование из заморозки разрешено: по сути замороженный интерн
        // просто переходит в постоянное закрытое состояние. probationStartDate
        // не корректируем — для архивных он не используется.

        if (becameTutor && tutorMentorId) {
            const mentorExists = await Mentor.findById(tutorMentorId);
            if (!mentorExists) {
                throw new AppError("Указанный ментор не найден", 400);
            }
        }

        intern.status = "archived";
        intern.archiveInfo = {
            archivedAt: new Date(),
            reason: reason || "other",
            note: note || "",
            archivedBy: adminId || null,
            becameTutor: Boolean(becameTutor),
            tutorMentorId: becameTutor && tutorMentorId ? tutorMentorId : null,
            finalGrade: intern.grade,
        };

        // Чистим manualActivation чтобы не висели стейлы у архивных
        intern.manualActivation = {
            isEnabled: false,
            enabledAt: null,
            enabledBy: null,
            note: "",
        };

        await intern.save();
        return { message: "Стажёр архивирован", intern };
    }

    async unarchiveIntern(id) {
        const intern = await Intern.findById(id);
        if (!intern) throw new AppError("Стажёр не найден", 404);

        if (intern.status !== "archived") {
            throw new AppError("Стажёр не находится в архиве", 400);
        }

        intern.status = "active";
        // archiveInfo оставляем как историю — следующий раз перезапишется при новой архивации.
        await intern.save();

        return { message: "Стажёр восстановлен из архива", intern };
    }

    async getFrozenInterns() {
        return Intern.find({ status: "frozen" })
            .populate("branches.branch", "name telegramLink")
            .populate("branches.mentor", "name lastName")
            .populate("freezeInfo.frozenBy", "name lastName")
            .sort({ "freezeInfo.startedAt": -1 });
    }

    async getArchivedInterns() {
        return Intern.find({ status: "archived" })
            .populate("branches.branch", "name telegramLink")
            .populate("branches.mentor", "name lastName")
            .populate("archiveInfo.archivedBy", "name lastName")
            .populate("archiveInfo.tutorMentorId", "name lastName profilePhoto")
            .sort({ "archiveInfo.archivedAt": -1 });
    }

    async setInternActivation(id, { isEnabled, note, adminId }) {
        const intern = await Intern.findById(id);
        if (!intern) throw new AppError("Стажёр не найден", 404);

        if (typeof isEnabled !== "boolean") {
            throw new AppError("Поле isEnabled должно быть boolean", 400);
        }

        intern.manualActivation = {
            isEnabled,
            enabledAt: isEnabled ? new Date() : null,
            enabledBy: isEnabled ? adminId : null,
            note: isEnabled ? (note || "") : "",
        };

        await intern.save();

        return {
            message: isEnabled
                ? "Аккаунт стажёра активирован вручную"
                : "Ручная активация отключена",
            intern,
        };
    }

    async deleteIntern(id) {
        await Lesson.deleteMany({ intern: id });
        await Intern.findByIdAndDelete(id);
    }

    async rateIntern(mentorId, lessonId, stars, feedback, violations = []) {
        // Validation for lessonId before usage
        if (!lessonId) {
            throw new AppError("ID урока обязателен для оценки", 400);
        }

        const lesson = await Lesson.findById(lessonId).populate("intern");
        if (!lesson) throw new AppError("Урок не найден", 404);
        if (lesson.status === "confirmed") throw new AppError("Урок уже оценен", 400);

        // Check if mentor field exists and owns the lesson
        if (!lesson.mentor) {
            throw new AppError("У урока не указан ментор", 500);
        }

        if (lesson.mentor.toString() !== mentorId.toString()) {
            throw new AppError("Вы не можете оценить чужой урок", 403);
        }

        const intern = await Intern.findById(lesson.intern._id);

        if (intern?.status === "archived") {
            throw new AppError("Нельзя оценить урок архивного стажёра", 403);
        }

        const Mentor = require("../models/mentorModel");
        const mentorDoc = await Mentor.findById(mentorId).select("name lastName").lean();
        const mentorName = mentorDoc ? `${mentorDoc.name || ""} ${mentorDoc.lastName || ""}`.trim() : "";

        intern.feedbacks.push({
            mentorId,
            mentorName,
            stars,
            feedback,
        });

        // 🆕 Добавляем нарушения (если есть)
        if (violations && violations.length > 0) {
            const rules = await Rule.find({ _id: { $in: violations } })
                .select("category title")
                .lean();
            const ruleById = new Map(rules.map((r) => [String(r._id), r]));

            for (const ruleId of violations) {
                const rule = ruleById.get(String(ruleId)) || {};
                const category = rule.category || "yellow";
                const { demoted } = applyViolationPenalty(intern, category);

                intern.violations.push({
                    ruleId,
                    date: new Date(),
                    notes: feedback ? `При оценке урока. Комментарий: ${feedback}` : "При оценке урока",
                    // Без issuedById отчёт по нарушениям (violationController,
                    // $lookup по violations.issuedById) не может показать автора.
                    issuedBy: "mentor",
                    issuedById: mentorId,
                    consequenceApplied: demoted
                        ? `Daraja pasaytirildi: ${demoted.from} → ${demoted.to}`
                        : `Reyting ta'siri: -${PENALTY_WEIGHTS[category] || 0}`,
                });
            }
        }

        // Пересчитываем общий балл (среднее арифметическое)
        const totalStars = intern.feedbacks.reduce((sum, fb) => sum + fb.stars, 0);
        intern.score = totalStars / intern.feedbacks.length;

        await intern.save();

        // Отмечаем урок как оценённый и подтверждённый
        lesson.isRated = true;
        lesson.status = "confirmed";
        await lesson.save();

        // XP bonus for 5-star + check badges
        const { checkAndAwardBadges } = require("./badgeService");
        const { awardXP, XP_REWARDS } = require("./xpService");
        if (stars === 5) awardXP(intern._id, XP_REWARDS.fiveStarFeedback).catch(() => {});
        const { newBadges } = await checkAndAwardBadges(intern._id);

        return {
            message: "Стажёр успешно оценён",
            score: intern.score.toFixed(1),
            newBadges,
        };
    }

    async addLessonVisit(mentorId, internId, lessonData) {
        const { topic, time, date, group } = lessonData;
        const lessonDate = date ? new Date(date) : new Date();

        const intern = await Intern.findById(internId).populate("lessonsVisited.lessonId");
        if (!intern) throw new AppError("Стажёр не найден", 404);

        if (intern.status === "archived") {
            throw new AppError("Стажёр архивирован — создание уроков недоступно", 403);
        }
        if (intern.status === "frozen") {
            throw new AppError("Стажёр заморожен — создание уроков недоступно", 403);
        }

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
        // "Своим" считается любой ментор из intern.branches
        const isOwnMentor = intern.branches.some(
            (b) => b.mentor.toString() === mentorId.toString()
        );
        if (isOwnMentor) {
            const startOfMonth = new Date(lessonDate.getFullYear(), lessonDate.getMonth(), 1);
            const endOfMonth = new Date(lessonDate.getFullYear(), lessonDate.getMonth() + 1, 0);

            const monthlyLessons = await Lesson.find({
                intern: intern._id,
                date: { $gte: startOfMonth, $lte: endOfMonth },
            });

            const totalMonthly = monthlyLessons.length;
            const ownMentorIds = intern.branches.map((b) => b.mentor.toString());
            const ownMentorLessons = monthlyLessons.filter(
                (l) => ownMentorIds.includes(l.mentor.toString())
            ).length;

            // +1 так как мы сейчас добавляем урок
            if ((ownMentorLessons + 1) / (totalMonthly + 1) > 0.3) {
                throw new AppError("Превышен лимит занятий со своим ментором (макс. 30%)", 400);
            }
        }

        // Определяем филиал по ментору
        const branchEntry = intern.branches.find(
            (b) => b.mentor.toString() === mentorId.toString()
        );
        const lessonBranch = branchEntry?.branch || intern.branches[0]?.branch || null;

        // Создаём Lesson со статусом pending
        const lesson = await Lesson.create({
            intern: intern._id,
            mentor: mentorId,
            topic: topic || "Без темы",
            time: time || "00:00",
            date: lessonDate,
            group: group || "General",
            status: "pending",
            branch: lessonBranch,
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

    async setHeadIntern(id, isHeadIntern, branchId) {
        const intern = await Intern.findById(id).populate("branches.branch", "name telegramLink");
        if (!intern) throw new AppError("Стажёр не найден", 404);

        // Determine which branch to update
        const targetBranchId = branchId || intern.branches[0]?.branch?._id;
        if (!targetBranchId) throw new AppError("Филиал не найден", 400);

        if (isHeadIntern) {
            // Remove head intern status from others in the same branch
            await Intern.updateMany(
                { "branches.branch": targetBranchId, _id: { $ne: intern._id } },
                { $set: { "branches.$[elem].isHeadIntern": false } },
                { arrayFilters: [{ "elem.branch": targetBranchId }] }
            );
        }

        // Update the specific branch entry
        const branchEntry = intern.branches.find(
            (b) => b.branch._id.toString() === targetBranchId.toString()
        );
        if (!branchEntry) throw new AppError("Стажёр не состоит в этом филиале", 400);
        branchEntry.isHeadIntern = Boolean(isHeadIntern);

        await intern.save();

        const branchName = branchEntry.branch?.name || targetBranchId;
        return {
            message: isHeadIntern
                ? `${intern.name} ${intern.lastName} назначен Head Intern в филиале ${branchName}`
                : `${intern.name} ${intern.lastName} снят с должности Head Intern`,
            intern,
        };
    }

    async headInternWarning(headInternId, targetInternId, { ruleId, notes }) {
        if (!ruleId) throw new AppError("ID правила обязателен", 400);

        const headIntern = await Intern.findById(headInternId);
        if (!headIntern) throw new AppError("Стажёр не найден", 404);
        // Check if head intern in any branch
        if (!headIntern.branches.some((b) => b.isHeadIntern)) {
            throw new AppError("Только Head Intern может выдавать предупреждения", 403);
        }

        const targetIntern = await Intern.findById(targetInternId);
        if (!targetIntern) throw new AppError("Целевой стажёр не найден", 404);

        // Check if they share at least one branch where headIntern is actually head
        const headBranchIds = headIntern.branches
            .filter((b) => b.isHeadIntern)
            .map((b) => b.branch.toString());
        const targetBranchIds = targetIntern.branches.map((b) => b.branch.toString());
        const sharedBranch = headBranchIds.some((id) => targetBranchIds.includes(id));

        if (!sharedBranch) {
            throw new AppError("Head Intern может выдавать предупреждения только интернам своего филиала", 403);
        }

        if (headInternId.toString() === targetInternId.toString()) {
            throw new AppError("Нельзя выдать предупреждение самому себе", 400);
        }

        const rule = await Rule.findById(ruleId).select("category title").lean();
        const category = rule?.category || "yellow";

        // ─── Violation bug fix: shtraf berilganda o'zgarish bo'lishi ───
        // 1. Hisoblagich, lastViolationAt, score va turiga qarab daraja
        //    pasaytirish (sariq → yo'q, qizil → -1, qora → -2).
        const { demoted } = applyViolationPenalty(targetIntern, category);

        targetIntern.violations.push({
            ruleId,
            date: new Date(),
            notes: notes || "",
            issuedBy: "headIntern",
            issuedById: headInternId,
            consequenceApplied: demoted
                ? `Daraja pasaytirildi: ${demoted.from} → ${demoted.to}`
                : `Reyting ta'siri: -${PENALTY_WEIGHTS[category] || 0}`,
        });

        // 2. 3+ shtraf bo'lsa weekly plan restricted
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const monthViolations = targetIntern.violations.filter(
            (v) => new Date(v.date) >= monthStart
        ).length;
        if (monthViolations >= 3) {
            targetIntern.weeklyPlan.status = "restricted";
            targetIntern.weeklyPlan.restrictedSince = new Date();
        }

        await targetIntern.save();

        return {
            message: `Предупреждение выдано стажёру ${targetIntern.name} ${targetIntern.lastName}`,
            intern: targetIntern,
            violationsCount: targetIntern.violationsCount,
            score: targetIntern.score,
            demoted,
        };
    }

    async getInternsRating() {
        // Archived and frozen excluded. Interns with missing status (DB recovery) treated as active.
        const interns = await Intern.find({ status: { $nin: ["frozen", "archived"] } })
            .populate("branches.branch", "name telegramLink")
            .populate("branches.mentor", "name lastName");

        // Fetch all rules once to build a ruleId → category map for penalty computation.
        const allRules = await Rule.find({}).select("category").lean();
        const ruleMap = buildRuleMap(allRules);

        const now = new Date();

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

            // 🔹 Shtraf ma'lumotlari
            const penaltyInfo = computePenalties(intern.violations || [], ruleMap);

            if (!gradeConfig) {
                return {
                    _id: intern._id,
                    name: intern.name,
                    lastName: intern.lastName,
                    branches: intern.branches,
                    branch: intern.branches?.[0]?.branch || null,
                    mentor: intern.branches?.[0]?.mentor || null,
                    grade: intern.grade,
                    score: intern.score,
                    attendance: "N/A",
                    rating: "N/A",
                    lessonsPerMonth: null,
                    totalLessonsRequired: null,
                    totalLessonsVisited: totalLessons,
                    penaltyInfo,
                };
            }

            // Норма = уроки за прошедшее время с probationStartDate,
            // но не более полного пробационного срока (trialPeriod месяцев).
            const probationStart = intern.probationStartDate || intern.createdAt;
            const monthsInSystem = (now - new Date(probationStart)) / (1000 * 60 * 60 * 24 * 30);
            const effectiveMonths = Math.max(Math.min(monthsInSystem, gradeConfig.trialPeriod || 1), 0.25);
            const maxLessons = gradeConfig.lessonsPerMonth * effectiveMonths;

            const attendance = maxLessons > 0 ? totalLessons / maxLessons : 0;

            // umumiy reyting formulasi (raw: 0–5)
            const rating = intern.score * 0.7 + attendance * 5 * 0.3;

            const adjustedRating = Math.max(0, rating - penaltyInfo.totalDeduction);

            return {
                _id: intern._id,
                name: intern.name,
                lastName: intern.lastName,
                branches: intern.branches,
                branch: intern.branches?.[0]?.branch || null,
                mentor: intern.branches?.[0]?.mentor || null,
                grade: intern.grade,
                score: intern.score,
                attendance: (attendance * 100).toFixed(1) + "%",
                rating: +adjustedRating.toFixed(2),
                lessonsPerMonth: gradeConfig.lessonsPerMonth,
                totalLessonsRequired: Math.round(maxLessons),
                totalLessonsVisited: totalLessons,
                penaltyInfo,
            };
        });

        withRating.sort((a, b) => b.rating - a.rating);

        return withRating;
    }

    // Self-activation: интерн сам снимает restricted-статус. Лимит 2 раза
    // за календарный месяц (по timezone Asia/Tashkent — см.
    // weeklyPlanService.startOfTashkentMonth). Если лимит исчерпан или
    // статус уже admin_block — кидаем 403, фронт должен скрывать кнопку.
    // На admin override см. clearWeeklyPlanBlock ниже.
    async selfActivateWeeklyPlan(internId) {
        const { _internals } = require("./weeklyPlanService");
        const intern = await Intern.findById(internId);
        if (!intern) throw new AppError("Стажёр не найден", 404);

        const wp = intern.weeklyPlan || {};
        if (wp.status !== "restricted") {
            throw new AppError(
                `Самоактивация недоступна (текущий статус: ${wp.status || "ok"})`,
                400
            );
        }

        const monthStart = _internals.startOfTashkentMonth(new Date());
        const used = (wp.selfActivations || []).filter((a) => {
            const d = a.activatedAt ? new Date(a.activatedAt) : null;
            return d && d >= monthStart;
        }).length;

        if (used >= 2) {
            // Защита от прямого API-вызова — обычно UI скрывает кнопку.
            // Эскалируем в admin_block чтобы состояние было консистентным.
            wp.status = "admin_block";
            intern.weeklyPlan = wp;
            await intern.save();
            throw new AppError(
                "Лимит самоактиваций исчерпан (2/2). Обратись к менеджеру.",
                403
            );
        }

        wp.selfActivations = wp.selfActivations || [];
        wp.selfActivations.push({
            activatedAt: new Date(),
            weekStartAt: wp.currentWeekStartAt || null,
            deficitAtTime: Math.max(
                0,
                (wp.currentWeekTarget || 0) - (wp.currentWeekConfirmed || 0)
            ),
            targetAtTime: wp.currentWeekTarget || 0,
            notes: "",
        });
        wp.status = "ok";
        wp.restrictedSince = null;

        intern.weeklyPlan = wp;
        await intern.save();

        return {
            message: "Аккаунт реактивирован. Постарайся выполнить план до воскресенья.",
            weeklyPlan: wp,
            activationsLeft: Math.max(0, 2 - (used + 1)),
        };
    }

    // Admin override — сбрасывает status в ok при любом текущем состоянии.
    // По выбору пользователя (open-question #4) — selfActivations за месяц
    // НЕ обнуляются: интерн продолжит копить счётчик до конца месяца.
    // Streak тоже не восстанавливается (=0).
    async clearWeeklyPlanBlock(internId) {
        const intern = await Intern.findById(internId);
        if (!intern) throw new AppError("Стажёр не найден", 404);

        const wp = intern.weeklyPlan || {};
        const prevStatus = wp.status || "ok";
        wp.status = "ok";
        wp.restrictedSince = null;
        intern.weeklyPlan = wp;
        await intern.save();

        return {
            message: `Блок снят (был: ${prevStatus} → ok)`,
            weeklyPlan: wp,
        };
    }
}
module.exports = new InternService();
