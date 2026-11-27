// Python-банк: разбор docx, правило набора на трек, генератор, импорт.
// Все вопросы СИНТЕТИЧЕСКИЕ: банк в репозиторий не кладём (репо публичный).
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { syntheticBlocks, syntheticPythonBlocks } = require("./helpers/syntheticBank");
const { parsePythonBank, validatePythonBank, isPythonBank, codeLang } = require("../src/utils/questionBank/parseBankPython");
const { parseBank } = require("../src/utils/questionBank/parseBank");
const { trackRules, checkComposition, minPracticalFor, validateTrackRules, isOrdered } = require("../src/utils/questionBank/trackRules");
const { groupsOf, groupIdsByCode } = require("../src/utils/questionBank/conflicts");
const { generateSet } = require("../src/utils/questionBank/generateSet");
const topics = require("../src/config/questionBankTopics");
const { applyBank } = require("../src/services/questionBankImport");
const BankQuestion = require("../src/models/bankQuestionModel");
const InterviewSet = require("../src/models/interviewSetModel");
const Setting = require("../src/models/settingModel");

jest.setTimeout(120000);

describe("направления найма и коды Python", () => {
  test("в выборе три направления; backend-nodejs — архивное, но в enum'ах остаётся", () => {
    expect(topics.ACTIVE_TRACKS).toEqual(["frontend-react", "frontend-vue", "backend-python"]);
    expect(topics.TRACK_LABELS["frontend-react"].uz).toBe("JS · React");
    expect(topics.TRACK_LABELS["frontend-vue"].uz).toBe("JS · Vue");
    expect(topics.TRACK_LABELS["backend-python"].uz).toBe("Python");
    expect(topics.BANK_TRACKS).toContain("backend-nodejs");
    expect(require("../src/models/interviewModel").TRACKS).toEqual(expect.arrayContaining(["backend-nodejs", "backend-python", "frontend-vue"]));
  });

  test("сфера заявки → трек: Vue и Python больше не сводятся к React", () => {
    expect(topics.sphereToTrack("frontend-vue")).toBe("frontend-vue");
    expect(topics.sphereToTrack("backend-python")).toBe("backend-python");
    expect(topics.sphereToTrack("backend-nodejs")).toBe("backend-nodejs");
    expect(topics.sphereToTrack("mern-stack")).toBe("frontend-react");
  });

  test("код M3-05 распознаётся, тема = модуль, редактор python / sql (M7)", () => {
    const re = new RegExp(`^${topics.CODE_PATTERN}$`);
    expect(["M3-05", "M10-13", "J22", "H1"].every((c) => re.test(c))).toBe(true);
    expect(["M3", "M3-5", "X1", "M100-01"].some((c) => re.test(c))).toBe(false);
    expect(topics.defOfCode("M7-01")).toMatchObject({ topic: "py-m7", editor: "sql", tracks: ["backend-python"] });
    expect(topics.defOfCode("J3").topic).toBe("js");
    expect(topics.editorFor({ answerKind: "code", code: "M4-02" })).toBe("python");
    expect(topics.editorFor({ answerKind: "code", code: "M7-02" })).toBe("sql");
    expect(topics.editorFor({ answerKind: "code", code: "M7-02", editor: "python" })).toBe("python");
    expect(topics.TOPICS.indexOf("py-m3")).toBeLessThan(topics.TOPICS.indexOf("py-m11"));
  });
});

describe("разбор Python-банка", () => {
  const parsed = parsePythonBank(syntheticPythonBlocks());
  const byCode = Object.fromEntries(parsed.questions.map((q) => [q.code, q]));

  test("формат узнаётся по ID с модулем; JS-банк — не Python", () => {
    expect(isPythonBank(syntheticPythonBlocks())).toBe(true);
    expect(isPythonBank(syntheticBlocks())).toBe(false);
  });

  test("вопросы: модули, уровни, раздел 5 — неактивные «ещё не пройдено», подтема M10", () => {
    expect(parsed.questions).toHaveLength(13);
    expect(parsed.questions.filter((q) => q.isActive)).toHaveLength(11);
    expect(byCode["M10-01"]).toMatchObject({ isActive: false, notCovered: true, subtopic: "auth", topic: "py-m10" });
    expect(byCode["M10-01"].prompt.startsWith("Sintetik auth")).toBe(true); // метка подтемы снята с текста
    expect(byCode["M5-01"]).toMatchObject({ isActive: false, notCovered: true, subtopic: null });
    expect(byCode["M3-01"]).toMatchObject({ level: "oson", isPractical: true, answerKind: "code", order: 1 });
    expect(byCode["M3-03"].isMiniTask).toBe(true);
    expect(parsed.declaredCounts).toMatchObject({ "py-m3": 4, "py-m4": 4, "py-m7": 3, "py-m10": 1, "py-m5": 1 });
  });

  test("код: язык блока по содержимому, пустая строка внутри кода сохраняется", () => {
    expect(byCode["M3-01"].prompt).toContain("```python\ndef f():\n    return 1\n\nprint(f())\n```");
    expect(byCode["M7-01"].prompt).toContain("```sql\nSELECT");
    expect(byCode["M5-01"].expectedAnswer).toContain("```html\n<ul>");
    expect(codeLang(["with open('a') as f:"])).toBe("python"); // «with» в нижнем регистре — не SQL
    expect(codeLang(["WITH x AS (SELECT 1)"])).toBe("sql");
  });

  test("редактор amaliy: python, sql (весь код — SQL), у текстовых вопросов нет", () => {
    expect(byCode["M3-01"].editor).toBe("python");
    expect(byCode["M3-03"].editor).toBe("python");
    expect(byCode["M7-01"].editor).toBe("sql");
    expect(byCode["M7-02"].editor).toBe("sql"); // кода в вопросе нет — по ответу
    expect(byCode["M3-02"].editor).toBeNull();
  });

  test("правило трека: квоты по модулям, amaliy по размеру, мини-задание, порядок, extras HTML/CSS", () => {
    expect(parsed.rules.quotas[6]).toEqual([
      { topics: ["py-m3"], count: 2 }, { topics: ["py-m4"], count: 2 }, { topics: ["py-m7"], count: 2 },
    ]);
    expect(parsed.rules.levels[18]).toEqual({ oson: 4, orta: 9, qiyin: 5 });
    expect(parsed.rules).toMatchObject({ minPractical: 2, minPracticalBySize: { 20: 3 }, requireMiniTask: true, order: "module-level" });
    expect(parsed.rules.extras).toEqual({ codes: ["H2", "C1"], exclude: ["H1"], max: 2, maxTotal: 20 });
  });

  test("conflict-группы: вопрос может быть в двух группах", () => {
    expect(byCode["M7-01"].conflictGroup).toBe("p2,p3");
    expect(groupsOf(byCode["M7-01"])).toEqual(["p2", "p3"]);
    expect(groupsOf({ conflictGroup: null })).toEqual([]);
    expect(groupIdsByCode([["A", "B"], ["B", "C"]], "x")).toEqual({ A: "x1", B: "x1,x2", C: "x2" });
  });

  test("наборы: полный и короткий вид; проверка — 0 ошибок, мини-задание — предупреждение", () => {
    expect(parsed.sets.map((s) => [s.number, s.size])).toEqual([[1, 6], [2, 6]]);
    expect(parsed.sets.every((s) => s.track === "backend-python")).toBe(true);
    const v = validatePythonBank(parsed);
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual(["backend-python #1: нет мини-задания"]);
  });

  test("сломанный набор: conflict и порядок — ошибки; extras ищутся в JS-банке", () => {
    const broken = parsePythonBank(syntheticPythonBlocks({ brokenSet: true }));
    const v = validatePythonBank(broken, { jsBank: [{ code: "H2", isActive: true }] });
    expect(v.errors.some((e) => e.includes("одна идея") && e.includes("M3-01, M4-01"))).toBe(true);
    expect(v.errors.some((e) => e.includes("порядок"))).toBe(true);
    expect(v.warnings.some((w) => w.includes("не найдены") && w.includes("C1"))).toBe(true);
  });

  test("набор с вопросом ещё не пройденного модуля — ошибка", () => {
    const p = parsePythonBank(syntheticPythonBlocks());
    p.sets[0].questionCodes[5] = "M10-01";
    expect(validatePythonBank(p).errors.some((e) => e.includes("ещё не пройденных") && e.includes("M10-01"))).toBe(true);
  });

  test("стабильный contentHash: повторный разбор даёт те же хеши", () => {
    const again = parsePythonBank(syntheticPythonBlocks());
    expect(again.questions.map((q) => q.contentHash)).toEqual(parsed.questions.map((q) => q.contentHash));
  });
});

// Метаданные «как в банке» для генератора (без текстов).
function pyPool() {
  const mods = [3, 4, 6, 7, 8, 9];
  const lv = ["oson", "oson", "orta", "orta", "orta", "orta", "qiyin", "qiyin"];
  const qs = [];
  for (const m of mods) {
    lv.forEach((level, i) => {
      const code = `M${m}-${String(i + 1).padStart(2, "0")}`;
      qs.push({
        code, topic: `py-m${m}`, tracks: ["backend-python"], level, order: i + 1, isActive: true,
        isPractical: i % 2 === 0, isMiniTask: (m === 4 && i === 4) || (m === 9 && i === 6), conflictGroup: null,
      });
    });
  }
  const set = (code, g) => { qs.find((q) => q.code === code).conflictGroup = g; };
  set("M3-03", "p1"); set("M4-03", "p1");
  set("M6-03", "p2"); set("M6-04", "p3"); set("M8-03", "p2,p3");
  qs.push({ code: "M10-01", topic: "py-m10", tracks: ["backend-python"], level: "orta", order: 1, isActive: false, notCovered: true });
  // JS-банк: extras для Python (H2, C1) и запрещённый H1.
  qs.push({ code: "H1", topic: "html", tracks: ["frontend-react", "frontend-vue"], level: "oson", order: 1, isActive: true, isPractical: true });
  qs.push({ code: "H2", topic: "html", tracks: ["frontend-react", "frontend-vue"], level: "orta", order: 2, isActive: true, isPractical: true });
  qs.push({ code: "C1", topic: "css", tracks: ["frontend-react", "frontend-vue"], level: "oson", order: 1, isActive: true });
  return qs;
}
const PY_RULES = {
  // общие (JS) поля — Python их не наследует там, где задано своё
  levels: { 18: { oson: 4, orta: 9, qiyin: 5 } }, minPractical: 6,
  quotas: { "frontend-react": { 18: [{ topics: ["js"], count: 18 }] } },
  tracks: {
    "backend-python": {
      levels: { 15: { oson: 3, orta: 8, qiyin: 4 }, 18: { oson: 4, orta: 9, qiyin: 5 }, 20: { oson: 4, orta: 11, qiyin: 5 } },
      minPractical: 6, minPracticalBySize: { 20: 7 }, requireMiniTask: true, order: "module-level",
      quotas: {
        15: [["py-m3", 3], ["py-m4", 3], ["py-m6", 2], ["py-m7", 3], ["py-m8", 2], ["py-m9", 2]].map(([t, c]) => ({ topics: [t], count: c })),
        18: [["py-m3", 3], ["py-m4", 4], ["py-m6", 3], ["py-m7", 3], ["py-m8", 2], ["py-m9", 3]].map(([t, c]) => ({ topics: [t], count: c })),
        20: [["py-m3", 3], ["py-m4", 5], ["py-m6", 3], ["py-m7", 4], ["py-m8", 2], ["py-m9", 3]].map(([t, c]) => ({ topics: [t], count: c })),
      },
      extras: { codes: ["H2", "C1"], exclude: ["H1"], max: 2, maxTotal: 20 },
    },
  },
};

describe("правило набора на трек", () => {
  test("правило трека перекрывает общее; без своего — общее (JS)", () => {
    const py = trackRules(PY_RULES, "backend-python");
    expect(py).toMatchObject({ unit: "module", minPractical: 6, requireMiniTask: true, source: "import" });
    expect(py.quotas[18][0]).toEqual({ topics: ["py-m3"], count: 3 });
    const js = trackRules(PY_RULES, "frontend-react");
    expect(js).toMatchObject({ unit: "topic", minPractical: 6, extras: null, source: "global" });
    expect(js.quotas[18]).toEqual([{ topics: ["js"], count: 18 }]);
    expect(minPracticalFor(py, 20)).toBe(7);
    expect(minPracticalFor(py, 18)).toBe(6);
    expect(trackRules(py, "backend-python")).toBe(py); // уже нормализовано
  });

  test("extras: уровни по основному составу, лимиты — блок; H1 запрещён", () => {
    const pool = pyPool();
    const tr = trackRules(PY_RULES, "backend-python");
    const r = generateSet({ questions: pool, track: "backend-python", size: 18, rules: PY_RULES, rng: seeded(3) });
    const by = new Map(pool.map((q) => [q.code, q]));
    const base = r.codes.map((c) => by.get(c));
    const withTwo = [by.get("H2"), by.get("C1"), ...base];
    expect(checkComposition(withTwo, tr).block).toEqual([]);
    expect(checkComposition([by.get("H1"), ...base], tr).block.join(" ")).toContain("не брать: H1");
    const tooMany = { ...tr, extras: { ...tr.extras, max: 1 } };
    expect(checkComposition(withTwo, tooMany).block.join(" ")).toContain("дополнительных вопросов 2 > 1");
    const tooBig = { ...tr, extras: { ...tr.extras, maxTotal: 19 } };
    expect(checkComposition(withTwo, tooBig).block.join(" ")).toContain("всего вопросов 20 > 19");
  });

  test("валидация правила из админки: суммы квот и уровней = размер", () => {
    expect(validateTrackRules({ levels: { 18: { oson: 4, orta: 9, qiyin: 5 } } }).errors).toEqual([]);
    expect(validateTrackRules({ levels: { 18: { oson: 4, orta: 9, qiyin: 4 } } }).errors[0]).toContain("сумма 17");
    expect(validateTrackRules({ quotas: { 15: [{ topics: ["py-m3"], count: 15 }] } }).errors).toEqual([]);
    expect(validateTrackRules({ quotas: { 15: [{ topics: ["py-m99"], count: 15 }] } }).errors[0]).toContain("неизвестная тема");
    expect(validateTrackRules({ quotas: { 16: [] } }).errors[0]).toContain("15/18/20");
    expect(validateTrackRules({ extras: { codes: ["H2"], max: 9 } }).errors[0]).toContain("extras.max");
  });

  test("порядок «модуль → уровень → номер»", () => {
    const a = { topic: "py-m3", level: "oson", order: 2 };
    const b = { topic: "py-m3", level: "qiyin", order: 1 };
    const c = { topic: "py-m4", level: "oson", order: 1 };
    expect(isOrdered([a, b, c])).toBe(true);
    expect(isOrdered([b, a, c])).toBe(false);
    expect(isOrdered([c, a])).toBe(false);
  });
});

// Детерминированный rng для воспроизводимых тестов.
function seeded(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

describe("генератор Python-набора", () => {
  test.each([15, 18, 20])("размер %i: квоты модулей, уровни, amaliy, мини-задание, conflict, порядок — 0 нарушений", (size) => {
    const pool = pyPool();
    const tr = trackRules(PY_RULES, "backend-python");
    for (let seed = 1; seed <= 15; seed += 1) {
      const r = generateSet({ questions: pool, track: "backend-python", size, rules: PY_RULES, rng: seeded(seed) });
      expect(r.violations).toEqual([]);
      expect(r.codes).toHaveLength(size);
      expect(r.codes).not.toContain("M10-01"); // ещё не пройдено
      const by = new Map(pool.map((q) => [q.code, q]));
      const c = checkComposition(r.codes.map((x) => by.get(x)), tr);
      expect(c.block).toEqual([]);
      expect(c.warn).toEqual([]);
    }
  });

  test("extras: +2 HTML/CSS первыми, уровни по 18 основным, всего 20; H1 не берётся", () => {
    const pool = pyPool();
    const r = generateSet({ questions: pool, track: "backend-python", size: 18, extras: 2, rules: PY_RULES, rng: seeded(7) });
    expect(r.codes).toHaveLength(20);
    expect(r.extras.sort()).toEqual(["C1", "H2"]);
    expect(r.codes.slice(0, 2).sort()).toEqual(["C1", "H2"]); // модули 1–2 идут перед M3
    expect(r.codes).not.toContain("H1");
    expect(r.violations).toEqual([]);
  });

  test("extras: свежие первыми — недавний H2 уступает C1", () => {
    const r = generateSet({ questions: pyPool(), track: "backend-python", size: 18, extras: 1, exclude: ["H2"], rules: PY_RULES, rng: seeded(2) });
    expect(r.extras).toEqual(["C1"]);
  });

  test("extras сверх лимита трека обрезаются; больше 20 всего — ошибка", () => {
    const r = generateSet({ questions: pyPool(), track: "backend-python", size: 18, extras: 5, rules: PY_RULES, rng: seeded(4) });
    expect(r.extras).toHaveLength(2);
    expect(() => generateSet({ questions: pyPool(), track: "backend-python", size: 20, extras: 1, rules: PY_RULES })).toThrow(/21 > 20/);
  });

  test("JS-трек без правила трека — как раньше (общие поля)", () => {
    const pool = [];
    ["oson", "oson", "oson", "oson", "orta", "orta", "orta", "orta", "orta", "orta", "orta", "orta", "orta", "qiyin", "qiyin", "qiyin", "qiyin", "qiyin"]
      .forEach((level, i) => pool.push({ code: `J${i + 1}`, topic: "js", tracks: ["frontend-react"], level, order: i + 1, isPractical: i < 7, isActive: true }));
    const r = generateSet({ questions: pool, track: "frontend-react", size: 18, rules: PY_RULES, rng: seeded(5) });
    expect(r.codes).toHaveLength(18);
    expect(r.violations).toEqual([]);
  });
});

describe("импорт Python-банка в БД", () => {
  let mongod;
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  test("вопросы, неактивные «ещё не пройдено», правило в tracks — JS-правила не затираются; повтор = 0", async () => {
    // JS-банк уже импортирован: его общие правила должны остаться.
    await applyBank(parseBank(syntheticBlocks()));
    const jsRules = (await Setting.findOne({ key: "questionBankRules" }).lean()).value;

    const parsed = parsePythonBank(syntheticPythonBlocks());
    const r = await applyBank(parsed);
    expect(r.questions.created).toBe(13);
    expect(r.sets.created).toBe(2);
    expect(r.rules).toBe("created");

    const m10 = await BankQuestion.findOne({ code: "M10-01" }).lean();
    expect(m10).toMatchObject({ isActive: false, notCovered: true, subtopic: "auth", editor: "python", tracks: ["backend-python"] });
    expect((await BankQuestion.findOne({ code: "M7-02" }).lean()).editor).toBe("sql");

    const value = (await Setting.findOne({ key: "questionBankRules" }).lean()).value;
    expect(value.levels).toEqual(jsRules.levels);
    expect(value.quotas).toEqual(jsRules.quotas);
    expect(value.conflictGroups).toEqual(jsRules.conflictGroups);
    expect(value.tracks["backend-python"]).toMatchObject({ minPractical: 2, updatedBy: "import", order: "module-level" });

    const again = await applyBank(parsePythonBank(syntheticPythonBlocks()));
    expect(again.questions).toMatchObject({ created: 0, updated: 0, unchanged: 13 });
    expect(again.sets).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    expect(again.rules).toBe("unchanged");

    // Повторный импорт JS-банка не трогает правило Python.
    await applyBank(parseBank(syntheticBlocks()));
    expect((await Setting.findOne({ key: "questionBankRules" }).lean()).value.tracks["backend-python"]).toBeTruthy();
  });

  test("вопрос, включённый админом, и правило из админки повторный импорт не трогает", async () => {
    await BankQuestion.updateOne({ code: "M10-01" }, { $set: { isActive: true, notCovered: false, updatedBy: "admin1" } });
    await Setting.updateOne({ key: "questionBankRules" }, { $set: { "value.tracks.backend-python.updatedBy": "admin1" } });
    const parsed = parsePythonBank(syntheticPythonBlocks());
    parsed.questions.find((q) => q.code === "M10-01").contentHash = "changed";
    const r = await applyBank(parsed);
    expect(r.questions.skippedEdited).toEqual([JSON.stringify({ code: "M10-01" })]);
    expect(r.rules).toBe("skipped");
    expect((await BankQuestion.findOne({ code: "M10-01" }).lean()).isActive).toBe(true);
  });

  test("набор Python с extras сохраняется; с запрещённым или лишним — нет", async () => {
    await BankQuestion.updateOne({ code: "H2" }, { $set: { tracks: ["frontend-react", "frontend-vue"] } });
    await Setting.updateOne({ key: "questionBankRules" }, { $set: { "value.tracks.backend-python.extras": { codes: ["H2", "C1"], exclude: ["H1"], max: 1, maxTotal: 20 } } });
    const base = ["M3-01", "M3-04", "M4-02", "M4-03", "M7-02", "M7-03"];
    const ok = await InterviewSet.create({ track: "backend-python", number: 10, questionCodes: ["H2", ...base] });
    expect(ok.size).toBe(7);
    await expect(InterviewSet.create({ track: "backend-python", number: 11, questionCodes: ["H2", "C1", ...base] }))
      .rejects.toThrow(/дополнительных вопросов 2 > 1/);
    await expect(InterviewSet.create({ track: "backend-python", number: 12, questionCodes: ["H1", ...base] }))
      .rejects.toThrow(/не из направления backend-python: H1/);
  });
});
