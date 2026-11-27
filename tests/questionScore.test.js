const { computeQuestionScore } = require("../src/utils/scoreInterview");
const { mergeConfig, DEFAULTS } = require("../src/config/candidateInterviews");

const items = [
  { code: "H1", topic: "html", level: "oson", state: "closed", result: "pass" }, // 1/1
  { code: "J1", topic: "js", level: "orta", state: "closed", result: "partial" }, // 1/2
  { code: "R1", topic: "react", level: "qiyin", state: "closed", result: "fail" }, // 0/3
  { code: "R2", topic: "react", level: "qiyin", state: "open", result: null }, // открыт, не оценён → 0/3
  { code: "C1", topic: "css", level: "orta", state: "hidden", result: null }, // не открыт — не считается
];

describe("computeQuestionScore (живой режим, решение Абубакира 27.11)", () => {
  test("% от максимума ОТКРЫТЫХ вопросов: открыт без оценки = 0, неоткрытые не считаются", () => {
    const r = computeQuestionScore(items, { levelWeights: { oson: 1, orta: 2, qiyin: 3 }, partialCredit: 0.5, threshold: 80 });
    expect(r.total).toBe(1 + 2 + 3 + 3); // C1 (hidden) вне знаменателя
    expect(r.earned).toBe(2);
    expect(r.percentage).toBe(22.2);
    expect(r.passed).toBe(false);
    expect(r.rated).toBe(3);
    expect(r.unrated).toBe(1);
    expect(r.notOpened).toBe(1);
    expect(r.roadmapUz).toEqual(["JavaScript", "React"]);
    expect(r.snapItems.map((i) => i.questionCode)).toEqual(["H1", "J1", "R1", "R2"]);
    expect(r.snapItems[3]).toMatchObject({ questionCode: "R2", weight: 3, earned: 0, result: undefined });
  });

  test("тот же кандидат по старому правилу прошёл бы: неоценённый открытый вопрос роняет % ниже 80", () => {
    // 4 открыто, оценены 2 (oson pass, qiyin pass) = 4/4; открытые без оценки oson + o'rta = 0/3 → 4/7
    const qs = [
      { level: "oson", state: "closed", result: "pass", topic: "html" },
      { level: "qiyin", state: "closed", result: "pass", topic: "css" },
      { level: "oson", state: "closed", result: null, topic: "js" },
      { level: "orta", state: "open", result: null, topic: "js" },
      { level: "qiyin", state: "hidden", result: null, topic: "react" },
    ];
    const r = computeQuestionScore(qs, { threshold: 80 });
    expect(r).toMatchObject({ earned: 4, total: 7, percentage: 57.1, passed: false, unrated: 2, notOpened: 1 });
  });

  test("оценён, но не открыт (обсудили устно) — оценка входит", () => {
    const r = computeQuestionScore([{ level: "orta", state: "hidden", result: "pass", topic: "js" }]);
    expect(r).toMatchObject({ earned: 2, total: 2, percentage: 100, notOpened: 0 });
  });

  test("порог включительно; ничего не открыто → не прошёл", () => {
    const pass = computeQuestionScore([{ level: "orta", result: "pass", topic: "js" }], { threshold: 100 });
    expect(pass.passed).toBe(true);
    expect(computeQuestionScore([{ level: "orta", state: "hidden", result: null }]).passed).toBe(false);
    expect(computeQuestionScore([{ level: "orta", state: "hidden", result: null }]).total).toBe(0);
  });
});

describe("вес по уровню по умолчанию 1/2/3 (поправка Абубакира 27.11)", () => {
  test("без levelWeights: oson 1, o'rta 2, qiyin 3", () => {
    const r = computeQuestionScore(items, { partialCredit: 0.5, threshold: 80 });
    expect(r.total).toBe(9);
    expect(r.snapItems.map((s) => s.weight)).toEqual([1, 2, 3, 3]);
  });

  test("с конфигом: 80% от максимума набора → прошёл (порог включительно)", () => {
    const cfg = mergeConfig();
    // max = 1+2+2+3+2 = 10; провален один o'rta (2) → 8/10 = 80%
    const five = ["oson", "orta", "orta", "qiyin", "orta"].map((level, i) => ({ level, topic: "js", result: i === 4 ? "fail" : "pass" }));
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
      levelWeights: { oson: 1, orta: 2, qiyin: 3 },
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
    const cfg = mergeConfig({ levelWeights: { qiyin: 4 }, passThreshold: 70 }, { passThreshold: 90 });
    expect(cfg.levelWeights).toEqual({ oson: 1, orta: 2, qiyin: 4 });
    expect(cfg.passThreshold).toBe(70);
    expect(DEFAULTS.levelWeights.qiyin).toBe(3);
  });
});
