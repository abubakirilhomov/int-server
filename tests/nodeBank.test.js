// Банк Node (27.11): импорт неактивным, общее правило не трогается, тема node —
// в направлениях JS · React и JS · Vue. Только синтетика: настоящий банк в git не кладём.
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const BankQuestion = require("../src/models/bankQuestionModel");
const InterviewSet = require("../src/models/interviewSetModel");
const Setting = require("../src/models/settingModel");
const { parseBank, validateBank } = require("../src/utils/questionBank/parseBank");
const { applyBank } = require("../src/services/questionBankImport");
const { exportSource } = require("../src/services/questionTranslations");
const { generateSet } = require("../src/utils/questionBank/generateSet");
const { checkComposition, trackRules } = require("../src/utils/questionBank/trackRules");
const { syntheticBlocks, syntheticNodeBlocks } = require("./helpers/syntheticBank");

let mongod;
beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
beforeEach(async () => {
  await Promise.all([BankQuestion.deleteMany({}), InterviewSet.deleteMany({}), Setting.deleteMany({})]);
  await applyBank(parseBank(syntheticBlocks()));
});

describe("разбор", () => {
  test("только N-вопросы без наборов → формат node; группы с префиксом n; правило из текста не берётся в квоты", () => {
    const parsed = parseBank(syntheticNodeBlocks());
    expect(parsed.format).toBe("node");
    expect(parsed.sets).toEqual([]);
    expect(parsed.questions.map((q) => [q.code, q.topic, q.level, q.isPractical, q.isMiniTask])).toEqual([
      ["N1", "node", "oson", true, false], ["N2", "node", "orta", false, true], ["N3", "node", "qiyin", true, false],
    ]);
    expect(parsed.questions.every((q) => q.tracks.join() === "frontend-react,frontend-vue,backend-nodejs")).toBe(true);
    expect(parsed.questions.map((q) => q.conflictGroup)).toEqual(["n1", "n2", "n1,n2"]);
    expect(parsed.questions[0].expectedAnswer).toBe("Sintetik javob N1.\n\nBaholash: ✓ — sintetik mezon.");
    expect(parsed.rules.quotas).toEqual({});
    expect(parsed.declaredCounts).toEqual({ node: 3 });
    expect(validateBank(parsed).errors).toEqual([]);
  });

  test("JS-банк остаётся форматом js с группами g…", () => {
    const parsed = parseBank(syntheticBlocks());
    expect(parsed.format).toBe("js");
    expect(parsed.questions.find((q) => q.code === "C2").conflictGroup).toBe("g1");
  });
});

describe("импорт", () => {
  test("вопросы неактивны (notCovered), общее правило набора не перезаписано, повтор = 0 изменений", async () => {
    const before = await Setting.findOne({ key: "questionBankRules" }).lean();
    const r = await applyBank(parseBank(syntheticNodeBlocks()));
    expect(r.questions.created).toBe(3);
    expect(r.sets.created).toBe(0);
    const qs = await BankQuestion.find({ topic: "node" }).lean();
    expect(qs.map((q) => [q.code, q.isActive, q.notCovered])).toEqual([["N1", false, true], ["N2", false, true], ["N3", false, true]]);
    const after = await Setting.findOne({ key: "questionBankRules" }).lean();
    expect(after.value).toEqual(before.value);
    expect(after.value.quotas["frontend-react"]).toBeTruthy();

    const again = await applyBank(parseBank(syntheticNodeBlocks()));
    expect(again.questions).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
  });

  test("неактивные не попадают в генератор; выгрузка перевода — только с includeInactive", async () => {
    await applyBank(parseBank(syntheticNodeBlocks()));
    const questions = await BankQuestion.find({}).lean();
    const value = (await Setting.findOne({ key: "questionBankRules" }).lean()).value;
    // N-вопросы активны по треку (React), но неактивны — генератор их не видит даже при нехватке пула
    const rules = { ...value, levels: { ...value.levels, 6: { oson: 2, orta: 2, qiyin: 2 } } };
    const set = generateSet({ questions, track: "frontend-react", size: 6, rules, rng: () => 0.42 });
    expect(set.codes.length).toBe(6);
    expect(set.codes.some((c) => c.startsWith("N"))).toBe(false);

    expect((await exportSource({ codes: ["N1"] })).length).toBe(0);
    const src = await exportSource({ codes: ["N1", "N2"], includeInactive: true });
    expect(src.map((s) => s.code)).toEqual(["N1", "N2"]);
    expect(src[0].sourceHash).toBeTruthy();
  });

  test("включённый N-вопрос допустим в наборе React и Vue (не «чужое направление»)", async () => {
    await applyBank(parseBank(syntheticNodeBlocks()));
    await BankQuestion.updateMany({ topic: "node" }, { $set: { isActive: true, notCovered: false } });
    const rules = trackRules((await Setting.findOne({ key: "questionBankRules" }).lean()).value, "frontend-vue");
    const byCode = Object.fromEntries((await BankQuestion.find({}).lean()).map((q) => [q.code, q]));
    const qs = ["H1", "J1", "V1", "V2", "N1", "N3"].map((c) => byCode[c]);
    const res = checkComposition(qs, rules);
    expect(res.block.join(" ")).not.toMatch(/N1|N3/);
  });
});
