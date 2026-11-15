jest.mock("../src/models/internModel", () => ({}));
jest.mock("../src/models/lessonModel", () => ({ find: jest.fn(), aggregate: jest.fn() }));
jest.mock("../src/models/lessonCriteriaModel", () => ({}));
jest.mock("../src/models/gradeConfigModel", () => ({}));
jest.mock("../src/controllers/notificationController", () => ({
  sendNotificationToUser: jest.fn(),
}));
jest.mock("../src/services/streakService", () => ({ updateStreak: jest.fn() }));
jest.mock("../src/services/badgeService", () => ({ checkAndAwardBadges: jest.fn() }));
jest.mock("../src/services/xpService", () => ({ awardXP: jest.fn(), XP_REWARDS: {} }));

const Lesson = require("../src/models/lessonModel");
const { getMyLessonHistory } = require("../src/controllers/lessonController");

const INTERN_ID = "64b000000000000000000001";

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const invoke = async (req) => {
  const res = makeRes();
  const next = jest.fn();
  getMyLessonHistory(req, res, next);
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
  return { res, next };
};

const mockFind = (docs) => {
  const chain = {
    select: jest.fn(() => chain),
    populate: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    lean: jest.fn(() => Promise.resolve(docs)),
  };
  Lesson.find.mockReturnValue(chain);
  return chain;
};

beforeEach(() => jest.clearAllMocks());

describe("GET /lessons/my-history", () => {
  it("rejects non-intern roles", async () => {
    const { next } = await invoke({ user: { role: "mentor", id: "m1" }, query: {} });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(Lesson.find).not.toHaveBeenCalled();
  });

  it("rejects malformed month", async () => {
    const { next } = await invoke({
      user: { role: "intern", id: INTERN_ID },
      query: { month: "2026-13" },
    });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it("scopes to the token's intern (ignores query intern) and Tashkent month bounds", async () => {
    const chain = mockFind([
      {
        _id: "l1", topic: "JS", group: "G1", time: "2026-10-05T15:00",
        date: new Date("2026-10-05T10:00:00Z"), status: "confirmed", feedback: "🔥",
        internFeedback: { score: 4 }, mentor: { _id: "m1", name: "Ali", lastName: "V" },
      },
      {
        _id: "l2", topic: "CSS", group: "G2", time: "2026-10-03T09:00",
        date: new Date("2026-10-03T04:00:00Z"), status: "pending", mentor: null,
      },
    ]);
    Lesson.aggregate.mockResolvedValue([
      { _id: "2026-10", total: 2, confirmed: 1 },
      { _id: "2026-09", total: 5, confirmed: 5 },
    ]);

    const { res, next } = await invoke({
      user: { role: "intern", id: INTERN_ID },
      query: { month: "2026-10", intern: "someone-else" },
    });

    expect(next).not.toHaveBeenCalled();
    const filter = Lesson.find.mock.calls[0][0];
    expect(filter.intern).toBe(INTERN_ID);
    expect(filter.date.$gte.toISOString()).toBe("2026-09-30T19:00:00.000Z");
    expect(filter.date.$lt.toISOString()).toBe("2026-10-31T19:00:00.000Z");
    expect(chain.sort).toHaveBeenCalledWith({ date: -1, createdAt: -1 });
    expect(String(Lesson.aggregate.mock.calls[0][0][0].$match.intern)).toBe(INTERN_ID);

    const body = res.json.mock.calls[0][0];
    expect(body.month).toBe("2026-10");
    expect(body.summary).toEqual({ total: 2, confirmed: 1, pending: 1 });
    expect(body.months).toEqual([
      { month: "2026-10", total: 2, confirmed: 1 },
      { month: "2026-09", total: 5, confirmed: 5 },
    ]);
    expect(body.lessons[0]).toMatchObject({ internScore: 4, feedback: "🔥", mentor: { name: "Ali" } });
    expect(body.lessons[1]).toMatchObject({ internScore: null, feedback: null, mentor: null });
  });

  it("defaults to the current Tashkent month", async () => {
    mockFind([]);
    Lesson.aggregate.mockResolvedValue([]);
    const { res } = await invoke({ user: { role: "intern", id: INTERN_ID }, query: {} });
    const expected = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 7);
    expect(res.json.mock.calls[0][0].month).toBe(expected);
  });
});
