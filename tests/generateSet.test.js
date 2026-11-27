// Генератор набора по правилу банка. Пул синтетический (только коды и метаданные).
const { generateSet } = require("../src/utils/questionBank/generateSet");
const { levelQuota } = require("../src/utils/questionBank/setLevels");

// Детерминированный ГПСЧ для воспроизводимости.
function rngFrom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const LEVELS = ["oson", "orta", "qiyin"];
// 60 вопросов frontend-react: html/css/js/react, уровни по кругу, часть amaliy.
const POOL = [];
["html", "css", "js", "react"].forEach((topic, ti) => {
  const prefix = "HCJR"[ti];
  for (let i = 1; i <= 15; i += 1) {
    POOL.push({
      code: `${prefix}${i}`, topic, tracks: ["frontend-react"], level: LEVELS[i % 3], order: i,
      isPractical: i % 4 === 0, isMiniTask: topic === "js" && i === 8,
      conflictGroup: (prefix === "C" && (i === 1 || i === 2)) ? "g1" : (prefix === "J" && (i === 3 || i === 4)) ? "g2" : null,
    });
  }
});
POOL.push({ code: "V1", topic: "vue", tracks: ["frontend-vue"], level: "oson", order: 1 });

const RULES = {
  levels: { 18: { oson: 4, orta: 9, qiyin: 5 }, 15: { oson: 3, orta: 8, qiyin: 4 } },
  quotas: { "frontend-react": { 18: [
    { topics: ["html"], count: 3 }, { topics: ["css"], count: 4 }, { topics: ["js"], count: 6 }, { topics: ["react"], count: 5 },
  ] } },
  minPractical: 4,
};

const count = (codes, pred) => codes.map((c) => POOL.find((q) => q.code === c)).filter(pred).length;

test("300 прогонов: уровни и квоты тем точно, без конфликтов, без чужого трека", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const { codes, violations } = generateSet({ questions: POOL, track: "frontend-react", size: 18, rules: RULES, rng: rngFrom(seed) });
    expect(codes).toHaveLength(18);
    expect(new Set(codes).size).toBe(18);
    LEVELS.forEach((l) => expect(count(codes, (q) => q.level === l)).toBe(RULES.levels[18][l]));
    expect(count(codes, (q) => q.topic === "html")).toBe(3);
    expect(count(codes, (q) => q.topic === "css")).toBe(4);
    expect(count(codes, (q) => q.topic === "js")).toBe(6);
    expect(count(codes, (q) => q.topic === "react")).toBe(5);
    expect(count(codes, (q) => q.conflictGroup === "g1")).toBeLessThanOrEqual(1);
    expect(count(codes, (q) => q.conflictGroup === "g2")).toBeLessThanOrEqual(1);
    expect(codes).not.toContain("V1");
    expect(violations).toEqual([]); // мини-задание и amaliy подобраны
  }
});

test("порядок: тема → от лёгкого к сложному", () => {
  const { codes } = generateSet({ questions: POOL, track: "frontend-react", size: 18, rules: RULES, rng: rngFrom(7) });
  const qs = codes.map((c) => POOL.find((q) => q.code === c));
  const rank = (q) => ["html", "css", "js", "react"].indexOf(q.topic) * 10 + LEVELS.indexOf(q.level);
  qs.slice(1).forEach((q, i) => expect(rank(q)).toBeGreaterThanOrEqual(rank(qs[i])));
});

test("без квот тем (15): только уровни; размер без правила → пропорционально 18", () => {
  const r15 = generateSet({ questions: POOL, track: "frontend-react", size: 15, rules: RULES, rng: rngFrom(3) });
  LEVELS.forEach((l) => expect(count(r15.codes, (q) => q.level === l)).toBe(RULES.levels[15][l]));
  const r16 = generateSet({ questions: POOL, track: "frontend-react", size: 16, rules: RULES, rng: rngFrom(4) });
  const want = levelQuota(16, RULES);
  LEVELS.forEach((l) => expect(count(r16.codes, (q) => q.level === l)).toBe(want[l]));
});

test("exclude: недавние вопросы не берутся, пока хватает свежих; иначе — нарушение видно", () => {
  const recent = POOL.filter((q) => q.topic === "react").slice(0, 8).map((q) => q.code);
  const { codes } = generateSet({ questions: POOL, track: "frontend-react", size: 18, rules: RULES, exclude: recent, rng: rngFrom(11) });
  recent.forEach((c) => expect(codes).not.toContain(c));
  // Исключили почти весь react — повторы неизбежны и показаны.
  const most = POOL.filter((q) => q.topic === "react").slice(0, 13).map((q) => q.code);
  const r = generateSet({ questions: POOL, track: "frontend-react", size: 18, rules: RULES, exclude: most, rng: rngFrom(12) });
  expect(r.codes).toHaveLength(18);
  expect(r.violations.join(" ")).toMatch(/повтор недавних/);
});

test("банк не тянет правило → понятная ошибка", () => {
  expect(() => generateSet({ questions: POOL.slice(0, 10), track: "frontend-react", size: 18, rules: RULES }))
    .toThrow(/Не удалось собрать набор/);
  expect(() => generateSet({ questions: POOL, track: "frontend-react", size: 40, rules: RULES })).toThrow(/Нет правила/);
});
