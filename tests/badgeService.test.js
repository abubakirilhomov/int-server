const BADGE_DEFINITIONS = require("../src/config/badges");

describe("Badge Definitions", () => {
  test("all badges have required fields", () => {
    for (const badge of BADGE_DEFINITIONS) {
      expect(badge.key).toBeTruthy();
      expect(badge.icon).toBeTruthy();
      expect(badge.category).toBeTruthy();
      expect(typeof badge.check).toBe("function");
      expect(badge.name.ru).toBeTruthy();
      expect(badge.name.uz).toBeTruthy();
    }
  });

  test("unique badge keys", () => {
    const keys = BADGE_DEFINITIONS.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("valid categories", () => {
    const validCats = ["lessons", "streak", "quality", "grade", "special"];
    for (const badge of BADGE_DEFINITIONS) {
      expect(validCats).toContain(badge.category);
    }
  });

  test("first_lesson badge triggers on 1 total lesson", () => {
    const badge = BADGE_DEFINITIONS.find((b) => b.key === "first_lesson");
    expect(badge.check({}, { totalLessons: 0 })).toBe(false);
    expect(badge.check({}, { totalLessons: 1 })).toBe(true);
  });

  test("streak_7 badge triggers on 7-day streak", () => {
    const badge = BADGE_DEFINITIONS.find((b) => b.key === "streak_7");
    expect(badge.check({ currentStreak: 3, longestStreak: 3 }, {})).toBe(false);
    expect(badge.check({ currentStreak: 7, longestStreak: 7 }, {})).toBe(true);
    expect(badge.check({ currentStreak: 0, longestStreak: 7 }, {})).toBe(true);
  });

  test("excellent badge requires score >= 4.5 and >= 10 feedbacks", () => {
    const badge = BADGE_DEFINITIONS.find((b) => b.key === "excellent");
    expect(badge.check({ score: 4.5, feedbacks: new Array(10) }, {})).toBe(true);
    expect(badge.check({ score: 4.4, feedbacks: new Array(10) }, {})).toBe(false);
    expect(badge.check({ score: 4.5, feedbacks: new Array(9) }, {})).toBe(false);
  });

  test("plan_100 triggers at 100% plan completion", () => {
    const badge = BADGE_DEFINITIONS.find((b) => b.key === "plan_100");
    expect(badge.check({}, { planCompletion: 0.99 })).toBe(false);
    expect(badge.check({}, { planCompletion: 1.0 })).toBe(true);
  });
});
