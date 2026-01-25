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

        // 3. Подтягиваем данные о филиале
        {
            $lookup: {
                from: "branches",
                localField: "branch",
                foreignField: "_id",
                as: "branchDetails"
            }
        },
        { $unwind: { path: "$branchDetails", preserveNullAndEmptyArrays: true } },

        // 4. Формируем плоскую структуру
        {
            $project: {
                internId: "$_id",
                internName: { $concat: ["$name", " ", "$lastName"] },
                branchId: "$branch",
                branchName: "$branchDetails.name",
                ruleTitle: "$ruleDetails.title",
                category: "$ruleDetails.category",
                date: "$violations.date",
                notes: "$violations.notes",
                consequenceApplied: "$violations.consequenceApplied",
                grade: "$grade"
            }
        }
    ];

    // 5. Фильтрация (Match)
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

    // 6. Сортировка по дате (сначала новые)
    pipeline.push({ $sort: { date: -1 } });

    const violations = await Intern.aggregate(pipeline);

    res.json(violations);
});
