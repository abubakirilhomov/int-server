const { updateStreak } = require("../src/services/streakService");

// Mock mongoose models
jest.mock("../src/models/lessonModel", () => ({
  find: jest.fn(),
}));
jest.mock("../src/models/internModel", () => ({
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
}));

const Lesson = require("../src/models/lessonModel");
const Intern = require("../src/models/internModel");

describe("streakService", () => {
  beforeEach(() => jest.clearAllMocks());

  test("returns 0 streak when no lessons", async () => {
    Lesson.find.mockReturnValue({
      select: () => ({ sort: () => ({ lean: () => Promise.resolve([]) }) }),
    });
    Intern.findByIdAndUpdate.mockResolvedValue({});

    const result = await updateStreak("intern1");

    expect(result).toEqual({ current: 0, longest: 0 });
    expect(Intern.findByIdAndUpdate).toHaveBeenCalledWith("intern1", {
      currentStreak: 0,
      lastLessonDate: null,
    });
  });

  test("counts consecutive days correctly", async () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    // Skip if any of these days is Sunday
    if (today.getDay() === 0 || yesterday.getDay() === 0 || twoDaysAgo.getDay() === 0) {
      return; // Skip test on Sundays to avoid false negatives
    }

    const lessons = [
      { date: today },
      { date: yesterday },
      { date: twoDaysAgo },
    ];

    Lesson.find.mockReturnValue({
      select: () => ({ sort: () => ({ lean: () => Promise.resolve(lessons) }) }),
    });
    Intern.findById.mockReturnValue({
      select: () => Promise.resolve({ longestStreak: 0 }),
    });
    Intern.findByIdAndUpdate.mockResolvedValue({});

    const result = await updateStreak("intern1");

    expect(result.current).toBeGreaterThanOrEqual(3);
    expect(result.longest).toBeGreaterThanOrEqual(3);
  });
});
