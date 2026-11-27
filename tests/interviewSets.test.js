// Этап 3: генератор на 1000 прогонах, квоты тем для 16/17/19, ротация без повторов
// последних наборов, пересечения. Банк СИНТЕТИЧЕСКИЙ: коды и числа по форме
// настоящего банка, текстов нет (репозиторий публичный).
const { generateSet } = require("../src/utils/questionBank/generateSet");
const { levelQuota } = require("../src/utils/questionBank/setLevels");
const { topicQuota, scaleCounts } = require("../src/utils/questionBank/topicQuota");
const { rankSets, overlapCount, overlapMatrix } = require("../src/services/interviewSets");

function rngFrom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const LEVELS = ["oson", "orta", "qiyin"];
// topic → [oson, orta, qiyin] — как распределение в настоящем банке.
const SHAPE = {
  html: [3, 4, 1], css: [4, 8, 4], js: [4, 15, 6], react: [5, 11, 8], vue: [6, 17, 9], tailwind: [5, 10, 6],
};
const TRACK_TOPICS = { "frontend-react": ["html", "css", "js", "react"], "frontend-vue": ["html", "css", "js", "vue", "tailwind"] };

function makeBank() {
  const out = [];
  let n = 0;
  Object.entries(SHAPE).forEach(([topic, counts]) => {
    const tracks = Object.entries(TRACK_TOPICS).filter(([, t]) => t.includes(topic)).map(([k]) => k);
    LEVELS.forEach((level, li) => {
      for (let i = 0; i < counts[li]; i += 1) {
        n += 1;
        out.push({
          code: `${topic[0].toUpperCase()}${n}`, topic, tracks, level, order: n, isActive: true,
          isPractical: n % 3 === 0, isMiniTask: n % 17 === 0, conflictGroup: null,
        });
      }
    });
  });
  // Пять conflict-пар: берём вопросы разных тем одного трека.
  const pick = (topic, k) => out.filter((q) => q.topic === topic)[k];
  [["css", 0, "js", 0], ["css", 1, "js", 1], ["js", 2, "react", 0], ["js", 3, "vue", 0], ["react", 1, "react", 2]]
    .forEach(([t1, k1, t2, k2], i) => { pick(t1, k1).conflictGroup = `g${i}`; pick(t2, k2).conflictGroup = `g${i}`; });
  return out;
}
const BANK = makeBank();
const byCode = new Map(BANK.map((q) => [q.code, q]));

const RULES = {
  quotas: {
    "frontend-react": {
      15: [{ topics: ["html"], count: 2 }, { topics: ["css"], count: 3 }, { topics: ["js"], count: 5 }, { topics: ["react"], count: 5 }],
      18: [{ topics: ["html"], count: 2 }, { topics: ["css"], count: 4 }, { topics: ["js"], count: 6 }, { topics: ["react"], count: 6 }],
      20: [{ topics: ["html"], count: 2 }, { topics: ["css"], count: 4 }, { topics: ["js"], count: 7 }, { topics: ["react"], count: 7 }],
    },
    "frontend-vue": {
      15: [{ topics: ["html", "css"], count: 1 }, { topics: ["js"], count: 2 }, { topics: ["vue"], count: 8 }, { topics: ["tailwind"], count: 4 }],
      18: [{ topics: ["html", "css"], count: 2 }, { topics: ["js"], count: 2 }, { topics: ["vue"], count: 9 }, { topics: ["tailwind"], count: 5 }],
      20: [{ topics: ["html", "css"], count: 2 }, { topics: ["js"], count: 3 }, { topics: ["vue"], count: 10 }, { topics: ["tailwind"], count: 5 }],
    },
  },
  levels: { 15: { oson: 3, orta: 8, qiyin: 4 }, 18: { oson: 4, orta: 9, qiyin: 5 }, 20: { oson: 4, orta: 11, qiyin: 5 } },
  minPractical: 6,
};

const countBy = (codes, f) => codes.filter((c) => f(byCode.get(c))).length;

describe("квоты тем", () => {
  test("scaleCounts: сумма точно равна размеру", () => {
    for (let size = 15; size <= 20; size += 1) {
      expect(scaleCounts([2, 4, 6, 6], size).reduce((a, b) => a + b, 0)).toBe(size);
    }
  });

  test("заданные размеры берутся как есть, 16/17/19 — пропорционально, сумма = размеру", () => {
    expect(topicQuota(RULES, "frontend-react", 18).map((g) => g.count)).toEqual([2, 4, 6, 6]);
    [15, 16, 17, 18, 19, 20].forEach((size) => {
      ["frontend-react", "frontend-vue"].forEach((track) => {
        const q = topicQuota(RULES, track, size);
        expect(q.reduce((s, g) => s + g.count, 0)).toBe(size);
      });
    });
    expect(topicQuota(RULES, "backend-nodejs", 18)).toBeNull();
    expect(topicQuota({}, "frontend-react", 18)).toBeNull();
  });
});

describe("генератор: 1000 прогонов без нарушения правила", () => {
  test.each(["frontend-react", "frontend-vue"])("%s: размеры 15–20, уровни и квоты тем точно, conflict ≤1", (track) => {
    let runs = 0;
    for (let seed = 1; seed <= 1000; seed += 1) {
      const size = 15 + (seed % 6);
      const { codes, violations } = generateSet({ questions: BANK, track, size, rules: RULES, rng: rngFrom(seed * 7919) });
      runs += 1;
      expect(codes).toHaveLength(size);
      expect(new Set(codes).size).toBe(size);
      const want = levelQuota(size, RULES);
      LEVELS.forEach((l) => expect(countBy(codes, (q) => q.level === l)).toBe(want[l]));
      topicQuota(RULES, track, size).forEach((g) => {
        expect(countBy(codes, (q) => g.topics.includes(q.topic))).toBe(g.count);
      });
      codes.forEach((c) => expect(byCode.get(c).tracks).toContain(track));
      const groups = codes.map((c) => byCode.get(c).conflictGroup).filter(Boolean);
      expect(new Set(groups).size).toBe(groups.length);
      // Нарушений квот тем и уровней нет; мягкие (amaliy/мини-задание) допустимы, но видны.
      expect(violations.join("|")).not.toMatch(/квоты тем/);
    }
    expect(runs).toBe(1000);
  });

  test("нарушение мягкого правила не прячется, но не ломает жёсткое", () => {
    const noPractical = BANK.map((q) => ({ ...q, isPractical: false }));
    const r = generateSet({ questions: noPractical, track: "frontend-react", size: 18, rules: RULES, rng: rngFrom(5) });
    expect(r.codes).toHaveLength(18);
    expect(r.violations.join(" ")).toMatch(/amaliy 0 < 6/);
  });

  test("банк не тянет квоты тем вместе с уровнями → набор по уровням + видимое нарушение", () => {
    // Правило требует 3 qiyin html, а в синтетическом банке html/qiyin всего 1.
    const hard = { ...RULES, quotas: { "frontend-react": { 18: [
      { topics: ["html"], count: 12 }, { topics: ["css"], count: 2 }, { topics: ["js"], count: 2 }, { topics: ["react"], count: 2 },
    ] } } };
    const r = generateSet({ questions: BANK, track: "frontend-react", size: 18, rules: hard, rng: rngFrom(9) });
    const want = levelQuota(18, hard);
    LEVELS.forEach((l) => expect(countBy(r.codes, (q) => q.level === l)).toBe(want[l]));
    expect(r.violations[0]).toMatch(/квоты тем не соблюдены/);
  });

  test("exclude: 3 прошлых набора не повторяются, пока банк позволяет", () => {
    const rng = rngFrom(42);
    const history = [];
    for (let i = 0; i < 40; i += 1) {
      const exclude = history.slice(-3).flat();
      const { codes } = generateSet({ questions: BANK, track: "frontend-react", size: 15, rules: RULES, exclude, rng });
      const overlap = codes.filter((c) => exclude.includes(c)).length;
      // Свежих вопросов хватает не всегда (js/orta 15 штук) — но пересечение заметно ниже случайного.
      expect(overlap).toBeLessThanOrEqual(6);
      history.push(codes);
    }
  });
});

describe("ротация наборов", () => {
  const mk = (n, extra = {}) => ({ _id: `s${n}`, number: n, usedCount: 0, overlap: 0, recent: false, ...extra });

  test("предложение — не из последних 3, затем реже использованный, затем меньший номер", () => {
    const sets = Array.from({ length: 15 }, (_, i) => mk(i + 1));
    const used = new Map();
    const recent = [];
    for (let step = 0; step < 100; step += 1) {
      const list = sets.map((s) => ({ ...s, usedCount: used.get(s._id) || 0, recent: recent.slice(-3).includes(s._id) }));
      const pick = rankSets(list)[0];
      expect(recent.slice(-3)).not.toContain(pick._id);
      used.set(pick._id, (used.get(pick._id) || 0) + 1);
      recent.push(pick._id);
    }
    const counts = [...used.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1); // равномерно
  });

  test("пересдача: меньшее пересечение важнее частоты, но не важнее «недавний»", () => {
    const list = [
      mk(1, { overlap: 7 }), mk(2, { overlap: 1, usedCount: 5 }), mk(3, { overlap: 0, recent: true }), mk(4, { overlap: 4 }),
    ];
    expect(rankSets(list).map((s) => s.number)).toEqual([2, 4, 1, 3]);
  });

  test("пересечения: счёт и попарная матрица", () => {
    expect(overlapCount(["a", "b", "c"], ["b", "c", "d"])).toBe(2);
    expect(overlapMatrix([["a", "b"], ["b", "c"], ["x"]])).toEqual([[2, 1, 0], [1, 2, 0], [0, 0, 1]]);
  });
});

describe("повторы — не нарушение", () => {
  test("при тесном банке повторы идут в repeated, violations пуст, повторов минимум", () => {
    // Исключаем почти все свежие: повторы неизбежны, но правило уровней/квот соблюдено без нарушений.
    const exclude = BANK.filter((q) => q.tracks.includes("frontend-react")).slice(0, 45).map((q) => q.code);
    for (let seed = 1; seed <= 100; seed += 1) {
      const r = generateSet({ questions: BANK, track: "frontend-react", size: 18, rules: RULES, exclude, rng: rngFrom(seed) });
      expect(r.codes).toHaveLength(18);
      expect(r.violations.join("|")).not.toMatch(/повтор/);
      expect(r.repeated.every((c) => exclude.includes(c))).toBe(true);
      expect(r.repeated).toEqual(r.codes.filter((c) => exclude.includes(c)));
    }
  });
});

describe("ремонт мягких правил", () => {
  test("мини-задание и amaliy из исключённых всё равно попадают в набор — повтор дешевле нарушения", () => {
    const mini = BANK.filter((q) => q.isMiniTask && q.tracks.includes("frontend-react"));
    const practical = BANK.filter((q) => q.isPractical && q.tracks.includes("frontend-react"));
    const exclude = [...mini, ...practical].map((q) => q.code);
    expect(mini.length).toBeGreaterThan(0);
    for (let seed = 1; seed <= 200; seed += 1) {
      const r = generateSet({ questions: BANK, track: "frontend-react", size: 18, rules: RULES, exclude, rng: rngFrom(seed) });
      expect(r.violations).toEqual([]);
      expect(countBy(r.codes, (q) => q.isMiniTask)).toBeGreaterThanOrEqual(1);
      expect(countBy(r.codes, (q) => q.isPractical)).toBeGreaterThanOrEqual(RULES.minPractical);
      expect(r.repeated.length).toBeGreaterThan(0);
      const want = levelQuota(18, RULES);
      LEVELS.forEach((l) => expect(countBy(r.codes, (q) => q.level === l)).toBe(want[l]));
      topicQuota(RULES, "frontend-react", 18).forEach((g) => expect(countBy(r.codes, (q) => g.topics.includes(q.topic))).toBe(g.count));
    }
  });
});
