const GRADES = ["junior", "strongJunior", "middle", "strongMiddle", "senior"];

// `points` — badge qanchalik qiyin/mas'uliyatli ekanini bildiradi (1 = oddiy, 10 = eng og'ir).
// XP va reytingdagi badge bonusi shu qiymatga qarab hisoblanadi — barcha badge'lar
// endi bir xil "og'irlikda" emas.
const BADGE_DEFINITIONS = [
  // ── Lessons ──
  {
    key: "first_lesson",
    name: { ru: "Первый урок", uz: "Birinchi dars" },
    icon: "🎯",
    description: { ru: "Добавили первый урок", uz: "Birinchi darsingizni qo'shdingiz" },
    category: "lessons",
    points: 1,
    check: (intern, stats) => stats.totalLessons >= 1,
  },
  {
    key: "lesson_10",
    name: { ru: "10 уроков", uz: "10 ta dars" },
    icon: "📚",
    description: { ru: "Посетили 10 уроков", uz: "10 ta darsga qatnashdingiz" },
    category: "lessons",
    points: 2,
    check: (intern, stats) => stats.totalLessons >= 10,
  },
  {
    key: "lesson_50",
    name: { ru: "50 уроков", uz: "50 ta dars" },
    icon: "📖",
    description: { ru: "Посетили 50 уроков", uz: "50 ta darsga qatnashdingiz" },
    category: "lessons",
    points: 4,
    check: (intern, stats) => stats.totalLessons >= 50,
  },
  {
    key: "lesson_100",
    name: { ru: "100 уроков", uz: "100 ta dars" },
    icon: "🏅",
    description: { ru: "Посетили 100 уроков", uz: "100 ta darsga qatnashdingiz" },
    category: "lessons",
    points: 6,
    check: (intern, stats) => stats.totalLessons >= 100,
  },
  {
    key: "plan_100",
    name: { ru: "План выполнен", uz: "Reja bajarildi" },
    icon: "✅",
    description: { ru: "Выполнили месячный план на 100%", uz: "Oylik rejani 100% bajardingiz" },
    category: "lessons",
    points: 3,
    check: (intern, stats) => stats.planCompletion >= 1,
  },
  {
    key: "plan_120",
    name: { ru: "Сверхплан", uz: "Rejadan oshib" },
    icon: "🚀",
    description: { ru: "Перевыполнили план на 120%", uz: "Rejani 120% ga oshirib bajardingiz" },
    category: "lessons",
    points: 5,
    check: (intern, stats) => stats.planCompletion >= 1.2,
  },
  {
    key: "marathoner",
    name: { ru: "Марафонец", uz: "Marafonchi" },
    icon: "🏃",
    description: { ru: "Посетили 50 уроков за месяц", uz: "Bir oyda 50 ta darsga qatnashdingiz" },
    category: "lessons",
    points: 5,
    check: (intern, stats) => stats.monthlyLessons >= 50,
  },
  {
    key: "discipline_king",
    name: { ru: "Король дисциплины", uz: "Intizom qiroli" },
    icon: "👑",
    description: {
      ru: "60+ уроков за месяц (2 урока в день без остановки)",
      uz: "1 oy to'xtamay kuniga 2 tadan — 60+ dars",
    },
    category: "lessons",
    points: 7,
    check: (intern, stats) => stats.monthlyLessons >= 60,
  },
  {
    key: "terminator",
    name: { ru: "Терминатор", uz: "Terminator" },
    icon: "🤖",
    description: {
      ru: "120+ уроков за месяц (4 урока в день без остановки)",
      uz: "1 oy to'xtamay kuniga 4 tadan — 120+ dars",
    },
    category: "lessons",
    points: 10,
    check: (intern, stats) => stats.monthlyLessons >= 120,
  },
  {
    key: "plan_150",
    name: { ru: "Сверхплан 150%", uz: "Rejadan 150% oshib" },
    icon: "💥",
    description: { ru: "Перевыполнили план на 150%", uz: "Rejani 150% ga oshirib bajardingiz" },
    category: "lessons",
    points: 7,
    check: (intern, stats) => stats.planCompletion >= 1.5,
  },
  {
    key: "lesson_200",
    name: { ru: "200 уроков", uz: "200 ta dars" },
    icon: "📚",
    description: { ru: "Посетили 200 уроков", uz: "200 ta darsga qatnashdingiz" },
    category: "lessons",
    points: 8,
    check: (intern, stats) => stats.totalLessons >= 200,
  },
  {
    key: "lesson_500",
    name: { ru: "500 уроков", uz: "500 ta dars" },
    icon: "🏛️",
    description: { ru: "Посетили 500 уроков", uz: "500 ta darsga qatnashdingiz" },
    category: "lessons",
    points: 10,
    check: (intern, stats) => stats.totalLessons >= 500,
  },

  // ── Streaks ──
  {
    key: "streak_3",
    name: { ru: "3 дня подряд", uz: "3 kun ketma-ket" },
    icon: "🔥",
    description: { ru: "3 дня подряд посещали уроки", uz: "3 kun ketma-ket darsga qatnashdingiz" },
    category: "streak",
    points: 1,
    check: (intern) => intern.currentStreak >= 3,
  },
  {
    key: "streak_7",
    name: { ru: "Неделя без пропуска", uz: "1 hafta uzluksiz" },
    icon: "🔥",
    description: { ru: "Неделя без пропуска уроков", uz: "Bir hafta uzluksiz qatnashdingiz" },
    category: "streak",
    points: 2,
    check: (intern) => intern.currentStreak >= 7 || intern.longestStreak >= 7,
  },
  {
    key: "streak_14",
    name: { ru: "2 недели подряд", uz: "2 hafta ketma-ket" },
    icon: "💫",
    description: { ru: "2 недели подряд посещали уроки", uz: "2 hafta ketma-ket qatnashdingiz" },
    category: "streak",
    points: 4,
    check: (intern) => intern.currentStreak >= 14 || intern.longestStreak >= 14,
  },
  {
    key: "streak_30",
    name: { ru: "Месяц без пропуска", uz: "1 oy uzluksiz" },
    icon: "💎",
    description: { ru: "Месяц без пропуска уроков", uz: "Bir oy uzluksiz qatnashdingiz" },
    category: "streak",
    points: 6,
    check: (intern) => intern.currentStreak >= 30 || intern.longestStreak >= 30,
  },
  {
    key: "streak_60",
    name: { ru: "2 месяца подряд", uz: "2 oy ketma-ket" },
    icon: "🗓️",
    description: { ru: "2 месяца подряд посещали уроки", uz: "2 oy ketma-ket qatnashdingiz" },
    category: "streak",
    points: 8,
    check: (intern) => intern.currentStreak >= 60 || intern.longestStreak >= 60,
  },
  {
    key: "streak_100",
    name: { ru: "100 дней подряд", uz: "100 kun ketma-ket" },
    icon: "🏆",
    description: { ru: "100 дней подряд посещали уроки", uz: "100 kun ketma-ket qatnashdingiz" },
    category: "streak",
    points: 10,
    check: (intern) => intern.currentStreak >= 100 || intern.longestStreak >= 100,
  },
  {
    key: "weekly_4",
    name: { ru: "Месяц на плане", uz: "1 oy rejada" },
    icon: "📅",
    description: { ru: "4 недели подряд выполняли план", uz: "4 hafta ketma-ket rejani bajardingiz" },
    category: "streak",
    points: 4,
    check: (intern) => (intern.weeklyPlan?.streakWeeks || 0) >= 4,
  },

  // ── Quality ──
  {
    key: "excellent",
    name: { ru: "Отличник", uz: "A'lochi" },
    icon: "⭐",
    description: { ru: "Средняя оценка 4.5+ и 10+ отзывов", uz: "O'rtacha 4.5+ baho va 10+ fikr" },
    category: "quality",
    points: 6,
    check: (intern) =>
      (intern.score || 0) >= 4.5 && (intern.feedbacks?.length || 0) >= 10,
  },
  {
    key: "good_student",
    name: { ru: "Хорошист", uz: "Yaxshi o'quvchi" },
    icon: "👍",
    description: { ru: "Средняя оценка 4.0+ и 5+ отзывов", uz: "O'rtacha 4.0+ baho va 5+ fikr" },
    category: "quality",
    points: 3,
    check: (intern) =>
      (intern.score || 0) >= 4.0 && (intern.feedbacks?.length || 0) >= 5,
  },
  {
    key: "perfect_score",
    name: { ru: "Идеальная оценка", uz: "Mukammal baho" },
    icon: "💯",
    description: { ru: "Все оценки 5 звёзд (3+ отзывов)", uz: "Barcha darslar 5 baho (3+ fikr)" },
    category: "quality",
    points: 8,
    check: (intern) =>
      (intern.score || 0) >= 5 && (intern.feedbacks?.length || 0) >= 3,
  },
  {
    key: "feedback_25",
    name: { ru: "25 отзывов", uz: "25 ta fikr" },
    icon: "💬",
    description: { ru: "Получили 25 отзывов от менторов", uz: "Mentorlardan 25 ta fikr oldingiz" },
    category: "quality",
    points: 4,
    check: (intern) => (intern.feedbacks?.length || 0) >= 25,
  },
  {
    key: "feedback_50",
    name: { ru: "50 отзывов", uz: "50 ta fikr" },
    icon: "🗣️",
    description: { ru: "Получили 50 отзывов от менторов", uz: "Mentorlardan 50 ta fikr oldingiz" },
    category: "quality",
    points: 7,
    check: (intern) => (intern.feedbacks?.length || 0) >= 50,
  },

  // ── Grade ──
  {
    key: "promoted",
    name: { ru: "Первое повышение", uz: "Birinchi ko'tarilish" },
    icon: "📈",
    description: { ru: "Получили первое повышение грейда", uz: "Birinchi marta daraja ko'tarildingiz" },
    category: "grade",
    points: 2,
    check: (intern) => (intern.promotionHistory?.length || 0) > 0,
  },
  {
    key: "strong_junior",
    name: { ru: "Strong Junior", uz: "Strong Junior" },
    icon: "💪",
    description: { ru: "Достигли уровня Strong Junior", uz: "Strong Junior darajasiga yetdingiz" },
    category: "grade",
    points: 3,
    check: (intern) => GRADES.indexOf(intern.grade) >= 1,
  },
  {
    key: "middle",
    name: { ru: "Middle", uz: "Middle" },
    icon: "🎖️",
    description: { ru: "Достигли уровня Middle", uz: "Middle darajasiga yetdingiz" },
    category: "grade",
    points: 5,
    check: (intern) => GRADES.indexOf(intern.grade) >= 2,
  },
  {
    key: "strong_middle",
    name: { ru: "Strong Middle", uz: "Strong Middle" },
    icon: "🏆",
    description: { ru: "Достигли уровня Strong Middle", uz: "Strong Middle darajasiga yetdingiz" },
    category: "grade",
    points: 7,
    check: (intern) => GRADES.indexOf(intern.grade) >= 3,
  },
  {
    key: "senior",
    name: { ru: "Senior", uz: "Senior" },
    icon: "👑",
    description: { ru: "Достигли уровня Senior", uz: "Senior darajasiga yetdingiz" },
    category: "grade",
    points: 10,
    check: (intern) => GRADES.indexOf(intern.grade) >= 4,
  },
  {
    key: "double_promotion",
    name: { ru: "Дважды повышен", uz: "Ikki marta ko'tarilgan" },
    icon: "🚀",
    description: { ru: "Повысили грейд дважды", uz: "Ikki marta daraja ko'tarildingiz" },
    category: "grade",
    points: 5,
    check: (intern) => (intern.promotionHistory?.length || 0) >= 2,
  },

  // ── Special ──
  {
    key: "clean_record",
    name: { ru: "Чистая репутация", uz: "Toza obro'" },
    icon: "🛡️",
    description: { ru: "Без нарушений 30 дней и 5+ отзывов", uz: "30 kun shtrafsiz va 5+ fikr" },
    category: "special",
    points: 3,
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
    description: { ru: "Вошли в тройку лидеров рейтинга", uz: "Reytingda top-3 ga kirdingiz" },
    category: "special",
    points: 8,
    check: (intern, stats) => stats.rank > 0 && stats.rank <= 3,
  },
  {
    key: "helper_1",
    name: { ru: "Первый помощник", uz: "Birinchi yordamchi" },
    icon: "🤝",
    description: { ru: "Помогли первому ученику", uz: "Birinchi o'quvchiga yordam berdingiz" },
    category: "special",
    points: 1,
    check: (intern) => (intern.helpedStudents || 0) >= 1,
  },
  {
    key: "helper_10",
    name: { ru: "Наставник", uz: "Ustoz" },
    icon: "🧑‍🏫",
    description: { ru: "Помогли 10 ученикам", uz: "10 o'quvchiga yordam berdingiz" },
    category: "special",
    points: 5,
    check: (intern) => (intern.helpedStudents || 0) >= 10,
  },
  {
    key: "helper_25",
    name: { ru: "Легенда наставничества", uz: "Mentorlik afsonasi" },
    icon: "👑",
    description: { ru: "Помогли 25 ученикам", uz: "25 o'quvchiga yordam berdingiz" },
    category: "special",
    points: 8,
    check: (intern) => (intern.helpedStudents || 0) >= 25,
  },
  {
    key: "profile_complete",
    name: { ru: "Прокачанный профиль", uz: "To'liq profil" },
    icon: "🎨",
    description: { ru: "Добавили фото профиля и сферу", uz: "Profil rasmi va yo'nalish qo'shdingiz" },
    category: "special",
    points: 1,
    check: (intern) => Boolean(intern.profilePhoto) && Boolean(intern.sphere),
  },
  {
    key: "bonus_collector",
    name: { ru: "Бонусный охотник", uz: "Bonus ovchisi" },
    icon: "🎁",
    description: { ru: "Получили бонусные уроки", uz: "Bonus dars oldingiz" },
    category: "special",
    points: 1,
    check: (intern) => (intern.bonusLessons?.length || 0) > 0,
  },
  {
    key: "clean_month",
    name: { ru: "Чистый месяц", uz: "Toza oy" },
    icon: "🛡️",
    description: { ru: "30 дней без нарушений и 10+ отзывов", uz: "30 kun shtrafsiz va 10+ fikr" },
    category: "special",
    points: 5,
    check: (intern) => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      const recentViolations = (intern.violations || []).filter(
        (v) => v.date && new Date(v.date) > thirtyDaysAgo
      );
      return recentViolations.length === 0 && (intern.feedbacks?.length || 0) >= 10;
    },
  },
  {
    key: "veteran",
    name: { ru: "Ветеран", uz: "Faxriy" },
    icon: "🕰️",
    description: { ru: "В системе больше 6 месяцев", uz: "Tizimda 6 oydan beri intern siz" },
    category: "special",
    points: 4,
    check: (intern) => {
      const joined = intern.dateJoined || intern.createdAt;
      if (!joined) return false;
      const sixMonths = 6 * 30 * 24 * 3600 * 1000;
      return Date.now() - new Date(joined).getTime() >= sixMonths;
    },
  },
];

module.exports = BADGE_DEFINITIONS;
