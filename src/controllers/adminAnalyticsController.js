const Intern = require("../models/internModel");
const Lesson = require("../models/lessonModel");
const Mentor = require("../models/mentorModel");

exports.getAnalytics = async (req, res) => {
  try {
    const now = new Date();

    // ── 1. Grade distribution ──
    const gradeDistribution = await Intern.aggregate([
      { $group: { _id: "$grade", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    // ── 2. Monthly lesson trend (last 6 months) ──
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const monthlyLessons = await Lesson.aggregate([
      { $match: { date: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: {
            year: { $year: "$date" },
            month: { $month: "$date" },
            status: "$status",
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    // Reshape into { month, confirmed, pending }
    const monthMap = {};
    for (const r of monthlyLessons) {
      const key = `${r._id.year}-${String(r._id.month).padStart(2, "0")}`;
      if (!monthMap[key]) monthMap[key] = { month: key, confirmed: 0, pending: 0 };
      if (r._id.status === "confirmed") monthMap[key].confirmed = r.count;
      else monthMap[key].pending = r.count;
    }
    const monthlyTrend = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month));

    // ── 3. Branch comparison ──
    const branchStats = await Intern.aggregate([
      { $unwind: "$branches" },
      {
        $lookup: {
          from: "branches",
          localField: "branches.branch",
          foreignField: "_id",
          as: "branchInfo",
        },
      },
      { $unwind: { path: "$branchInfo", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: "$branchInfo.name",
          internCount: { $sum: 1 },
          avgScore: { $avg: { $ifNull: ["$score", 0] } },
        },
      },
      { $match: { _id: { $ne: null } } },
      { $sort: { avgScore: -1 } },
    ]);

    // ── 4. Top interns by score ──
    const topInterns = await Intern.find({ score: { $gt: 0 } })
      .select("name lastName score grade profilePhoto")
      .sort({ score: -1 })
      .limit(5)
      .lean();

    // ── 5. Summary stats ──
    const totalInterns = await Intern.countDocuments();
    const totalMentors = await Mentor.countDocuments();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lessonsThisMonth = await Lesson.countDocuments({ date: { $gte: thisMonthStart } });
    const confirmedThisMonth = await Lesson.countDocuments({
      date: { $gte: thisMonthStart },
      status: "confirmed",
    });

    // ── 6. Violation trend (last 6 months) ──
    const violationTrend = await Intern.aggregate([
      { $unwind: "$violations" },
      { $match: { "violations.date": { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: {
            year: { $year: "$violations.date" },
            month: { $month: "$violations.date" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    res.json({
      gradeDistribution,
      monthlyTrend,
      branchStats,
      topInterns,
      violationTrend: violationTrend.map((v) => ({
        month: `${v._id.year}-${String(v._id.month).padStart(2, "0")}`,
        count: v.count,
      })),
      summary: {
        totalInterns,
        totalMentors,
        lessonsThisMonth,
        confirmedThisMonth,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
