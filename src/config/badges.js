const GRADES = ["junior", "strongJunior", "middle", "strongMiddle", "senior"];

const BADGE_DEFINITIONS = [
  // ── Lessons ──
  {
    key: "first_lesson",
    name: { ru: "Первый урок", uz: "Birinchi dars" },
    icon: "🎯",
    category: "lessons",
    check: (intern, stats) => stats.totalLessons >= 1,
  },
  {
    key: "lesson_10",
    name: { ru: "10 уроков", uz: "10 ta dars" },
    icon: "📚",
    category: "lessons",
    check: (intern, stats) => stats.totalLessons >= 10,
  },
  {
    key: "lesson_50",
    name: { ru: "50 уроков", uz: "50 ta dars" },
    icon: "📖",
    category: "lessons",
    check: (intern, stats) => stats.totalLessons >= 50,
  },
  {
    key: "lesson_100",
    name: { ru: "100 уроков", uz: "100 ta dars" },
    icon: "🏅",
    category: "lessons",
    check: (intern, stats) => stats.totalLessons >= 100,
  },
  {
    key: "plan_100",
    name: { ru: "План выполнен", uz: "Reja bajarildi" },
    icon: "✅",
    category: "lessons",
    check: (intern, stats) => stats.planCompletion >= 1,
  },
  {
    key: "plan_120",
    name: { ru: "Сверхплан", uz: "Rejadan oshib" },
    icon: "🚀",
    category: "lessons",
    check: (intern, stats) => stats.planCompletion >= 1.2,
  },
  {
    key: "marathoner",
    name: { ru: "Марафонец", uz: "Marafonchi" },
    icon: "🏃",
    category: "lessons",
    check: (intern, stats) => stats.monthlyLessons >= 50,
  },

  // ── Streaks ──
  {
    key: "streak_3",
    name: { ru: "3 дня подряд", uz: "3 kun ketma-ket" },
    icon: "🔥",
    category: "streak",
    check: (intern) => intern.currentStreak >= 3,
  },
  {
    key: "streak_7",
    name: { ru: "Неделя без пропуска", uz: "1 hafta uzluksiz" },
    icon: "🔥",
    category: "streak",
    check: (intern) => intern.currentStreak >= 7 || intern.longestStreak >= 7,
  },
  {
    key: "streak_14",
    name: { ru: "2 недели подряд", uz: "2 hafta ketma-ket" },
    icon: "💫",
    category: "streak",
    check: (intern) => intern.currentStreak >= 14 || intern.longestStreak >= 14,
  },
  {
    key: "streak_30",
    name: { ru: "Месяц без пропуска", uz: "1 oy uzluksiz" },
    icon: "💎",
    category: "streak",
    check: (intern) => intern.currentStreak >= 30 || intern.longestStreak >= 30,
  },

  // ── Quality ──
  {
    key: "excellent",
    name: { ru: "Отличник", uz: "A'lochi" },
    icon: "⭐",
    category: "quality",
    check: (intern) =>
      (intern.score || 0) >= 4.5 && (intern.feedbacks?.length || 0) >= 10,
  },
  {
    key: "good_student",
    name: { ru: "Хорошист", uz: "Yaxshi o'quvchi" },
    icon: "👍",
    category: "quality",
    check: (intern) =>
      (intern.score || 0) >= 4.0 && (intern.feedbacks?.length || 0) >= 5,
  },

  // ── Grade ──
  {
    key: "promoted",
    name: { ru: "Первое повышение", uz: "Birinchi ko'tarilish" },
    icon: "📈",
    category: "grade",
    check: (intern) => (intern.promotionHistory?.length || 0) > 0,
  },
  {
    key: "strong_junior",
    name: { ru: "Strong Junior", uz: "Strong Junior" },
    icon: "💪",
    category: "grade",
    check: (intern) => GRADES.indexOf(intern.grade) >= 1,
  },
  {
    key: "middle",
    name: { ru: "Middle", uz: "Middle" },
    icon: "🎖️",
    category: "grade",
    check: (intern) => GRADES.indexOf(intern.grade) >= 2,
  },
  {
    key: "strong_middle",
    name: { ru: "Strong Middle", uz: "Strong Middle" },
    icon: "🏆",
    category: "grade",
    check: (intern) => GRADES.indexOf(intern.grade) >= 3,
  },
  {
    key: "senior",
    name: { ru: "Senior", uz: "Senior" },
    icon: "👑",
    category: "grade",
    check: (intern) => GRADES.indexOf(intern.grade) >= 4,
  },

  // ── Special ──
  {
    key: "clean_record",
    name: { ru: "Чистая репутация", uz: "Toza obro'" },
    icon: "🛡️",
    category: "special",
    check: (intern) => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      const recentViolations = (intern.violations || []).filter(
        (v) => v.date && new Date(v.date) > thirtyDaysAgo
      );
      return recentViolations.length === 0 && (intern.feedbacks?.length || 0) >= 5;
    },
  },
  {
    key: "top_3",
    name: { ru: "Топ-3 рейтинга", uz: "Top-3 reyting" },
    icon: "🏆",
    category: "special",
    check: (intern, stats) => stats.rank > 0 && stats.rank <= 3,
  },
];

module.exports = BADGE_DEFINITIONS;
