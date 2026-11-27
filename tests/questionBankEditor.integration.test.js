// Редактор банка и автотесты мини-заданий через HTTP (настоящий express + in-memory Mongo).
// Все вопросы и тесты СИНТЕТИЧЕСКИЕ: банк в репозиторий не кладём (репо публичный).
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-access-secret";
process.env.CANDIDATE_APP_URL = "https://candidate.example";
{
  const keys = require("web-push").generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || keys.privateKey;
}

const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const BankQuestion = require("../src/models/bankQuestionModel");
const InterviewSet = require("../src/models/interviewSetModel");
const Interview = require("../src/models/interviewModel");
const Application = require("../src/models/applicationModel");
const InterviewSession = require("../src/models/interviewSessionModel");
const Setting = require("../src/models/settingModel");
const globalErrorHandler = require("../src/controllers/errorController");
const { translationStatus } = require("../src/utils/questionBank/i18n");

jest.setTimeout(120000);

let mongod;
let server;
let base;

const LV = { oson: 2, orta: 2, qiyin: 2 };
const TEST_CODE = "assert.equal(sum(1, 2), 3); // MAXFIY_TEST_KODI";
const BANK = [
  ["H1", "html", "oson"], ["H2", "html", "orta"], ["C1", "css", "orta"], ["C2", "css", "qiyin"],
  ["C3", "css", "qiyin"], ["J1", "js", "orta"], ["J2", "js", "qiyin"], ["J3", "js", "oson"],
  ["R1", "react", "oson"], ["R2", "react", "qiyin"], ["R3", "react", "oson"], ["R4", "react", "orta"],
];
const SET1 = ["H1", "C1", "J1", "J2", "R1", "R2"];
const SET2 = ["H2", "C2", "C3", "J3", "R3", "R4"];

const sign = (role) => jwt.sign({ id: new mongoose.Types.ObjectId().toString(), role }, process.env.JWT_SECRET);
const adminToken = sign("admin");
const mentorToken = sign("mentor");

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, body: json, text };
}
const admin = (method, path, body) => api(method, path, { token: adminToken, body });

async function newInterview(name) {
  const app = await Application.create({
    firstName: name, lastName: "Test", phone: "+998000000000", telegramUsername: `t_${name.toLowerCase()}`,
    age: 18, branch: new mongoose.Types.ObjectId(), mentor: new mongoose.Types.ObjectId(),
    sphere: "frontend-react", shift: "morning", status: "interview_scheduled",
  });
  return Interview.create({ application: app._id, track: "frontend-react", scheduledAt: new Date(), status: "scheduled" });
}

async function resetBank() {
  await InterviewSession.deleteMany({});
  await BankQuestion.deleteMany({});
  await InterviewSet.deleteMany({});
  await BankQuestion.insertMany(BANK.map(([code, topic, level], i) => ({
    code, topic, level, tracks: ["frontend-react"], order: i + 1,
    isPractical: code === "J1", isMiniTask: code === "J1",
    prompt: `Sintetik savol ${code} matni`, promptRu: `Синтетический вопрос ${code}`,
    expectedAnswer: `javob-${code}`, expectedAnswerRu: `ответ-${code}`,
    answerKind: code === "J1" ? "code" : "text",
  })));
  // перевод актуален на старте
  for (const q of await BankQuestion.find({}).select("+expectedAnswer +expectedAnswerRu")) {
    q.ruSourceHash = require("../src/utils/questionBank/i18n").uzTextHash(q.toObject());
    await q.save();
  }
  await InterviewSet.create({ track: "frontend-react", number: 1, questionCodes: SET1, source: "docx" });
  await InterviewSet.create({ track: "frontend-react", number: 2, questionCodes: SET2, source: "docx" });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Setting.create({ key: "questionBankRules", value: { levels: { 6: LV } } });
  await resetBank();

  const app = express();
  app.use("/api/candidate/answers", express.json({ limit: "200kb" }));
  app.use("/api/question-bank", express.json({ limit: "100kb" }));
  app.use(express.json({ limit: "10kb" }));
  app.use("/api/candidate", require("../src/routes/candidateRoutes"));
  app.use("/api/interviews", require("../src/routes/interviewRoutes"));
  app.use("/api/question-bank", require("../src/routes/questionBankRoutes"));
  app.use(globalErrorHandler);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  await mongod.stop();
});

describe("доступ", () => {
  test("правка и создание только для админа", async () => {
    expect((await api("PATCH", "/api/question-bank/questions/H1", { token: mentorToken, body: { level: "oson" } })).status).toBe(403);
    expect((await api("POST", "/api/question-bank/questions", { token: mentorToken, body: {} })).status).toBe(403);
    expect((await api("POST", "/api/question-bank/sets", { token: mentorToken, body: {} })).status).toBe(403);
    expect((await api("PATCH", "/api/question-bank/questions/H1", { body: {} })).status).toBe(401);
  });
});

describe("правка вопроса", () => {
  beforeEach(resetBank);

  test("поля меняются, версия растёт, правка защищена от повторного импорта", async () => {
    const r = await admin("PATCH", "/api/question-bank/questions/J2", {
      prompt: "Yangi matn J2", expectedAnswer: "yangi javob", isPractical: true, conflictGroup: "gx", editor: "web",
    });
    expect(r.status).toBe(200);
    expect(r.body.changed).toBe(true);
    expect(r.body.question).toMatchObject({ prompt: "Yangi matn J2", expectedAnswer: "yangi javob", isPractical: true, conflictGroup: "gx", editor: "web", version: 2 });
    const doc = await BankQuestion.findOne({ code: "J2" }).lean();
    expect(doc.updatedBy).not.toBe("import"); // импорт такую запись не трогает
    // без изменений → changed:false, версия прежняя
    const same = await admin("PATCH", "/api/question-bank/questions/J2", { prompt: "Yangi matn J2" });
    expect(same.body.changed).toBe(false);
    expect(same.body.question.version).toBe(2);
  });

  test("проверка входа: уровень, тема, пустой prompt, неизвестный редактор, нет вопроса", async () => {
    expect((await admin("PATCH", "/api/question-bank/questions/J2", { level: "hard" })).status).toBe(400);
    expect((await admin("PATCH", "/api/question-bank/questions/J2", { topic: "cobol" })).status).toBe(400);
    expect((await admin("PATCH", "/api/question-bank/questions/J2", { prompt: "  " })).status).toBe(400);
    expect((await admin("PATCH", "/api/question-bank/questions/J2", { editor: "notepad" })).status).toBe(400);
    expect((await admin("PATCH", "/api/question-bank/questions/J2", { tracks: [] })).status).toBe(400);
    expect((await admin("PATCH", "/api/question-bank/questions/Z9", { prompt: "x" })).status).toBe(404);
  });

  test("перевод: правка uz → устарел, правка ru → актуален, оба сразу → актуален", async () => {
    const status = async (code) => translationStatus(await BankQuestion.findOne({ code }).select("+expectedAnswer").lean());
    expect(await status("H1")).toBe("ok");
    const r = await admin("PATCH", "/api/question-bank/questions/H1", { prompt: "Yangilangan H1" });
    expect(r.body.question.ruStatus).toBe("stale");
    expect(await status("H1")).toBe("stale");
    const ru = await admin("PATCH", "/api/question-bank/questions/H1", { promptRu: "Обновлённый H1" });
    expect(ru.body.question.ruStatus).toBe("ok");
    const both = await admin("PATCH", "/api/question-bank/questions/H2", { prompt: "H2 yangi", promptRu: "H2 новый" });
    expect(both.body.question.ruStatus).toBe("ok");
    // правка метаданных перевод не портит
    const meta = await admin("PATCH", "/api/question-bank/questions/H2", { isPractical: true });
    expect(meta.body.question.ruStatus).toBe("ok");
    // правка только ответа-черновика (uz) — тоже делает перевод устаревшим
    const ans = await admin("PATCH", "/api/question-bank/questions/C1", { expectedAnswer: "boshqa javob" });
    expect(ans.body.question.ruStatus).toBe("stale");
  });

  test("уровень/направление/архив вопроса из активного набора — 422 со списком наборов", async () => {
    const lvl = await admin("PATCH", "/api/question-bank/questions/J1", { level: "qiyin" });
    expect(lvl.status).toBe(422);
    expect(lvl.body.sets).toEqual([expect.objectContaining({ track: "frontend-react", number: 1 })]);
    expect(lvl.body.message).toContain("уровни станут");
    expect((await BankQuestion.findOne({ code: "J1" }).lean()).level).toBe("orta"); // не изменился

    const arch = await admin("PATCH", "/api/question-bank/questions/J1", { isActive: false });
    expect(arch.status).toBe(422);
    const trk = await admin("PATCH", "/api/question-bank/questions/J1", { tracks: ["frontend-vue"] });
    expect(trk.status).toBe(422);

    // набор в архив → вопрос можно менять
    const set1 = await InterviewSet.findOne({ number: 1 });
    expect((await admin("PATCH", `/api/question-bank/sets/${set1._id}`, { isActive: false })).status).toBe(200);
    const ok = await admin("PATCH", "/api/question-bank/questions/J1", { level: "qiyin" });
    expect(ok.status).toBe(200);
    // вернуть набор из архива уже нельзя: состав разошёлся с правилом
    const back = await admin("PATCH", `/api/question-bank/sets/${set1._id}`, { isActive: true });
    expect(back.status).toBe(422);
    expect(back.body.check.ok).toBe(false);
  });

  test("вопрос вне наборов: уровень и архив меняются свободно", async () => {
    // R3/R4 лежат в наборе 2; H… все в наборах — создаём свободный
    const c = await admin("POST", "/api/question-bank/questions", { code: "J26", level: "oson", prompt: "Yangi savol", topic: "js" });
    expect(c.status).toBe(201);
    expect((await admin("PATCH", "/api/question-bank/questions/J26", { level: "qiyin" })).status).toBe(200);
    const arch = await admin("PATCH", "/api/question-bank/questions/J26", { isActive: false });
    expect(arch.status).toBe(200);
    expect(arch.body.question.isActive).toBe(false);
  });
});

describe("добавление вопроса", () => {
  beforeEach(resetBank);

  test("создаётся: тема/треки по префиксу, порядок, source manual; дубль → 409; плохой код → 400", async () => {
    const r = await admin("POST", "/api/question-bank/questions", {
      code: "j27", level: "orta", prompt: "Savol 27", promptRu: "Вопрос 27", answerKind: "code",
      tests: [{ name: "ishlaydi", nameRu: "работает", code: TEST_CODE }],
    });
    expect(r.status).toBe(201);
    expect(r.body.question).toMatchObject({ code: "J27", topic: "js", tracks: ["frontend-react", "frontend-vue"], source: "manual", order: 9, version: 1 });
    expect(r.body.question.ruStatus).toBe("ok");
    expect(r.body.question.tests).toEqual([{ name: "ishlaydi", nameRu: "работает", code: TEST_CODE }]);
    expect((await admin("POST", "/api/question-bank/questions", { code: "J27", level: "orta", prompt: "x" })).status).toBe(409);
    expect((await admin("POST", "/api/question-bank/questions", { code: "Q1", level: "orta", prompt: "x" })).status).toBe(400);
    expect((await admin("POST", "/api/question-bank/questions", { code: "J28", prompt: "x" })).status).toBe(400);
    expect((await admin("POST", "/api/question-bank/questions", { code: "J28", level: "orta" })).status).toBe(400);
  });

  test("Node-вопрос: префикс N → тема node, треки JS · React, JS · Vue (+ архивный backend)", async () => {
    const r = await admin("POST", "/api/question-bank/questions", { code: "N1", level: "oson", prompt: "Node savol" });
    expect(r.status).toBe(201);
    expect(r.body.question).toMatchObject({ topic: "node", tracks: ["frontend-react", "frontend-vue", "backend-nodejs"] });
  });
});

describe("тесты мини-заданий", () => {
  beforeEach(resetBank);

  test("валидация: синтаксис, пустой код, лишние проверки; ошибки перечисляются", async () => {
    const bad = await admin("PATCH", "/api/question-bank/questions/J1", { tests: [{ name: "a", code: "assert.ok(" }, { name: "", code: "" }] });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain("синтаксис");
    expect(bad.body.message).toContain("нужно название");
    const many = await admin("PATCH", "/api/question-bank/questions/J1", { tests: Array.from({ length: 13 }, (_, i) => ({ name: `t${i}`, code: "assert.ok(true)" })) });
    expect(many.status).toBe(400);
    expect((await BankQuestion.findOne({ code: "J1" }).select("+tests").lean()).tests).toEqual([]);
  });

  test("тесты: интервьюеру код, кандидату — названия в сессии и код отдельной выдачей только для открытого вопроса", async () => {
    const put = await admin("PATCH", "/api/question-bank/questions/J1", {
      tests: [{ name: "summa", nameRu: "сумма", code: TEST_CODE }, { name: "bo'sh", code: "assert.ok(true)" }],
    });
    expect(put.status).toBe(200);

    const iv = await newInterview("Tester");
    const start = await admin("POST", `/api/interviews/${iv._id}/live`, { setId: (await InterviewSet.findOne({ number: 1 }))._id });
    expect(start.status).toBe(201);
    const cred = start.body.credentials;
    const j1 = start.body.questions.find((q) => q.code === "J1");
    expect(j1.tests).toEqual([
      { name: "summa", nameRu: "сумма", code: TEST_CODE },
      { name: "bo'sh", nameRu: "", code: "assert.ok(true)" },
    ]);
    // в снимке сессии — только названия
    const snap = await InterviewSession.findOne({ interview: iv._id }).lean();
    expect(JSON.stringify(snap)).not.toContain("MAXFIY_TEST_KODI");
    expect(snap.questions.find((q) => q.code === "J1").tests).toEqual([{ name: "summa", nameRu: "сумма" }, { name: "bo'sh", nameRu: "" }]);

    const ctoken = (await api("POST", "/api/candidate/login", { body: { username: cred.username, password: cred.password } })).body.token;
    // до открытия — вопроса нет
    expect((await api("GET", "/api/candidate/questions/1/tests", { token: ctoken })).status).toBe(404);
    await admin("POST", `/api/interviews/${iv._id}/live/questions/J1/open`);

    const sess = await api("GET", "/api/candidate/session", { token: ctoken });
    expect(sess.text).not.toContain("MAXFIY_TEST_KODI");
    expect(sess.body.questions[0].tests).toEqual([{ name: "summa" }, { name: "bo'sh" }]);
    expect(sess.body.questions[0].editor).toBe("js");

    const t = await api("GET", "/api/candidate/questions/1/tests?lang=ru", { token: ctoken });
    expect(t.status).toBe(200);
    expect(t.body.tests).toEqual([{ name: "сумма", code: TEST_CODE }, { name: "bo'sh", code: "assert.ok(true)" }]);

    // чужой/неизвестный номер, без токена
    expect((await api("GET", "/api/candidate/questions/7/tests", { token: ctoken })).status).toBe(404);
    expect((await api("GET", "/api/candidate/questions/1/tests")).status).toBe(401);
    expect((await api("GET", "/api/candidate/questions/1/tests", { token: adminToken })).status).toBe(401);

    // закрыт → 409
    await admin("POST", `/api/interviews/${iv._id}/live/questions/J1/close`);
    expect((await api("GET", "/api/candidate/questions/1/tests", { token: ctoken })).status).toBe(409);
  });

  test("у вопроса без тестов (в снимке) выдача тестов — 404", async () => {
    const iv = await newInterview("NoTests");
    const start = await admin("POST", `/api/interviews/${iv._id}/live`, { setId: (await InterviewSet.findOne({ number: 1 }))._id });
    const cred = start.body.credentials;
    const ctoken = (await api("POST", "/api/candidate/login", { body: { username: cred.username, password: cred.password } })).body.token;
    await admin("POST", `/api/interviews/${iv._id}/live/questions/J1/open`);
    // тесты добавили уже после старта — в снимке их нет: кнопки у кандидата нет, выдачи тоже
    await admin("PATCH", "/api/question-bank/questions/J1", { tests: [{ name: "a", code: "assert.ok(true)" }] });
    const s = await api("GET", "/api/candidate/session", { token: ctoken });
    expect(s.body.questions[0].tests).toBeUndefined();
    expect((await api("GET", "/api/candidate/questions/1/tests", { token: ctoken })).status).toBe(404);
  });
});

describe("правка вопроса не меняет прошедшие сессии (снимок)", () => {
  beforeEach(resetBank);

  test("текст, перевод, редактор, сцена, тесты правим после старта — сессия и кандидат видят старое", async () => {
    await admin("PATCH", "/api/question-bank/questions/J1", {
      editor: "js", tests: [{ name: "eski", code: "assert.ok(true)" }],
      demo: { html: "<p>eski sahna</p>", css: "", caption: "eski", audience: "candidate" },
    });
    const iv = await newInterview("Snap");
    const start = await admin("POST", `/api/interviews/${iv._id}/live`, { setId: (await InterviewSet.findOne({ number: 1 }))._id });
    const cred = start.body.credentials;
    const ctoken = (await api("POST", "/api/candidate/login", { body: { username: cred.username, password: cred.password } })).body.token;
    await admin("POST", `/api/interviews/${iv._id}/live/questions/J1/open`);
    const before = (await api("GET", "/api/candidate/session", { token: ctoken })).body;
    const liveBefore = (await admin("GET", `/api/interviews/${iv._id}/live`)).body;

    const edit = await admin("PATCH", "/api/question-bank/questions/J1", {
      prompt: "BUTUNLAY BOSHQA MATN", promptRu: "СОВСЕМ ДРУГОЙ ТЕКСТ", promptShort: "yangi qisqa",
      editor: "web", answerKind: "text", isPractical: false,
      tests: [{ name: "yangi", code: "assert.ok(false)" }],
      demo: { html: "<p>yangi sahna</p>", css: "", caption: "yangi", audience: "candidate" },
      options: [{ key: "A", text: "variant", correct: true }],
    });
    expect(edit.status).toBe(200);

    const after = (await api("GET", "/api/candidate/session", { token: ctoken })).body;
    expect(after).toEqual(before); // кандидат: ровно то же (включая названия тестов, редактор, сцену)
    expect(JSON.stringify(after)).not.toContain("BUTUNLAY");
    expect(after.questions[0]).toMatchObject({ prompt: "Sintetik savol J1 matni", answerKind: "code", editor: "js", tests: [{ name: "eski" }] });
    expect(after.questions[0].demo.html).toContain("eski sahna");

    const liveAfter = (await admin("GET", `/api/interviews/${iv._id}/live`)).body;
    const qb = liveBefore.questions.find((q) => q.code === "J1");
    const qa = liveAfter.questions.find((q) => q.code === "J1");
    for (const f of ["prompt", "promptRu", "promptShort", "answerKind", "editor", "isPractical", "level", "demo"]) {
      expect(qa[f]).toEqual(qb[f]);
    }
    // в БД снимка тоже старое
    const snap = (await InterviewSession.findOne({ interview: iv._id }).lean()).questions.find((q) => q.code === "J1");
    expect(snap).toMatchObject({ prompt: "Sintetik savol J1 matni", answerKind: "code", isPractical: true });
    expect(snap.tests).toEqual([{ name: "eski", nameRu: "" }]);
    // а банк — новое: так видят правку только НОВЫЕ собеседования
    expect((await BankQuestion.findOne({ code: "J1" }).lean()).prompt).toBe("BUTUNLAY BOSHQA MATN");
  });
});

describe("наборы", () => {
  beforeEach(resetBank);

  test("проверка состава: уровни, повторы, архив, чужое направление, нет в банке", async () => {
    const check = (questionCodes) => admin("POST", "/api/question-bank/sets/check", { track: "frontend-react", questionCodes });
    const ok = await check(["H1", "C1", "J1", "J2", "R1", "R2"]);
    expect(ok.body).toMatchObject({ ok: true, size: 6, levels: { got: { oson: 2, orta: 2, qiyin: 2 } } });
    expect(ok.body.warn.join()).toContain("такой же набор уже есть: №1");
    const lv = await check(["H1", "H2", "C1", "C2", "C3", "J1"]); // 1/3/... неверно
    expect(lv.body.ok).toBe(false);
    expect(lv.body.block.join()).toContain("по правилу 2/2/2");
    expect((await check(["H1", "H1", "C1", "J1", "J2", "R1"])).body.block.join()).toContain("повторы");
    expect((await check(["H1", "C1", "J1", "J2", "R1", "ZZ9"])).body.block.join()).toContain("нет в банке: ZZ9");
    await BankQuestion.updateOne({ code: "R4" }, { $set: { isActive: false } });
    await BankQuestion.updateOne({ code: "R3" }, { $set: { tracks: ["frontend-vue"] } });
    const bad = (await check(["H2", "C2", "C3", "J3", "R3", "R4"])).body.block.join();
    expect(bad).toContain("в архиве: R4");
    expect(bad).toContain("не из направления frontend-react: R3");
    expect((await admin("POST", "/api/question-bank/sets/check", { track: "x", questionCodes: ["H1"] })).status).toBe(400);
  });

  test("создание: неверный состав → 422 и набор не появляется; верный → следующий номер", async () => {
    const bad = await admin("POST", "/api/question-bank/sets", { track: "frontend-react", questionCodes: ["H1", "H2", "C1", "C2", "C3", "J1"] });
    expect(bad.status).toBe(422);
    expect(bad.body.check.ok).toBe(false);
    expect(await InterviewSet.countDocuments({})).toBe(2);
    const good = await admin("POST", "/api/question-bank/sets", { track: "frontend-react", questionCodes: ["H1", "H2", "R4", "J3", "C2", "J2"] });
    expect(good.status).toBe(201);
    expect(good.body.set).toMatchObject({ number: 3, source: "manual", size: 6 });
  });

  test("правка состава: замена вопроса на тот же уровень проходит, на другой — 422; архив/возврат", async () => {
    const set = await InterviewSet.findOne({ number: 1 });
    const swap = await admin("PATCH", `/api/question-bank/sets/${set._id}`, { questionCodes: ["H1", "C1", "J1", "C2", "R1", "R2"] }); // J2→C2 (оба qiyin)
    expect(swap.status).toBe(200);
    expect(swap.body.set.questionCodes).toEqual(["H1", "C1", "J1", "C2", "R1", "R2"]);
    expect(swap.body.set.source).toBe("manual");
    const wrong = await admin("PATCH", `/api/question-bank/sets/${set._id}`, { questionCodes: ["H1", "C1", "J1", "C2", "R1", "R3"] }); // R2(qiyin)→R3(oson)
    expect(wrong.status).toBe(422);
    expect((await InterviewSet.findById(set._id).lean()).questionCodes).toEqual(["H1", "C1", "J1", "C2", "R1", "R2"]);
    expect((await admin("PATCH", `/api/question-bank/sets/${set._id}`, { isActive: false })).body.set.isActive).toBe(false);
    expect((await admin("PATCH", `/api/question-bank/sets/${set._id}`, { isActive: true })).body.set.isActive).toBe(true);
    expect((await admin("PATCH", `/api/question-bank/sets/${new mongoose.Types.ObjectId()}`, { isActive: true })).status).toBe(404);
  });
});
