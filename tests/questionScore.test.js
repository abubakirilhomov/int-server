const { computeQuestionScore } = require("../src/utils/scoreInterview");
const { mergeConfig, DEFAULTS } = require("../src/config/candidateInterviews");

const items = [
  { code: "H1", topic: "html", level: "oson", result: "pass" }, // 1/1
  { code: "J1", topic: "js", level: "orta", result: "partial" }, // 1/2
  { code: "R1", topic: "react", level: "qiyin", result: "fail" }, // 0/3
  { code: "R2", topic: "react", level: "qiyin", result: null }, // не оценён
];

describe("computeQuestionScore (живой режим)", () => {
  test("веса oson 1 / o'rta 2 / qiyin 3, partial = 0.5, неоценённые вне знаменателя", () => {
    const r = computeQuestionScore(items, { levelWeights: { oson: 1, orta: 2, qiyin: 3 }, partialCredit: 0.5, threshold: 80 });
    expect(r.total).toBe(6);
    expect(r.earned).toBe(2);
    expect(r.percentage).toBe(33.3);
    expect(r.passed).toBe(false);
    expect(r.unrated).toBe(1);
    expect(r.roadmapUz).toEqual(["JavaScript", "React"]);
    expect(r.snapItems[0]).toMatchObject({ questionCode: "H1", weight: 1, earned: 1 });
  });

  test("порог включительно; ничего не оценено → не прошёл", () => {
    const pass = computeQuestionScore([{ level: "orta", result: "pass", topic: "js" }], { threshold: 100 });
    expect(pass.passed).toBe(true);
    expect(computeQuestionScore([{ level: "orta", result: null }]).passed).toBe(false);
  });
});

describe("равный вес по умолчанию (§9.2, 27.11)", () => {
  test("без levelWeights все уровни весят 1: 1 pass + 1 partial + 1 fail = 50%", () => {
    const r = computeQuestionScore(items, { partialCredit: 0.5, threshold: 80 });
    expect(r.total).toBe(3);
    expect(r.earned).toBe(1.5);
    expect(r.percentage).toBe(50);
    expect(r.snapItems.map((s) => s.weight)).toEqual([1, 1, 1]);
  });

  test("с весами конфига: 4 из 5 pass = 80% → прошёл (порог включительно)", () => {
    const cfg = mergeConfig();
    const five = ["oson", "orta", "qiyin", "qiyin", "orta"].map((level, i) => ({ level, topic: "js", result: i < 4 ? "pass" : "fail" }));
    const r = computeQuestionScore(five, { levelWeights: cfg.levelWeights, partialCredit: cfg.partialCredit, threshold: cfg.passThreshold });
    expect(r.percentage).toBe(80);
    expect(r.passed).toBe(true);
  });
});

describe("конфиг (ответы Абубакира на §9, 27.11)", () => {
  test("значения по умолчанию", () => {
    const cfg = mergeConfig();
    expect(cfg).toMatchObject({
      format: "mixed", recordSignals: true, blockPaste: false,
      levelWeights: { oson: 1, orta: 1, qiyin: 1 },
      passThreshold: 80, partialCredit: 0.5,
      conductorRoles: ["admin"],
      accessWindow: { beforeMinutes: 30, afterMinutes: 180 },
      revokeOnFinish: true, languages: ["uz", "ru"], defaultLanguage: "uz", sandboxProvider: "sandpack",
    });
    expect(cfg.bankTracks).toEqual(["frontend-react", "frontend-vue", "backend-nodejs"]);
  });

  test("порог 80% не зависит от interviewSettings; partial — из него", () => {
    expect(mergeConfig({}, { passThreshold: 75, partialCredit: 0.4 })).toMatchObject({ passThreshold: 80, partialCredit: 0.4 });
    expect(mergeConfig({ passThreshold: null }, { passThreshold: 75 })).toMatchObject({ passThreshold: 75 });
  });

  test("Setting candidateInterviewSettings перекрывает поля, вложенные — частично", () => {
    const cfg = mergeConfig({ levelWeights: { qiyin: 2 }, passThreshold: 70 }, { passThreshold: 90 });
    expect(cfg.levelWeights).toEqual({ oson: 1, orta: 1, qiyin: 2 });
    expect(cfg.passThreshold).toBe(70);
    expect(DEFAULTS.levelWeights.qiyin).toBe(1);
  });
});
