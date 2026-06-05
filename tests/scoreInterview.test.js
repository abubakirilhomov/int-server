const { computeScore } = require("../src/utils/scoreInterview");

const topics = new Map([
  ["a", { _id: "a", label: "SEO", labelRu: "СЕО", category: "html-css", weight: 1 }],
  ["b", { _id: "b", label: "this", labelRu: "this", category: "javascript", weight: 1 }],
  ["c", { _id: "c", label: "JSX", labelRu: "JSX", category: "react", weight: 2 }],
]);

describe("computeScore", () => {
  test("pass/partial/fail with weights + partial credit", () => {
    const r = computeScore(
      [
        { topicId: "a", result: "pass" },
        { topicId: "b", result: "partial" },
        { topicId: "c", result: "fail" },
      ],
      topics,
      { partialCredit: 0.5, threshold: 80 }
    );
    expect(r.earned).toBe(1.5); // 1 + 0.5 + 0
    expect(r.total).toBe(4); // 1 + 1 + 2
    expect(r.percentage).toBe(37.5);
    expect(r.passed).toBe(false);
    expect(r.roadmap).toEqual(["this", "JSX"]); // non-pass labels (labelRu)
  });

  test("all pass → 100% passes, empty roadmap", () => {
    const r = computeScore(
      [{ topicId: "a", result: "pass" }, { topicId: "c", result: "pass" }],
      topics,
      { partialCredit: 0.5, threshold: 80 }
    );
    expect(r.percentage).toBe(100);
    expect(r.passed).toBe(true);
    expect(r.roadmap).toEqual([]);
  });

  test("threshold boundary: exactly 80% passes", () => {
    const t2 = new Map([0, 1, 2, 3, 4].map((i) => [String(i), { _id: String(i), label: `t${i}`, weight: 1 }]));
    const items = [0, 1, 2, 3]
      .map((i) => ({ topicId: String(i), result: "pass" }))
      .concat([{ topicId: "4", result: "fail" }]);
    const r = computeScore(items, t2, { partialCredit: 0.5, threshold: 80 });
    expect(r.percentage).toBe(80);
    expect(r.passed).toBe(true);
  });

  test("partialCredit is configurable", () => {
    const r = computeScore([{ topicId: "a", result: "partial" }], topics, { partialCredit: 0.25, threshold: 80 });
    expect(r.earned).toBe(0.25);
    expect(r.percentage).toBe(25);
  });

  test("unknown topicId is ignored", () => {
    const r = computeScore(
      [{ topicId: "zzz", result: "pass" }, { topicId: "a", result: "pass" }],
      topics,
      {}
    );
    expect(r.total).toBe(1);
    expect(r.earned).toBe(1);
  });

  test("empty items → 0%, not passed", () => {
    const r = computeScore([], topics, {});
    expect(r.total).toBe(0);
    expect(r.percentage).toBe(0);
    expect(r.passed).toBe(false);
  });
});
