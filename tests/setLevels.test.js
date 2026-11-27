// Одинаковая сложность каждого собеседования (Абубакир, 27.11): состав набора
// по уровням обязателен. Данные синтетические.
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { levelQuota, checkSetLevels } = require("../src/utils/questionBank/setLevels");
const { validateBank } = require("../src/utils/questionBank/parseBank");
const BankQuestion = require("../src/models/bankQuestionModel");
const InterviewSet = require("../src/models/interviewSetModel");
const Setting = require("../src/models/settingModel");

const RULES = { levels: { 15: { oson: 3, orta: 8, qiyin: 4 }, 18: { oson: 4, orta: 9, qiyin: 5 }, 20: { oson: 4, orta: 11, qiyin: 5 } } };
const levelsOf = (o, m, q) => [...Array(o).fill("oson"), ...Array(m).fill("orta"), ...Array(q).fill("qiyin")];

describe("levelQuota / checkSetLevels", () => {
  test("явное правило важнее пропорции", () => {
    expect(levelQuota(20, RULES)).toEqual({ oson: 4, orta: 11, qiyin: 5 });
    expect(levelQuota(15, RULES)).toEqual({ oson: 3, orta: 8, qiyin: 4 });
  });
  test("внутри 15–20 без правила — пропорционально 18 (сумма = размер)", () => {
    for (const n of [16, 17, 19]) {
      const q = levelQuota(n, RULES);
      expect(q.oson + q.orta + q.qiyin).toBe(n);
    }
    expect(levelQuota(16, RULES)).toEqual({ oson: 4, orta: 8, qiyin: 4 });
    expect(levelQuota(18, {})).toEqual({ oson: 4, orta: 9, qiyin: 5 });
  });
  test("вне 15–20 правила нет — не проверяется", () => {
    expect(levelQuota(6, RULES)).toBe(null);
    expect(checkSetLevels(levelsOf(2, 2, 2), RULES).ok).toBe(true);
  });
  test("18 вопросов: 4/9/5 ок, 5/8/5 нет", () => {
    expect(checkSetLevels(levelsOf(4, 9, 5), RULES).ok).toBe(true);
    expect(checkSetLevels(levelsOf(5, 8, 5), RULES)).toMatchObject({ ok: false, got: { oson: 5, orta: 8, qiyin: 5 } });
  });
  test("импорт: неверный состав — ошибка валидатора, не предупреждение", () => {
    const questions = levelsOf(5, 8, 5).map((level, i) => ({ code: `J${i + 1}`, topic: "js", tracks: ["frontend-react"], level, isPractical: true }));
    const parsed = { questions, sets: [{ track: "frontend-react", number: 1, size: 18, questionCodes: questions.map((q) => q.code) }], rules: RULES };
    const { errors } = validateBank(parsed);
    expect(errors).toEqual(["frontend-react #1: уровни 5/8/5, по правилу 4/9/5"]);
  });
});

describe("InterviewSet не сохраняется с неверным составом", () => {
  jest.setTimeout(120000);
  let mongod;
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await BankQuestion.insertMany(levelsOf(6, 12, 7).map((level, i) => ({
      code: `J${i + 1}`, topic: "js", tracks: ["frontend-react"], level, prompt: `sintetik ${i}`,
    })));
    await Setting.create({ key: "questionBankRules", value: RULES });
  });
  afterAll(async () => { await mongoose.disconnect(); await mongod.stop(); });

  const pick = (o, m, q) => [
    ...Array.from({ length: o }, (_, i) => `J${i + 1}`),
    ...Array.from({ length: m }, (_, i) => `J${i + 7}`),
    ...Array.from({ length: q }, (_, i) => `J${i + 19}`),
  ];

  test("4/9/5 сохраняется, size считается сам", async () => {
    const s = await InterviewSet.create({ track: "frontend-react", number: 1, questionCodes: pick(4, 9, 5) });
    expect(s.size).toBe(18);
  });
  test("5/8/5 — отказ; правка существующего набора тоже проверяется", async () => {
    await expect(InterviewSet.create({ track: "frontend-react", number: 2, questionCodes: pick(5, 8, 5) }))
      .rejects.toThrow(/уровни 5\/8\/5, по правилу 4\/9\/5/);
    const s = await InterviewSet.findOne({ number: 1 });
    s.questionCodes = pick(4, 8, 6);
    await expect(s.save()).rejects.toThrow(/одинаковыми по сложности/);
  });
  test("код не из банка — отказ", async () => {
    await expect(InterviewSet.create({ track: "frontend-react", number: 3, questionCodes: ["J1", "J99"] })).rejects.toThrow(/нет в банке J99/);
  });
});
