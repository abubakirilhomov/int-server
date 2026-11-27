// Автотесты мини-заданий: формат, идемпотентная запись из файла, выгрузка. Всё синтетическое.
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const BankQuestion = require("../src/models/bankQuestionModel");
const { normalizeTests, testNames, TestsError, LIMITS } = require("../src/utils/questionBank/tests");
const { applyTests, exportTests } = require("../src/services/questionTests");

jest.setTimeout(60000);
let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await BankQuestion.insertMany(["J1", "J2"].map((code, i) => ({
    code, topic: "js", level: "orta", tracks: ["frontend-react"], order: i + 1,
    prompt: `Sintetik ${code}`, answerKind: "code",
  })));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const t = (over = {}) => ({ name: "ishlaydi", nameRu: "работает", code: "assert.equal(f(1), 1);", ...over });

describe("normalizeTests", () => {
  test("чистит до name/nameRu/code, пусто → []", () => {
    expect(normalizeTests([{ ...t(), evil: 1 }])).toEqual([t()]);
    expect(normalizeTests(null)).toEqual([]);
    expect(normalizeTests([])).toEqual([]);
  });

  test("ошибки перечисляются все сразу; код не выполняется", () => {
    globalThis.__SERVER_EXECUTED__ = false;
    let err;
    try {
      normalizeTests([t({ code: "globalThis.__SERVER_EXECUTED__ = true;" }), { name: "", code: "" }, t({ code: "foo(" }), 5]);
    } catch (e) { err = e; }
    expect(globalThis.__SERVER_EXECUTED__).toBe(false);
    expect(err).toBeInstanceOf(TestsError);
    expect(err.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("tests[1]: нужно название"),
      expect.stringContaining("tests[1]: нужен код"),
      expect.stringContaining("tests[2]"),
      expect.stringContaining("tests[3]: ожидается объект"),
    ]));
  });

  test("await внутри допустим (тело async-функции); лимиты", () => {
    expect(() => normalizeTests([t({ code: "await sleep(10); assert.ok(logs.length === 0);" })])).not.toThrow();
    expect(() => normalizeTests(Array.from({ length: LIMITS.count + 1 }, () => t()))).toThrow(/больше/);
    expect(() => normalizeTests([t({ code: "x".repeat(LIMITS.code + 1) })])).toThrow(/длиннее/);
    expect(() => normalizeTests("nope")).toThrow(/массив/);
  });

  test("testNames: только названия, язык с fallback на uz", () => {
    const list = [t(), t({ name: "faqat", nameRu: "" })];
    expect(testNames(list, "uz")).toEqual([{ name: "ishlaydi" }, { name: "faqat" }]);
    expect(testNames(list, "ru")).toEqual([{ name: "работает" }, { name: "faqat" }]);
  });
});

describe("applyTests / exportTests", () => {
  test("запись, повтор без изменений, dry-run, удаление, нет в банке, ошибка", async () => {
    const entries = [{ code: "J1", tests: [t()] }, { code: "J2", tests: [t({ name: "ikkinchi" })] }];
    expect(await applyTests(entries, { dryRun: true })).toMatchObject({ updated: 2, unchanged: 0 });
    expect(await BankQuestion.countDocuments({ "tests.0": { $exists: true } })).toBe(0);

    expect(await applyTests(entries)).toMatchObject({ updated: 2, unchanged: 0, removed: 0 });
    expect(await applyTests(entries)).toMatchObject({ updated: 0, unchanged: 2 }); // идемпотентно
    const doc = await BankQuestion.findOne({ code: "J1" }).select("+tests").lean();
    expect(doc.tests).toEqual([t()]);
    expect((await BankQuestion.findOne({ code: "J1" }).lean()).tests).toBeUndefined(); // select:false

    const exported = await exportTests();
    expect(exported.map((e) => e.code).sort()).toEqual(["J1", "J2"]);
    expect(await exportTests({ codes: ["J2"] })).toEqual([{ code: "J2", tests: [t({ name: "ikkinchi" })] }]);

    const r = await applyTests([{ code: "J1", tests: [] }, { code: "ZZ9", tests: [t()] }, { code: "J2", tests: [t({ code: "bad(" })] }]);
    expect(r).toMatchObject({ removed: 1, notFound: ["ZZ9"] });
    expect(r.invalid[0]).toContain("J2");
    expect((await BankQuestion.findOne({ code: "J2" }).select("+tests").lean()).tests).toEqual([t({ name: "ikkinchi" })]);
    expect((await BankQuestion.findOne({ code: "J1" }).select("+tests").lean()).tests).toEqual([]);
  });

  test("модель не сохраняет битый тест", async () => {
    const q = await BankQuestion.findOne({ code: "J2" }).select("+tests");
    q.tests = [{ name: "x", code: "oops(" }];
    await expect(q.save()).rejects.toThrow(/tests/);
  });
});
