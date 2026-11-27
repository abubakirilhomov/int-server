// Импорт банка в БД: идемпотентность, правки админа не затираются,
// ответ-черновик не отдаётся обычным find(). Банк синтетический.
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const BankQuestion = require("../src/models/bankQuestionModel");
const InterviewSet = require("../src/models/interviewSetModel");
const Setting = require("../src/models/settingModel");
const { parseBank } = require("../src/utils/questionBank/parseBank");
const { applyBank } = require("../src/services/questionBankImport");
const { syntheticBlocks } = require("./helpers/syntheticBank");

jest.setTimeout(120000);
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
});

test("первый импорт создаёт всё, повторный — ничего не меняет", async () => {
  const parsed = parseBank(syntheticBlocks());
  const r1 = await applyBank(parsed);
  expect(r1.questions).toMatchObject({ created: 12, updated: 0, unchanged: 0 });
  expect(r1.sets).toMatchObject({ created: 3 });
  expect(await BankQuestion.countDocuments()).toBe(12);
  expect(await InterviewSet.countDocuments()).toBe(3);
  const rules = await Setting.findOne({ key: "questionBankRules" }).lean();
  expect(rules.value.conflictGroups).toHaveLength(2);

  const r2 = await applyBank(parseBank(syntheticBlocks()));
  expect(r2.questions).toMatchObject({ created: 0, updated: 0, unchanged: 12 });
  expect(r2.sets).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
});

test("--dry-run ничего не пишет", async () => {
  const r = await applyBank(parseBank(syntheticBlocks()), { dryRun: true });
  expect(r.questions.created).toBe(12);
  expect(await BankQuestion.countDocuments()).toBe(0);
  expect(await Setting.countDocuments()).toBe(0);
});

test("изменённый в файле вопрос обновляется, version растёт", async () => {
  await applyBank(parseBank(syntheticBlocks()));
  const blocks = syntheticBlocks();
  const i = blocks.findIndex((b) => /^C1\./.test(b.text || ""));
  blocks[i] = { ...blocks[i], text: blocks[i].text + " yangi" };
  const r = await applyBank(parseBank(blocks));
  expect(r.questions).toMatchObject({ updated: 1, unchanged: 11 });
  const c1 = await BankQuestion.findOne({ code: "C1" }).lean();
  expect(c1.version).toBe(2);
  expect(c1.prompt).toContain("yangi");
});

test("вопрос, поправленный админом, импорт не затирает", async () => {
  await applyBank(parseBank(syntheticBlocks()));
  await BankQuestion.updateOne({ code: "R1" }, { $set: { prompt: "admin tahriri", updatedBy: "mentor-1", contentHash: "x" } });
  const r = await applyBank(parseBank(syntheticBlocks()));
  expect(r.questions.skippedEdited).toEqual([JSON.stringify({ code: "R1" })]);
  expect((await BankQuestion.findOne({ code: "R1" }).lean()).prompt).toBe("admin tahriri");
});

test("expectedAnswer и tests не возвращаются без явного +select", async () => {
  await applyBank(parseBank(syntheticBlocks()));
  const plain = await BankQuestion.findOne({ code: "H1" }).lean();
  expect(plain.expectedAnswer).toBeUndefined();
  expect(plain.tests).toBeUndefined();
  const full = await BankQuestion.findOne({ code: "H1" }).select("+expectedAnswer").lean();
  expect(full.expectedAnswer).toBe("Sintetik javob H1.");
});
