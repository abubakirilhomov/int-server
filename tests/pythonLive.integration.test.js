// Python-трек через HTTP: правило набора (API), генерация с HTML/CSS из JS-банка,
// старт живого собеседования и вид кандидата (редактор python/sql, без превью).
// Все вопросы СИНТЕТИЧЕСКИЕ.
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
const Branch = require("../src/models/branchModel");
const Setting = require("../src/models/settingModel");
const globalErrorHandler = require("../src/controllers/errorController");

jest.setTimeout(120000);

let mongod;
let server;
let base;
const adminToken = jwt.sign({ id: new mongoose.Types.ObjectId().toString(), role: "admin" }, process.env.JWT_SECRET);

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

// Банк размера 6: M3 2 + M4 2 + M7 2, уровни 2/2/2; HTML/CSS H2, C1 — из JS-банка.
const PY = [
  ["M3-01", "oson", true], ["M3-02", "orta", false], ["M3-03", "qiyin", true],
  ["M4-01", "oson", true], ["M4-02", "orta", true], ["M4-03", "qiyin", false],
  ["M7-01", "oson", true], ["M7-02", "orta", true], ["M7-03", "qiyin", false],
];
const RULE = {
  levels: { 6: { oson: 2, orta: 2, qiyin: 2 } },
  minPractical: 3, requireMiniTask: false, order: "module-level",
  quotas: { 6: [{ topics: ["py-m3"], count: 2 }, { topics: ["py-m4"], count: 2 }, { topics: ["py-m7"], count: 2 }] },
  extras: { codes: ["H2", "C1"], exclude: ["H1"], max: 2, maxTotal: 8 },
  updatedBy: "import",
};

async function newInterview(name, sphere = "backend-python") {
  const app = await Application.create({
    firstName: name, lastName: "Test", phone: "+998000000000", telegramUsername: `t_${name.toLowerCase()}`,
    age: 18, branch: new mongoose.Types.ObjectId(), mentor: new mongoose.Types.ObjectId(),
    sphere, shift: "morning", status: "interview_scheduled",
  });
  return Interview.create({ application: app._id, track: "backend-python", scheduledAt: new Date(), status: "scheduled" });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Setting.create({
    key: "questionBankRules",
    value: { levels: { 6: { oson: 2, orta: 2, qiyin: 2 } }, minPractical: 1, quotas: {}, conflictGroups: [], tracks: { "backend-python": RULE } },
  });
  await BankQuestion.insertMany([
    ...PY.map(([code, level, practical], i) => ({
      code, level, topic: `py-m${code.slice(1, 2)}`, tracks: ["backend-python"], order: i + 1,
      isPractical: practical, answerKind: practical ? "code" : "text",
      editor: code.startsWith("M7") && practical ? "sql" : undefined,
      prompt: `Sintetik ${code}`, expectedAnswer: `javob-${code}`,
    })),
    { code: "M10-01", level: "orta", topic: "py-m10", tracks: ["backend-python"], isActive: false, notCovered: true, prompt: "Sintetik M10" },
    { code: "H1", level: "oson", topic: "html", tracks: ["frontend-react", "frontend-vue"], prompt: "Sintetik H1" },
    { code: "H2", level: "orta", topic: "html", tracks: ["frontend-react", "frontend-vue"], prompt: "Sintetik H2" },
    { code: "C1", level: "oson", topic: "css", tracks: ["frontend-react", "frontend-vue"], prompt: "Sintetik C1" },
  ]);
  await InterviewSet.create({ track: "backend-python", number: 1, source: "docx", questionCodes: ["M3-01", "M3-03", "M4-01", "M4-02", "M7-02", "M7-03"] });

  const app = express();
  app.use(express.json({ limit: "100kb" }));
  app.use("/api/candidate", require("../src/routes/candidateRoutes"));
  app.use("/api/interviews", require("../src/routes/interviewRoutes"));
  app.use("/api/question-bank", require("../src/routes/questionBankRoutes"));
  app.use("/api/applications", require("../src/routes/applicationRoutes"));
  app.use(globalErrorHandler);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  await mongod.stop();
});

describe("направления в заявке", () => {
  test("форма заявки предлагает три направления: JS · React, JS · Vue, Python", async () => {
    await Branch.create({ name: "Sintetik filial" });
    const r = await api("GET", "/api/applications/form-data");
    expect(r.status).toBe(200);
    expect(r.body.spheres).toEqual([
      { value: "frontend-react", label: "JS · React" },
      { value: "frontend-vue", label: "JS · Vue" },
      { value: "backend-python", label: "Python" },
    ]);
  });
});

describe("правило набора трека (API)", () => {
  test("GET: квоты по модулям, темы трека, сколько вопросов в банке (активных и нет)", async () => {
    const r = await admin("GET", "/api/question-bank/rules/backend-python");
    expect(r.status).toBe(200);
    expect(r.body.rules).toMatchObject({ unit: "module", minPractical: 3, source: "import" });
    expect(r.body.topics.map((t) => t.topic)).toEqual(expect.arrayContaining(["py-m3", "py-m7", "py-m11"]));
    expect(r.body.inBank["py-m10"]).toEqual({ active: 0, inactive: 1 });
    expect((await admin("GET", "/api/question-bank/rules/nope")).status).toBe(400);
  });

  test("PUT: неверные суммы — 400; ломает активный набор — 422; верное — сохраняется как правка админа", async () => {
    const bad = await admin("PUT", "/api/question-bank/rules/backend-python", { levels: { 18: { oson: 1, orta: 1, qiyin: 1 } } });
    expect(bad.status).toBe(400);
    const breaks = await admin("PUT", "/api/question-bank/rules/backend-python", { quotas: { 15: [{ topics: ["py-m3"], count: 15 }] }, levels: { 18: { oson: 4, orta: 9, qiyin: 5 } } });
    expect(breaks.status).toBe(200); // уровни 6 не трогали — набор №1 цел
    expect(breaks.body.rules.source).toBe("admin");
    // правило, при котором набор из 6 ломается по уровням, сохранить нельзя
    await Setting.updateOne({ key: "questionBankRules" }, { $unset: { "value.tracks.backend-python.levels.6": 1 } });
    const lv = await admin("PUT", "/api/question-bank/rules/backend-python", { minPractical: 2 });
    expect(lv.status).toBe(200);
    await Setting.updateOne({ key: "questionBankRules" }, { $set: { "value.tracks.backend-python": RULE } });
  });

  test("проверка набора: extras допустимы, ещё не пройденный модуль — блок", async () => {
    const ok = await admin("POST", "/api/question-bank/sets/check", {
      track: "backend-python", questionCodes: ["H2", "M3-01", "M3-03", "M4-01", "M4-02", "M7-02", "M7-03"],
    });
    expect(ok.body).toMatchObject({ ok: true, baseSize: 6, extras: ["H2"] });
    const off = await admin("POST", "/api/question-bank/sets/check", {
      track: "backend-python", questionCodes: ["M3-01", "M3-03", "M4-01", "M4-02", "M7-02", "M10-01"],
    });
    expect(off.body.ok).toBe(false);
    expect(off.body.block.join(" ")).toContain("ещё не пройдено: M10-01");
  });
});

describe("живое собеседование по Python", () => {
  test("наборы трека: режим live, extras правила видны", async () => {
    const r = await admin("GET", "/api/interviews/live/sets?track=backend-python");
    expect(r.body.mode).toBe("live");
    expect(r.body.extras).toEqual({ codes: ["H2", "C1"], max: 2, maxTotal: 8 });
  });

  test("предпросмотр: 6 + 2 HTML/CSS, уровни по основным, без нарушений", async () => {
    const r = await admin("POST", "/api/interviews/live/sets/preview", { track: "backend-python", size: 6, extras: 2 });
    expect(r.status).toBe(200);
    expect(r.body.questionCodes).toHaveLength(8);
    expect(r.body.extras.sort()).toEqual(["C1", "H2"]);
    expect(r.body.questionCodes.slice(0, 2).sort()).toEqual(["C1", "H2"]);
    expect(r.body.questionCodes).not.toContain("M10-01");
    expect(r.body.violations).toEqual([]);
  });

  test("старт (ручной набор и генерация + extras) → редакторы python/sql; кандидат видит редактор", async () => {
    const iv = await newInterview("Pyalpha");
    const r = await admin("POST", `/api/interviews/${iv._id}/live`, {
      questionCodes: ["H2", "M3-01", "M3-03", "M4-01", "M4-02", "M7-02", "M7-03"],
    });
    expect(r.status).toBe(201);
    const editors = Object.fromEntries(r.body.questions.map((q) => [q.code, q.editor]));
    expect(editors).toMatchObject({ "M3-01": "python", "M4-02": "python", "M7-02": "sql", "M7-03": null });
    expect(r.body.set.source).toBe("manual");

    const gen = await admin("POST", `/api/interviews/${(await newInterview("Pygen"))._id}/live`, { generate: true, size: 6, extras: 1 });
    expect(gen.status).toBe(201);
    expect(gen.body.questions).toHaveLength(7);
    expect(gen.body.questions.filter((q) => ["H2", "C1"].includes(q.code))).toHaveLength(1);

    const cred = r.body.credentials;
    const login = await api("POST", "/api/candidate/login", { body: { username: cred.username, password: cred.password } });
    expect(login.status).toBe(200);
    const ctoken = login.body.token;
    expect((await admin("POST", `/api/interviews/${iv._id}/live/questions/M3-01/open`)).status).toBe(200);
    const s = await api("GET", "/api/candidate/session", { token: ctoken });
    expect(s.body.me.track).toBe("backend-python");
    expect(s.body.questions).toHaveLength(1); // открыт один вопрос — кандидат видит только его
    expect(s.body.questions[0]).toMatchObject({ answerKind: "code", editor: "python", prompt: "Sintetik M3-01" });
    expect(s.text).not.toContain("javob-"); // ответов кандидату нет
  });

  test("старт с ручным набором: H1 (запрещён правилом) — отказ", async () => {
    const iv = await newInterview("Pybeta");
    const r = await admin("POST", `/api/interviews/${iv._id}/live`, {
      questionCodes: ["H1", "M3-01", "M3-03", "M4-01", "M4-02", "M7-02", "M7-03"],
    });
    expect(r.status).toBe(400);
  });
});
