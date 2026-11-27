const { computeQuestionScore } = require("../src/utils/scoreInterview");
const { mergeConfig, DEFAULTS } = require("../src/config/candidateInterviews");

describe("computeQuestionScore (живой режим)", () => {
  const items = [
    { code: "H1", topic: "html", level: "oson", result: "pass" }, // 1/1
    { code: "J1", topic: "js", level: "orta", result: "partial" }, // 1/2
    { code: "R1", topic: "react", level: "qiyin", result: "fail" }, // 0/3
    { code: "R2", topic: "react", level: "qiyin", result: null }, // не оценён
  ];

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

describe("конфиг по умолчаниям (решения 27.11, §9 плана)", () => {
  test("порог и partial берутся из interviewSettings текущего процесса", () => {
    expect(mergeConfig({}, { passThreshold: 75, partialCredit: 0.4 })).toMatchObject({ passThreshold: 75, partialCredit: 0.4 });
    expect(mergeConfig({}, {})).toMatchObject({ passThreshold: 80, partialCredit: 0.5 });
  });

  test("значения по умолчанию", () => {
    const cfg = mergeConfig();
    expect(cfg).toMatchObject({
      format: "mixed", recordSignals: true, blockPaste: false,
      levelWeights: { oson: 1, orta: 2, qiyin: 3 },
      conductorRoles: ["admin"],
      accessWindow: { beforeMinutes: 30, afterMinutes: 180 },
      revokeOnFinish: true, language: "uz", sandboxProvider: null,
    });
    expect(cfg.bankTracks).not.toContain("backend-nodejs");
  });

  test("Setting candidateInterviewSettings перекрывает поля, вложенные — частично", () => {
    const cfg = mergeConfig({ levelWeights: { qiyin: 4 }, passThreshold: 70 }, { passThreshold: 90 });
    expect(cfg.levelWeights).toEqual({ oson: 1, orta: 2, qiyin: 4 });
    expect(cfg.passThreshold).toBe(70);
    expect(DEFAULTS.levelWeights.qiyin).toBe(3);
  });
});
