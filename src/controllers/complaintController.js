const mongoose = require("mongoose");
const Intern = require("../models/internModel");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");

// Жалобы живут внутри Intern.complaints. Разворачиваем их в плоский список —
// так же, как violationController делает с Intern.violations.
exports.getComplaints = catchAsync(async (req, res) => {
    const { branch, category, status, startDate, endDate } = req.query;

    // Фильтр по филиалу ставим ДО $unwind: интерн может состоять в нескольких
    // филиалах, и жалоба относится к интерну целиком. (В отчёте по нарушениям
    // фильтр стоит на primaryBranch и вторые филиалы теряются.)
    const internMatch = { status: { $ne: "archived" } };
    if (branch && branch !== "all") {
        internMatch["branches.branch"] = new mongoose.Types.ObjectId(branch);
    }

    const pipeline = [
        { $match: internMatch },
        { $unwind: "$complaints" },

        // Правила, на которые ссылается жалоба (их может быть несколько).
        {
            $lookup: {
                from: "rules",
                localField: "complaints.ruleIds",
                foreignField: "_id",
                as: "ruleDetails",
            },
        },

        // Автор жалобы — branch manager или админ, обе роли лежат в mentors.
        {
            $lookup: {
                from: "mentors",
                localField: "complaints.createdById",
                foreignField: "_id",
                as: "authorDetails",
            },
        },
        { $unwind: { path: "$authorDetails", preserveNullAndEmptyArrays: true } },

        { $addFields: { primaryBranchId: { $arrayElemAt: ["$branches.branch", 0] } } },
        {
            $lookup: {
                from: "branches",
                localField: "primaryBranchId",
                foreignField: "_id",
                as: "branchDetails",
            },
        },
        { $unwind: { path: "$branchDetails", preserveNullAndEmptyArrays: true } },

        {
            $project: {
                _id: 0,
                complaintId: "$complaints._id",
                internId: "$_id",
                internName: { $concat: ["$name", " ", "$lastName"] },
                grade: "$grade",
                branchId: "$primaryBranchId",
                branchName: "$branchDetails.name",
                text: "$complaints.text",
                category: "$complaints.category",
                status: "$complaints.status",
                date: "$complaints.createdAt",
                ruleTitles: "$ruleDetails.title",
                createdByRole: "$complaints.createdByRole",
                // createdByName денормализован при создании; на случай пустого
                // значения (старые записи) подставляем имя из lookup.
                createdByName: {
                    $let: {
                        vars: { stored: { $trim: { input: { $ifNull: ["$complaints.createdByName", ""] } } } },
                        in: {
                            $cond: [
                                { $gt: [{ $strLenCP: "$$stored" }, 0] },
                                "$$stored",
                                {
                                    $cond: [
                                        { $ifNull: ["$authorDetails", false] },
                                        {
                                            $trim: {
                                                input: {
                                                    $concat: [
                                                        "$authorDetails.name",
                                                        " ",
                                                        { $ifNull: ["$authorDetails.lastName", ""] },
                                                    ],
                                                },
                                            },
                                        },
                                        null,
                                    ],
                                },
                            ],
                        },
                    },
                },
            },
        },
    ];

    const postMatch = {};
    if (category && category !== "all") postMatch.category = category;
    if (status && status !== "all") postMatch.status = status;
    if (startDate || endDate) {
        postMatch.date = {};
        if (startDate) postMatch.date.$gte = new Date(startDate);
        if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            postMatch.date.$lte = end;
        }
    }
    if (Object.keys(postMatch).length > 0) pipeline.push({ $match: postMatch });

    pipeline.push({ $sort: { date: -1 } });

    res.json(await Intern.aggregate(pipeline));
});

// Отметить жалобу разобранной (или вернуть в new). Схема уже знает
// complaints.status: ["new", "reviewed"] — до сих пор поле никто не менял.
exports.setComplaintStatus = catchAsync(async (req, res) => {
    const { internId, complaintId } = req.params;
    const { status } = req.body;

    if (!["new", "reviewed"].includes(status)) {
        throw new AppError("Недопустимый статус жалобы", 400);
    }

    const intern = await Intern.findById(internId);
    if (!intern) throw new AppError("Стажёр не найден", 404);

    const complaint = intern.complaints.id(complaintId);
    if (!complaint) throw new AppError("Жалоба не найдена", 404);

    complaint.status = status;
    await intern.save();

    res.json({ message: "Статус жалобы обновлён", complaintId, status });
});
