
const grades = {
  junior: {
    lessonsPerMonth: 24,
    trialPeriod: 1,
    plus: []
  },
  strongJunior: {
    lessonsPerMonth: 40,
    trialPeriod: 1,
    plus: ["Qolgan darslarga kirish imkoniyati"]
  },
  middle: {
    lessonsPerMonth: 50,
    trialPeriod: 2,
    plus: [
      "Qolgan darslarga kirish imkoniyati",
      "Oshxonadan foydalanish imkoniyat"
    ]
  },
  strongMiddle: {
    lessonsPerMonth: 60,
    trialPeriod: 2,
    plus: [
      "Qolgan darslarga kirish imkoniyati",
      "Oshxonadan foydalanish imkoniyat",
      "Dam olish xonasidan foydalanish imkoniyati"
    ]
  },
  senior: {
    lessonsPerMonth: 80,
    trialPeriod: 3,
    plus: [
      "Qolgan darslarga kirish imkoniyati",
      "Oshxonadan foydalanish imkoniyat",
      "Dam olish xonasidan foydalanish imkoniyati",
      "MARS xodimlari uchun treninglarda qatnashish",
      "Academy event-tambuildinglarda qatnashish"
    ]
  }
};

module.exports = grades;
