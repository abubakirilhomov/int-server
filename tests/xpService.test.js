const { calculateLevel, xpForLevel, xpForNextLevel, XP_REWARDS } = require("../src/services/xpService");

describe("XP System", () => {
  test("level 1 at 0 XP", () => {
    expect(calculateLevel(0)).toBe(1);
  });

  test("level 2 at 100 XP", () => {
    expect(calculateLevel(100)).toBe(2);
  });

  test("level 3 at 400 XP", () => {
    expect(calculateLevel(400)).toBe(3);
  });

  test("level formula is consistent", () => {
    for (let lvl = 1; lvl <= 10; lvl++) {
      const xpNeeded = xpForLevel(lvl);
      expect(calculateLevel(xpNeeded)).toBe(lvl);
    }
  });

  test("XP rewards are positive numbers", () => {
    expect(XP_REWARDS.lessonCreated).toBeGreaterThan(0);
    expect(XP_REWARDS.fiveStarFeedback).toBeGreaterThan(0);
    expect(XP_REWARDS.badgeEarned).toBeGreaterThan(0);
  });

  test("xpForNextLevel > xpForLevel", () => {
    for (let lvl = 1; lvl <= 10; lvl++) {
      expect(xpForNextLevel(lvl)).toBeGreaterThan(xpForLevel(lvl));
    }
  });
});
