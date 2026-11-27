// Русский перевод банка: запись идемпотентна, uz не трогает, перевод с
// устаревшего uz-текста не пишется, повторный импорт docx перевод не стирает.
// Банк синтетический.
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const BankQuestion = require("../src/models/bankQuestionModel");
const InterviewSet = require("../src/models/interviewSetModel");
const Setting = require("../src/models/settingModel");
const { parseBank } = require("../src/utils/questionBank/parseBank");
const { applyBank } = require("../src/services/questionBankImport");
const { exportSource, applyTranslations, translationStats } = require("../src/services/questionTranslations");
const { translationStatus } = require("../src/utils/questionBank/i18n");
const { resolveInterviewMode, interviewModes } = require("../src/services/candidateInterviewMode");
const { syntheticBlocks, syntheticBackendBlocks } = require("./helpers/syntheticBank");

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
  await applyBank(parseBank(syntheticBlocks()));
});

const ru = (src) => ({
  code: src.code,
  sourceHash: src.sourceHash,
  promptRu: `RU ${src.code}`,
  promptShortRu: `RU кратко ${src.code}`,
  expectedAnswerRu: `RU ответ ${src.code}`,
});

test("выгрузка → перевод → повтор = 0 изменений; uz не тронут", async () => {
  const src = await exportSource();
  expect(src).toHaveLength(12);
  expect(src[0]).toEqual(expect.objectContaining({ code: expect.any(String), sourceHash: expect.any(String), expectedAnswer: expect.any(String) }));
  expect(await translationStats()).toEqual({ ok: 0, stale: 0, missing: 12 });

  const before = await BankQuestion.findOne({ code: "H1" }).select("+expectedAnswer").lean();
  const r1 = await applyTranslations(src.map(ru));
  expect(r1).toMatchObject({ updated: 12, unchanged: 0, stale: [], notFound: [], invalid: [] });
  const after = await BankQuestion.findOne({ code: "H1" }).select("+expectedAnswer +expectedAnswerRu").lean();
  expect(after).toMatchObject({ prompt: before.prompt, expectedAnswer: before.expectedAnswer, contentHash: before.contentHash,
    updatedBy: "import", promptRu: "RU H1", expectedAnswerRu: "RU ответ H1", ruUpdatedBy: "translation-import" });
  expect(translationStatus(after)).toBe("ok");
  expect(await translationStats()).toEqual({ ok: 12, stale: 0, missing: 0 });

  const r2 = await applyTranslations(src.map(ru));
  expect(r2).toMatchObject({ updated: 0, unchanged: 12 });
  expect((await exportSource({ onlyMissing: true }))).toHaveLength(0);
});

test("dry-run ничего не пишет", async () => {
  const src = await exportSource();
  const r = await applyTranslations(src.map(ru), { dryRun: true });
  expect(r.updated).toBe(12);
  expect(await translationStats()).toEqual({ ok: 0, stale: 0, missing: 12 });
});

test("ответ-черновик на ru скрыт от обычного find()", async () => {
  await applyTranslations((await exportSource()).map(ru));
  const plain = await BankQuestion.findOne({ code: "H1" }).lean();
  expect(plain.promptRu).toBe("RU H1");
  expect(plain.expectedAnswer).toBeUndefined();
  expect(plain.expectedAnswerRu).toBeUndefined();
});

test("повторный импорт docx перевод не стирает; изменённый uz делает перевод устаревшим", async () => {
  const src = await exportSource();
  await applyTranslations(src.map(ru));

  const again = await applyBank(parseBank(syntheticBlocks()));
  expect(again.questions).toMatchObject({ created: 0, updated: 0, unchanged: 12 });
  expect((await BankQuestion.findOne({ code: "H1" }).lean()).promptRu).toBe("RU H1");

  const changed = parseBank(syntheticBlocks());
  const h1 = changed.questions.find((q) => q.code === "H1");
  h1.prompt += " (tahrir)";
  h1.contentHash = "changed";
  await applyBank(changed);
  expect(await translationStats()).toEqual({ ok: 11, stale: 1, missing: 0 });
  expect((await exportSource({ onlyMissing: true })).map((q) => q.code)).toEqual(["H1"]);

  // Старый перевод (со старым sourceHash) не записывается.
  const r = await applyTranslations([{ ...ru(src.find((q) => q.code === "H1")), promptRu: "RU новое" }]);
  expect(r.stale).toEqual(["H1"]);
  expect((await BankQuestion.findOne({ code: "H1" }).lean()).promptRu).toBe("RU H1");
});

test("ошибочные записи: нет кода в банке, нет promptRu/sourceHash; правки админа не затираются без --force", async () => {
  const src = await exportSource();
  const r = await applyTranslations([
    { code: "Z1", sourceHash: "x", promptRu: "x" },
    { code: "H1", sourceHash: src[0].sourceHash, promptRu: "" },
    { code: "H2", promptRu: "без хеша" },
  ]);
  expect(r).toMatchObject({ updated: 0, invalid: ["H1", "H2"] });
  expect(r.notFound).toEqual(["Z1"]);

  await BankQuestion.updateOne({ code: "C1" }, { $set: { promptRu: "RU от админа", ruUpdatedBy: "admin-id" } });
  const c1 = src.find((q) => q.code === "C1");
  expect((await applyTranslations([ru(c1)])).skippedEdited).toEqual(["C1"]);
  expect((await applyTranslations([ru(c1)], { force: true })).updated).toBe(1);
});

test("варианты ответа: перевод по ключу, отметка верного скрыта от find()", async () => {
  await BankQuestion.updateOne({ code: "J2" }, { $set: { answerKind: "choice", options: [
    { key: "A", text: "Bir", correct: true }, { key: "B", text: "Ikki", correct: false },
  ] } });
  const [src] = await exportSource({ codes: ["J2"] });
  expect(src.options).toEqual([{ key: "A", text: "Bir" }, { key: "B", text: "Ikki" }]);
  const r = await applyTranslations([{ ...ru(src), options: [{ key: "A", textRu: "Один" }, { key: "B", textRu: "Два" }] }]);
  expect(r.updated).toBe(1);
  const plain = await BankQuestion.findOne({ code: "J2" }).lean();
  expect(plain.options).toEqual([{ key: "A", text: "Bir", textRu: "Один" }, { key: "B", text: "Ikki", textRu: "Два" }]);
  const full = await BankQuestion.findOne({ code: "J2" }).select("+options.correct").lean();
  expect(full.options.map((o) => o.correct)).toEqual([true, false]);
  expect((await applyTranslations([{ ...ru(src), options: [{ key: "A", textRu: "Один" }, { key: "B", textRu: "Два" }] }])).unchanged).toBe(1);
});

describe("backend-трек", () => {
  test("импорт backend-банка: треки, наборы, квоты; режим live только при наличии наборов", async () => {
    expect(await resolveInterviewMode("backend-nodejs")).toBe("checklist");
    expect(await interviewModes()).toEqual({ "frontend-react": "live", "frontend-vue": "live", "backend-nodejs": "checklist", "backend-python": "checklist" });

    const parsed = parseBank(syntheticBackendBlocks());
    const r = await applyBank(parsed);
    expect(r.questions.created).toBe(4);
    expect(r.sets.created).toBe(1);
    const n1 = await BankQuestion.findOne({ code: "N1" }).lean();
    expect(n1).toMatchObject({ topic: "node", tracks: ["backend-nodejs"] });
    expect(await resolveInterviewMode("backend-nodejs")).toBe("live");

    await InterviewSet.updateMany({ track: "backend-nodejs" }, { $set: { isActive: false } });
    expect(await resolveInterviewMode("backend-nodejs")).toBe("checklist");
  });

  test("трек вне bankTracks (Setting) → чек-лист даже с наборами", async () => {
    await Setting.create({ key: "candidateInterviewSettings", value: { bankTracks: ["frontend-react"] } });
    expect(await resolveInterviewMode("frontend-vue")).toBe("checklist");
    expect(await resolveInterviewMode("frontend-react")).toBe("live");
  });
});
