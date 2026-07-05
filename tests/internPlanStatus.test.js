jest.mock("../src/models/lessonModel", () => ({
  countDocuments: jest.fn(),
}));

const Lesson = require("../src/models/lessonModel");
const { getInternPlanStatus } = require("../src/utils/internPlanStatus");
const { tashkentMonthBounds } = require("../src/utils/tashkentTime");

const baseIntern = (over = {}) => ({
  _id: "i1",
  lessonsPerMonth: 24,
  probationStartDate: new Date("2026-06-01T00:00:00+05:00"),
  bonusLessons: [],
  status: "active",
  ...over,
});

// countDocuments зовётся дважды: confirmed и pending.
const mockCounts = (confirmed, pending) =>
  Lesson.countDocuments.mockImplementation((q) =>
    Promise.resolve(q.status === "confirmed" ? confirmed : pending)
  );

describe("getInternPlanStatus — ташкентское окно и математика", () => {
  beforeEach(() => jest.clearAllMocks());

  test("рабочие дни середины месяца (Ташкент): 15 июля", async () => {
    mockCounts(0, 0);
    const r = await getInternPlanStatus(
      baseIntern(),
      new Date("2026-07-15T12:00:00+05:00")
    );
    expect(r.elapsedWorkingDays).toBe(13); // 1..15 июля минус Вс 5,12
    expect(r.totalWorkingDaysInWindow).toBe(27); // июль минус 4 воскресенья
    expect(r.requiredLessonsByNow).toBe(12); // ceil(13/27*24)
  });

  test("считает уроки полуоткрытым ташкентским окном [start, endExclusive)", async () => {
    mockCounts(5, 2);
    const ref = new Date("2026-07-15T12:00:00+05:00");
    await getInternPlanStatus(baseIntern(), ref);

    const { start, endExclusive } = tashkentMonthBounds(ref);
    const call = Lesson.countDocuments.mock.calls[0][0];
    expect(call.date.$gte.getTime()).toBe(start.getTime());
    expect(call.date.$lt.getTime()).toBe(endExclusive.getTime());
    expect(call.date.$lte).toBeUndefined(); // стандартизировано на $lt
  });

  test("блокирует при отставании после грейс-периода", async () => {
    mockCounts(0, 0);
    const r = await getInternPlanStatus(
      baseIntern(),
      new Date("2026-07-15T12:00:00+05:00")
    );
    expect(r.deficit).toBeGreaterThan(0);
    expect(r.isPlanBlocked).toBe(true);
  });

  test("не блокирует, когда confirmed+pending покрывают норму к дате", async () => {
    mockCounts(12, 0);
    const r = await getInternPlanStatus(
      baseIntern(),
      new Date("2026-07-15T12:00:00+05:00")
    );
    expect(r.deficit).toBe(0);
    expect(r.isPlanBlocked).toBe(false);
  });

  test("грейс-период: первые 3 рабочих дня не блокируются", async () => {
    mockCounts(0, 0);
    const r = await getInternPlanStatus(
      baseIntern(),
      new Date("2026-07-02T12:00:00+05:00") // 1 июля = Ср, прошло ~2 раб. дня
    );
    expect(r.isPlanBlocked).toBe(false);
  });

  test("ручная активация того же ташкентского месяца снимает блок (без подсчёта)", async () => {
    mockCounts(0, 0);
    const intern = baseIntern({
      manualActivation: {
        isEnabled: true,
        enabledAt: new Date("2026-07-03T00:00:00+05:00"),
      },
    });
    const r = await getInternPlanStatus(
      intern,
      new Date("2026-07-15T12:00:00+05:00")
    );
    expect(r.isManuallyActivated).toBe(true);
    expect(r.isPlanBlocked).toBe(false);
    expect(Lesson.countDocuments).not.toHaveBeenCalled();
  });

  test("ручная активация прошлого ташкентского месяца игнорируется", async () => {
    mockCounts(0, 0);
    const intern = baseIntern({
      manualActivation: {
        isEnabled: true,
        enabledAt: new Date("2026-06-20T00:00:00+05:00"),
      },
    });
    const r = await getInternPlanStatus(
      intern,
      new Date("2026-07-15T12:00:00+05:00")
    );
    expect(r.isManuallyActivated).toBe(false);
    expect(r.isPlanBlocked).toBe(true); // истекла → обычный путь → блок
  });
});
