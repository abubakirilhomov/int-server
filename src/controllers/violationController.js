const Intern = require("../models/internModel");
const catchAsync = require("../utils/catchAsync");

exports.getViolations = catchAsync(async (req, res) => {
    const { branch, startDate, endDate, category } = req.query;

    const pipeline = [
        // 1. Разворачиваем массив violations для каждого интерна
        { $unwind: "$violations" },

        // 2. Подтягиваем данные о правиле (Rule)
        {
            $lookup: {
                from: "rules",
                localField: "violations.ruleId",
                foreignField: "_id",
                as: "ruleDetails"
            }
        },
        { $unwind: { path: "$ruleDetails", preserveNullAndEmptyArrays: true } },

        // 3. Добавляем поле primaryBranch = первый элемент branches.branch
        {
            $addFields: {
                primaryBranchId: { $arrayElemAt: ["$branches.branch", 0] }
            }
        },

        // 4. Подтягиваем данные о филиале
        {
            $lookup: {
                from: "branches",
                localField: "primaryBranchId",
                foreignField: "_id",
                as: "branchDetails"
            }
        },
        { $unwind: { path: "$branchDetails", preserveNullAndEmptyArrays: true } },

        // 5. Подтягиваем данные о менторе, который выдал нарушение
        {
            $lookup: {
                from: "mentors",
                localField: "violations.issuedById",
                foreignField: "_id",
                as: "issuerDetails"
            }
        },
        { $unwind: { path: "$issuerDetails", preserveNullAndEmptyArrays: true } },

        // 6. Формируем плоскую структуру
        {
            $project: {
                internId: "$_id",
                internName: { $concat: ["$name", " ", "$lastName"] },
                branchId: "$primaryBranchId",
                branchName: "$branchDetails.name",
                ruleTitle: "$ruleDetails.title",
                category: "$ruleDetails.category",
                date: "$violations.date",
                notes: "$violations.notes",
                consequenceApplied: "$violations.consequenceApplied",
                grade: "$grade",
                issuedBy: "$violations.issuedBy",
                issuedByName: {
                    $cond: [
                        { $ifNull: ["$issuerDetails", false] },
                        { $concat: ["$issuerDetails.name", " ", { $ifNull: ["$issuerDetails.lastName", ""] }] },
                        null
                    ]
                }
            }
        }
    ];

    // 6. Фильтрация (Match)
    const matchStage = {};

    if (branch && branch !== 'all') {
        matchStage["branchId"] = { $eq: new require('mongoose').Types.ObjectId(branch) };
    }

    if (category && category !== 'all') {
        matchStage["category"] = category;
    }

    if (startDate || endDate) {
        matchStage["date"] = {};
        if (startDate) matchStage["date"].$gte = new Date(startDate);
        if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            matchStage["date"].$lte = end;
        }
    }

    if (Object.keys(matchStage).length > 0) {
        pipeline.push({ $match: matchStage });
    }

    // 7. Сортировка по дате (сначала новые)
    pipeline.push({ $sort: { date: -1 } });

    const violations = await Intern.aggregate(pipeline);

    res.json(violations);
});
