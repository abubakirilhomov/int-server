// Мокаем всё, что тянет контроллер при require, чтобы тест был изолирован
// и не поднимал web-push / реальные модели.
jest.mock("../src/models/internModel", () => ({ findById: jest.fn() }));
jest.mock("../src/models/lessonModel", () => ({ findOne: jest.fn(), create: jest.fn() }));
jest.mock("../src/models/lessonCriteriaModel", () => ({}));
jest.mock("../src/models/gradeConfigModel", () => ({}));
jest.mock("../src/controllers/notificationController", () => ({
  sendNotificationToUser: jest.fn(),
}));
jest.mock("../src/services/streakService", () => ({
  updateStreak: jest.fn().mockResolvedValue({}),
}));
jest.mock("../src/services/badgeService", () => ({
  checkAndAwardBadges: jest.fn().mockResolvedValue([]),
}));
jest.mock("../src/services/xpService", () => ({
  awardXP: jest.fn().mockResolvedValue({}),
  XP_REWARDS: { lessonCreated: 10 },
}));

const Intern = require("../src/models/internModel");
const Lesson = require("../src/models/lessonModel");
const { createLesson } = require("../src/controllers/lessonController");
const { tashkentWallClockToDate } = require("../src/utils/tashkentTime");

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};
const next = jest.fn();

const internReq = (time) => ({
  user: { role: "intern", id: "i1" },
  body: { mentor: "m1", topic: "t", group: "g", time },
});

// catchAsync НЕ возвращает промис (fn(...).catch(next)) — поэтому просто
// вызываем хендлер и даём микротаскам всех await'ов стечь.
const invoke = async (req, res) => {
  createLesson(req, res, next);
  for (let i = 0; i < 5; i += 1) {
    await new Promise((r) => setImmediate(r));
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  Intern.findById.mockResolvedValue({ status: "active", weeklyPlan: { status: "ok" } });
  // Запрос pending-feedback (без ключа date) → цепочка .sort().lean() → null.
  // Запрос анти-дубля (с ключом date) → по умолчанию нет дубля.
  Lesson.findOne.mockImplementation((q) => {
    if (q && q.date) return Promise.resolve(null);
    return { sort: () => ({ lean: () => Promise.resolve(null) }) };
  });
});

describe("createLesson — date из time", () => {
  test("битый формат time → 400, урок не создаётся", async () => {
    const res = makeRes();
    await invoke(internReq("2026-07-15"), res); // нет времени
    expect(res.status).toHaveBeenCalledWith(400);
    expect(Lesson.create).not.toHaveBeenCalled();
  });

  test("точный дубль (тот же ментор+время) → 409, запрос по точному моменту", async () => {
    const derived = tashkentWallClockToDate("2026-07-15T14:00");
    Lesson.findOne.mockImplementation((q) => {
      if (q && q.date) {
        // дубль только при совпадении точного момента
        return Promise.resolve(
          q.date.getTime && q.date.getTime() === derived.getTime() ? { _id: "dup" } : null
        );
      }
      return { sort: () => ({ lean: () => Promise.resolve(null) }) };
    });
    const res = makeRes();
    await invoke(internReq("2026-07-15T14:00"), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(Lesson.create).not.toHaveBeenCalled();

    const dedupeCall = Lesson.findOne.mock.calls
      .map((c) => c[0])
      .find((q) => q && q.date);
    expect(dedupeCall.date instanceof Date).toBe(true); // точное равенство, без дневного диапазона
    expect(dedupeCall.date.getTime()).toBe(derived.getTime());
    expect(dedupeCall.date.$gte).toBeUndefined();
    expect(dedupeCall.date.$lt).toBeUndefined();
  });

  test("другое время с тем же ментором в тот же день — разрешено (доходит до create)", async () => {
    const existing = tashkentWallClockToDate("2026-07-15T10:00");
    Lesson.findOne.mockImplementation((q) => {
      if (q && q.date) {
        return Promise.resolve(
          q.date.getTime && q.date.getTime() === existing.getTime() ? { _id: "dup" } : null
        );
      }
      return { sort: () => ({ lean: () => Promise.resolve(null) }) };
    });
    Lesson.create.mockResolvedValue({ _id: "new2", intern: null });
    const res = makeRes();
    await invoke(internReq("2026-07-15T15:00"), res); // другое время → не дубль

    expect(Lesson.create).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test("на успехе в Lesson.create уходит выведенный ташкентский date", async () => {
    Lesson.create.mockResolvedValue({ _id: "new1", intern: null }); // intern null → без post-create
    const res = makeRes();
    await invoke(internReq("2026-07-15T14:00"), res);

    expect(Lesson.create).toHaveBeenCalledTimes(1);
    const payload = Lesson.create.mock.calls[0][0];
    expect(payload.date.getTime()).toBe(
      tashkentWallClockToDate("2026-07-15T14:00").getTime()
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
