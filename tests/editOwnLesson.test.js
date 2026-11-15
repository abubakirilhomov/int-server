jest.mock("../src/models/internModel", () => ({ updateOne: jest.fn().mockResolvedValue({}) }));
jest.mock("../src/models/mentorModel", () => ({ exists: jest.fn() }));
jest.mock("../src/models/lessonModel", () => ({
  findById: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));
jest.mock("../src/models/lessonCriteriaModel", () => ({}));
jest.mock("../src/models/gradeConfigModel", () => ({}));
jest.mock("../src/controllers/notificationController", () => ({
  sendNotificationToUser: jest.fn().mockResolvedValue(),
}));
jest.mock("../src/services/streakService", () => ({ updateStreak: jest.fn() }));
jest.mock("../src/services/badgeService", () => ({ checkAndAwardBadges: jest.fn() }));
jest.mock("../src/services/xpService", () => ({ awardXP: jest.fn(), XP_REWARDS: {} }));

const Lesson = require("../src/models/lessonModel");
const Intern = require("../src/models/internModel");
const Mentor = require("../src/models/mentorModel");
const { sendNotificationToUser } = require("../src/controllers/notificationController");
const { editOwnLesson } = require("../src/controllers/lessonController");
const { TASHKENT_OFFSET_MS, tashkentWallClockToDate } = require("../src/utils/tashkentTime");

const ME = "64b000000000000000000001";
const OTHER = "64b000000000000000000002";
const LESSON = "64b0000000000000000000a1";
const MENTOR_A = "64b0000000000000000000c1";
const MENTOR_B = "64b0000000000000000000c2";

const wall = (d) => new Date(d.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 16);
const OLD_TIME = wall(new Date(Date.now() - 26 * 3600 * 1000));
const NEW_TIME = wall(new Date(Date.now() - 2 * 3600 * 1000));

const lessonDoc = (over = {}) => ({
  _id: LESSON, intern: ME, mentor: MENTOR_A, topic: "JS", group: "G1",
  time: OLD_TIME, date: tashkentWallClockToDate(OLD_TIME), status: "pending", ...over,
});

const mockFindById = (doc) => Lesson.findById.mockReturnValue({ lean: () => Promise.resolve(doc) });

const invoke = async (user, body, id = LESSON) => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  const next = jest.fn();
  editOwnLesson({ user, body, params: { id } }, res, next);
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));
  if (next.mock.calls.length) throw next.mock.calls[0][0];
  return res;
};
const intern = { role: "intern", id: ME };
const statusOf = (res) => (res.status.mock.calls[0] ? res.status.mock.calls[0][0] : 200);

beforeEach(() => {
  jest.clearAllMocks();
  Mentor.exists.mockResolvedValue({ _id: MENTOR_B });
  Lesson.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });
  Lesson.findOneAndUpdate.mockImplementation((q, u) => Promise.resolve({ ...lessonDoc(), ...u.$set }));
});

describe("PATCH /lessons/:id (intern edits own pending lesson)", () => {
  test("own pending lesson: topic/group edited, update is conditioned on owner + pending", async () => {
    mockFindById(lessonDoc());
    const res = await invoke(intern, { topic: " React ", group: "G2", feedback: "👍" });
    expect(statusOf(res)).toBe(200);
    const [filter, update] = Lesson.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: LESSON, intern: ME, status: "pending" });
    expect(update.$set).toEqual({ topic: "React", group: "G2", feedback: "👍" });
    expect(update.$set.status).toBeUndefined();
    expect(Intern.updateOne).not.toHaveBeenCalled();
    expect(sendNotificationToUser).not.toHaveBeenCalled();
  });

  test("someone else's lesson → 403, nothing written", async () => {
    mockFindById(lessonDoc({ intern: OTHER }));
    const res = await invoke(intern, { topic: "x" });
    expect(statusOf(res)).toBe(403);
    expect(Lesson.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("confirmed lesson → 409, nothing written", async () => {
    mockFindById(lessonDoc({ status: "confirmed" }));
    const res = await invoke(intern, { topic: "x" });
    expect(statusOf(res)).toBe(409);
    expect(Lesson.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("mentor confirms between read and write (race) → 409", async () => {
    mockFindById(lessonDoc());
    Lesson.findOneAndUpdate.mockResolvedValue(null);
    const res = await invoke(intern, { topic: "x" });
    expect(statusOf(res)).toBe(409);
  });

  test.each([["status", "confirmed"], ["isRated", true], ["internFeedback", { score: 5 }], ["intern", OTHER], ["date", "2026-01-01"], ["branch", MENTOR_A]])(
    "forbidden field %s → 400, nothing read or written",
    async (field, value) => {
      const res = await invoke(intern, { topic: "x", [field]: value });
      expect(statusOf(res)).toBe(400);
      expect(Lesson.findById).not.toHaveBeenCalled();
      expect(Lesson.findOneAndUpdate).not.toHaveBeenCalled();
    }
  );

  test("mentor role (not the intern) → 403", async () => {
    const res = await invoke({ role: "mentor", id: MENTOR_A }, { topic: "x" });
    expect(statusOf(res)).toBe(403);
    expect(Lesson.findById).not.toHaveBeenCalled();
  });

  test("change mentor + time: date recomputed, lessonsVisited synced, new mentor notified", async () => {
    mockFindById(lessonDoc());
    const res = await invoke(intern, { mentor: MENTOR_B, time: NEW_TIME });
    expect(statusOf(res)).toBe(200);
    const update = Lesson.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set.mentor).toBe(MENTOR_B);
    expect(update.$set.date.getTime()).toBe(tashkentWallClockToDate(NEW_TIME).getTime());
    expect(Lesson.findOne.mock.calls[0][0]).toMatchObject({ intern: ME, mentor: MENTOR_B });
    expect(Intern.updateOne).toHaveBeenCalledWith(
      { _id: ME, "lessonsVisited.lessonId": LESSON },
      expect.objectContaining({ $set: expect.objectContaining({ "lessonsVisited.$.mentorId": MENTOR_B }) })
    );
    expect(sendNotificationToUser).toHaveBeenCalledWith(MENTOR_B, "mentor", expect.any(String), expect.any(String));
  });

  test("unknown mentor → 400", async () => {
    Mentor.exists.mockResolvedValue(null);
    const res = await invoke(intern, { mentor: MENTOR_B });
    expect(statusOf(res)).toBe(400);
    expect(Lesson.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("time outside the allowed window → 400", async () => {
    mockFindById(lessonDoc());
    const res = await invoke(intern, { time: wall(new Date(Date.now() - 10 * 24 * 3600 * 1000)) });
    expect(statusOf(res)).toBe(400);
  });

  test("duplicate with same mentor+time → 409", async () => {
    mockFindById(lessonDoc());
    Lesson.findOne.mockReturnValue({ lean: () => Promise.resolve({ _id: "dup" }) });
    const res = await invoke(intern, { time: NEW_TIME });
    expect(statusOf(res)).toBe(409);
    expect(Lesson.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("empty topic → 400", async () => {
    const res = await invoke(intern, { topic: "  " });
    expect(statusOf(res)).toBe(400);
  });
});
