// Живое собеседование целиком через HTTP (настоящий express + in-memory Mongo):
// старт из заявки → вход кандидата → открыть вопрос → ответ → оценка → завершить.
// Плюс изоляция кандидата, истечение/отзыв доступа, ротация наборов.
// ВСЕ вопросы синтетические: банк в репозиторий не кладём (репо публичный).
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-access-secret";
process.env.CANDIDATE_APP_URL = "https://candidate.example";
// Роуты интернов тянут notificationController (web-push) — нужны валидные VAPID-ключи.
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
const CandidateAccess = require("../src/models/candidateAccessModel");
const InterviewSession = require("../src/models/interviewSessionModel");
const Setting = require("../src/models/settingModel");
const globalErrorHandler = require("../src/controllers/errorController");

jest.setTimeout(120000);

let mongod;
let server;
let base;

const SECRET = (code) => `MAXFIY-${code}-javob`;
const FIX = "FIXED-SCENE-SECRET";
const LV = { oson: 2, orta: 2, qiyin: 2 };

// Синтетический банк frontend-react: 12 вопросов, у каждого прозвучный маркер.
const BANK = [
  ["H1", "html", "oson"], ["H2", "html", "orta"], ["C1", "css", "orta"], ["C2", "css", "qiyin"],
  ["C3", "css", "qiyin"], ["J1", "js", "orta"], ["J2", "js", "qiyin"], ["J3", "js", "oson"],
  ["R1", "react", "oson"], ["R2", "react", "qiyin"], ["R3", "react", "oson"], ["R4", "react", "orta"],
];
const SET1 = ["H1", "C1", "J1", "J2", "R1", "R2"];
const SET2 = ["H2", "C2", "C3", "J3", "R3", "R4"];

const adminToken = jwt.sign({ id: new mongoose.Types.ObjectId().toString(), role: "admin" }, process.env.JWT_SECRET);
const mentorToken = jwt.sign({ id: new mongoose.Types.ObjectId().toString(), role: "mentor" }, process.env.JWT_SECRET);
const internToken = jwt.sign({ id: new mongoose.Types.ObjectId().toString(), role: "intern" }, process.env.JWT_SECRET);

async function api(method, path, { token, body, raw } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? (raw ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, body: json, text };
}

async function newInterview(name, scheduledAt = new Date()) {
  const app = await Application.create({
    firstName: name, lastName: "Test", phone: "+998000000000", telegramUsername: `t_${name.toLowerCase()}`,
    age: 18, branch: new mongoose.Types.ObjectId(), mentor: new mongoose.Types.ObjectId(),
    sphere: "frontend-react", shift: "morning", status: "interview_scheduled",
  });
  return Interview.create({ application: app._id, track: "frontend-react", scheduledAt, status: "scheduled" });
}

async function login(username, password) {
  return api("POST", "/api/candidate/login", { body: { username, password } });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  await Setting.create({ key: "questionBankRules", value: { levels: { 6: LV } } });
  await BankQuestion.insertMany(BANK.map(([code, topic, level], i) => ({
    code, topic, level, tracks: ["frontend-react"], order: i + 1,
    isPractical: code === "J1", isMiniTask: code === "J1",
    prompt: `Sintetik savol ${code} matni`, promptRu: `Синтетический вопрос ${code}`,
    promptShort: `qisqa-${code}`, expectedAnswer: SECRET(code), expectedAnswerRu: `${SECRET(code)}-ru`,
    answerKind: code === "J1" ? "code" : "text",
    ...(code === "C1" ? {
      demo: { html: "<div id='box'>demo</div>", css: ".x{}", audience: "candidate", caption: "sahna" },
      demoFix: { html: `<div>${FIX}</div>` },
    } : {}),
  })));
  await InterviewSet.create({ track: "frontend-react", number: 1, questionCodes: SET1, source: "docx" });
  await InterviewSet.create({ track: "frontend-react", number: 2, questionCodes: SET2, source: "docx" });

  const app = express();
  app.use("/api/candidate/answers", express.json({ limit: "200kb" }));
  app.use(express.json({ limit: "10kb" }));
  app.use("/api/candidate", require("../src/routes/candidateRoutes"));
  app.use("/api/interviews", require("../src/routes/interviewRoutes"));
  app.use("/api/question-bank", require("../src/routes/questionBankRoutes"));
  app.use("/api/interns", require("../src/routes/internRoutes"));
  app.use("/api/lessons", require("../src/routes/lessonRoutes"));
  app.use(globalErrorHandler);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  await mongod.stop();
});

// Ни один секрет не должен попасть в ответ кандидату.
function expectNoSecrets(payload, extra = []) {
  const s = JSON.stringify(payload);
  BANK.forEach(([code]) => {
    expect(s).not.toContain(SECRET(code));
    expect(s).not.toContain(`qisqa-${code}`);
  });
  [FIX, "expectedAnswer", "demoFix", "result", "note", "\"code\"", "level", "correct", "signals", ...extra]
    .forEach((needle) => expect(s).not.toContain(needle));
}

describe("полный цикл живого собеседования", () => {
  let ivA;
  let cred;
  let ctoken;

  test("ротация: предложен набор №1, режим live", async () => {
    ivA = await newInterview("Alpha");
    const r = await api("GET", `/api/interviews/live/sets?interviewId=${ivA._id}`, { token: adminToken });
    expect(r.status).toBe(200);
    expect(r.body.mode).toBe("live");
    expect(r.body.sets.map((s) => s.number)).toEqual([1, 2]);
    expect(String(r.body.suggestedSetId)).toBe(String(r.body.sets[0]._id));
  });

  test("старт: только админ; пароль один раз; повтор — 409", async () => {
    const sets = (await api("GET", "/api/interviews/live/sets?track=frontend-react", { token: adminToken })).body;
    const setId = sets.suggestedSetId;
    expect((await api("POST", `/api/interviews/${ivA._id}/live`, { token: mentorToken, body: { setId } })).status).toBe(403);
    expect((await api("POST", `/api/interviews/${ivA._id}/live`, { token: internToken, body: { setId } })).status).toBe(403);

    const r = await api("POST", `/api/interviews/${ivA._id}/live`, { token: adminToken, body: { setId } });
    expect(r.status).toBe(201);
    cred = r.body.credentials;
    expect(cred.username).toMatch(/^C-[2-9A-Z]{6}$/);
    expect(cred.password).toHaveLength(8);
    expect(cred.appUrl).toBe("https://candidate.example");
    expect(r.body.questions.map((q) => q.code)).toEqual(SET1);
    expect(r.body.questions.every((q) => q.state === "hidden")).toBe(true);
    expect(r.body.questions[0].expectedAnswer).toBe(SECRET("H1")); // интервьюер видит ответ банка
    expect(r.body.questions[1].demoFix.html).toContain(FIX);
    expect(r.body.set.number).toBe(1);
    expect(r.body.access.status).toBe("active");

    const again = await api("POST", `/api/interviews/${ivA._id}/live`, { token: adminToken, body: { setId } });
    expect(again.status).toBe(409);
    // В БД пароль только хешем
    const acc = await CandidateAccess.findOne({ interview: ivA._id }).select("+passwordHash").lean();
    expect(acc.passwordHash).not.toContain(cred.password);
    expect((await Interview.findById(ivA._id).lean()).mode).toBe("live");
  });

  test("вход кандидата: неверный пароль → 401, верный → токен; логин без учёта регистра", async () => {
    expect((await login(cred.username, "wrongpass")).body.code).toBe("invalid");
    expect((await login("C-NOSUCH", "whatever")).status).toBe(401);
    const r = await login(cred.username.toLowerCase(), cred.password);
    expect(r.status).toBe(200);
    ctoken = r.body.token;
    expect(r.body.language).toBe("uz");
    expectNoSecrets(r.body);
  });

  test("токен без iid (выдан до ускорения опроса) тоже работает", async () => {
    const { keyFor } = require("../src/utils/tokenKeys");
    const claims = jwt.verify(ctoken, keyFor("candidate"), { audience: "candidate" });
    expect(claims.iid).toBe(String(ivA._id));
    const legacy = jwt.sign({ sub: claims.sub, v: claims.v, typ: "candidate" }, keyFor("candidate"), { audience: "candidate", expiresIn: 600 });
    const r = await api("GET", "/api/candidate/session", { token: legacy });
    expect(r.status).toBe(200);
    expect((await api("GET", `/api/candidate/session?rev=${r.body.rev}`, { token: legacy })).status).toBe(304);
  });

  test("до открытия — ожидание; ?rev → 304", async () => {
    const r = await api("GET", "/api/candidate/session", { token: ctoken });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "lobby", current: null, questions: [], me: { name: "Alpha Test", track: "frontend-react" } });
    expect(r.text).not.toContain("+998"); // о человеке — только имя и направление
    expect(r.text).not.toContain("t_alpha");
    expectNoSecrets(r.body, ["Sintetik"]);
    const again = await api("GET", `/api/candidate/session?rev=${r.body.rev}`, { token: ctoken });
    expect(again.status).toBe(304);
  });

  test("открыть вопрос → кандидат видит только его, без кода и ответа", async () => {
    const before = (await api("GET", "/api/candidate/session", { token: ctoken })).body.rev;
    const o = await api("POST", `/api/interviews/${ivA._id}/live/questions/H1/open`, { token: adminToken });
    expect(o.status).toBe(200);
    expect(o.body.status).toBe("live");
    expect(o.body.access.online).toBe(true);
    expect((await api("GET", `/api/candidate/session?rev=${before}`, { token: ctoken })).status).toBe(200);
    const r = await api("GET", "/api/candidate/session", { token: ctoken });
    expect(r.body.current).toBe(1);
    expect(r.body.questions).toHaveLength(1);
    expect(r.body.questions[0]).toMatchObject({ position: 1, prompt: "Sintetik savol H1 matni", state: "open", answer: null });
    expectNoSecrets(r.body, ["C1", "J1", "R1"]);
  });

  test("ответ: черновик, устаревший revision → 409, отправка, большое тело", async () => {
    const d = await api("PUT", "/api/candidate/answers/1", { token: ctoken, body: { text: "mening javobim", revision: 2 } });
    expect(d.status).toBe(200);
    expect(d.body.submittedAt).toBeNull();
    const stale = await api("PUT", "/api/candidate/answers/1", { token: ctoken, body: { text: "eski", revision: 1 } });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("stale");
    const big = "x".repeat(50 * 1024); // больше общего лимита 10 КБ, меньше 100 КБ
    expect((await api("PUT", "/api/candidate/answers/1", { token: ctoken, body: { text: big, revision: 3 } })).status).toBe(200);
    const huge = "y".repeat(120 * 1024);
    expect((await api("PUT", "/api/candidate/answers/1", { token: ctoken, body: { text: huge, revision: 4 } })).status).toBe(413);
    const s = await api("PUT", "/api/candidate/answers/1", { token: ctoken, body: { text: "yakuniy javob", revision: 5, submit: true } });
    expect(s.status).toBe(200);
    expect(s.body.submittedAt).toBeTruthy();
    expect((await api("PUT", "/api/candidate/answers/9", { token: ctoken, body: { text: "x", revision: 1 } })).status).toBe(404);

    const mine = (await api("GET", "/api/candidate/session", { token: ctoken })).body.questions[0].answer;
    expect(mine).toMatchObject({ text: "yakuniy javob", revision: 5, frozen: false });
    expect(mine.submittedAt).toBeTruthy();
  });

  test("сигналы фокуса и вставки — у интервьюера, кандидату не видны", async () => {
    expect((await api("POST", "/api/candidate/signals", { token: ctoken, body: { type: "paste", position: 1, meta: { chars: 214 } } })).status).toBe(204);
    expect((await api("POST", "/api/candidate/signals", { token: ctoken, body: { type: "focus_lost", meta: { ms: 12000 } } })).status).toBe(204);
    expect((await api("POST", "/api/candidate/signals", { token: ctoken, body: { type: "hack" } })).status).toBe(400);
    const v = (await api("GET", `/api/interviews/${ivA._id}/live`, { token: adminToken })).body;
    expect(v.signals[0]).toMatchObject({ type: "paste", questionCode: "H1", meta: { chars: 214 } });
    expect(v.questions[0].answer).toMatchObject({ text: "yakuniy javob", revision: 5 });
    expect(v.questions[0].answer.submittedAt).toBeTruthy();
    expectNoSecrets((await api("GET", "/api/candidate/session", { token: ctoken })).body);
  });

  test("оценка и заметка → балл с весами по уровням; опрос интервьюера 304", async () => {
    const r = await api("PATCH", `/api/interviews/${ivA._id}/live/questions/H1`, { token: adminToken, body: { result: "pass", note: "yaxshi" } });
    expect(r.status).toBe(200);
    // открыт только H1 → 1/1; неоткрытые вне знаменателя
    expect(r.body.score).toMatchObject({ earned: 1, total: 1, percentage: 100, threshold: 80, rated: 1, unrated: 0, notOpened: 5 });
    expect(r.body.score.setTotal).toBe(2 * 1 + 2 * 2 + 2 * 3);
    expect((await api("PATCH", `/api/interviews/${ivA._id}/live/questions/H1`, { token: adminToken, body: { result: "great" } })).status).toBe(400);
    const v = (await api("GET", `/api/interviews/${ivA._id}/live`, { token: adminToken })).body;
    expect((await api("GET", `/api/interviews/${ivA._id}/live?rev=${v.rev}`, { token: adminToken })).status).toBe(304);
    expect((await api("GET", `/api/interviews/${ivA._id}/live?rev=${v.rev}&online=0`, { token: adminToken })).status).toBe(200);
    // кандидату оценка не видна и его опрос не будится
    const c = await api("GET", "/api/candidate/session", { token: ctoken });
    expectNoSecrets(c.body, ["yaxshi", "pass"]);
  });

  test("следующий вопрос «только обсудить»: прошлый закрыт и заморожен; сцена без исправления", async () => {
    const o = await api("POST", `/api/interviews/${ivA._id}/live/questions/C1/discuss`, { token: adminToken });
    expect(o.body.questions[0].state).toBe("closed");
    // C1 (o'rta) открыт, но не оценён — считается как 0: 1 / (1 + 2)
    expect(o.body.score).toMatchObject({ earned: 1, total: 3, percentage: 33.3, passed: false, unrated: 1, notOpened: 4 });
    expect(o.body.questions[0].answer.frozenAt).toBeTruthy();
    const late = await api("PUT", "/api/candidate/answers/1", { token: ctoken, body: { text: "kech", revision: 9 } });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("closed");
    expect((await api("PUT", "/api/candidate/answers/2", { token: ctoken, body: { text: "x", revision: 1 } })).body.code).toBe("discuss_only");
    const r = (await api("GET", "/api/candidate/session", { token: ctoken })).body;
    expect(r.current).toBe(2);
    expect(r.questions.map((q) => q.state)).toEqual(["closed", "open"]);
    expect(r.questions[1].discussOnly).toBe(true);
    expect(r.questions[1].demo.html).toContain("demo");
    expect(r.questions[0].answer.frozen).toBe(true);
    expectNoSecrets(r);
  });

  test("язык ru: тексты на русском", async () => {
    const l = await api("PATCH", "/api/candidate/language", { token: ctoken, body: { language: "ru" } });
    expect(l.body.language).toBe("ru");
    const r = (await api("GET", "/api/candidate/session", { token: ctoken })).body;
    expect(r.language).toBe("ru");
    expect(r.questions[0].prompt).toBe("Синтетический вопрос H1");
    expect((await api("GET", "/api/candidate/session?lang=uz", { token: ctoken })).body.questions[0].prompt).toBe("Sintetik savol H1 matni");
    expect((await api("PATCH", "/api/candidate/language", { token: ctoken, body: { language: "en" } })).status).toBe(400);
  });

  test("изоляция: токен кандидата не открывает API интернов, банк и админку; чужие токены не открывают API кандидата", async () => {
    for (const p of ["/api/interns", "/api/interns/rating", "/api/lessons", "/api/question-bank/questions",
      "/api/interviews", `/api/interviews/${ivA._id}/live`]) {
      const r = await api("GET", p, { token: ctoken });
      expect([p, r.status]).toEqual([p, 401]);
    }
    for (const t of [adminToken, internToken, mentorToken]) {
      expect((await api("GET", "/api/candidate/session", { token: t })).status).toBe(401);
    }
    expect((await api("GET", "/api/candidate/session")).status).toBe(401);
    // токен кандидата, подписанный общим секретом, тоже не проходит
    const forged = jwt.sign({ sub: "x", v: 0, typ: "candidate" }, process.env.JWT_SECRET, { audience: "candidate" });
    expect((await api("GET", "/api/candidate/session", { token: forged })).status).toBe(401);
  });

  test("изоляция: кандидат не видит чужую сессию", async () => {
    const ivB = await newInterview("Bravo");
    const sets = (await api("GET", `/api/interviews/live/sets?interviewId=${ivB._id}`, { token: adminToken })).body;
    // ротация: №1 только что взят — предлагается №2
    const s2 = sets.sets.find((s) => s.number === 2);
    expect(String(sets.suggestedSetId)).toBe(String(s2._id));
    const st = await api("POST", `/api/interviews/${ivB._id}/live`, { token: adminToken, body: { setId: s2._id } });
    await api("POST", `/api/interviews/${ivB._id}/live/questions/R3/open`, { token: adminToken });
    const tB = (await login(st.body.credentials.username, st.body.credentials.password)).body.token;
    await api("PUT", "/api/candidate/answers/1", { token: tB, body: { text: "BRAVO-ANSWER", revision: 1 } });

    const a = await api("GET", "/api/candidate/session", { token: ctoken });
    expect(a.text).not.toContain("R3");
    expect(a.text).not.toContain("BRAVO-ANSWER");
    const b = await api("GET", "/api/candidate/session", { token: tB });
    expect(b.body.questions).toHaveLength(1);
    expect(b.text).not.toContain("yakuniy javob");

    // отмена собеседования B — доступ B гаснет
    await api("PATCH", `/api/interviews/${ivB._id}/status`, { token: adminToken, body: { status: "canceled" } });
    const after = await api("GET", "/api/candidate/session", { token: tB });
    expect(after.status).toBe(401);
    expect(after.body.code).toBe("revoked");
  });

  test("завершить → Interview completed, письмо без текста вопросов, доступ отозван", async () => {
    await api("PATCH", `/api/interviews/${ivA._id}/live/questions/C1`, { token: adminToken, body: { result: "partial" } });
    // J1 открыт и не оценён — в итог как 0 (решение Абубакира 27.11)
    await api("POST", `/api/interviews/${ivA._id}/live/questions/J1/open`, { token: adminToken });
    const f = await api("POST", `/api/interviews/${ivA._id}/live/finish`, { token: mentorToken });
    expect(f.status).toBe(403);
    const r = await api("POST", `/api/interviews/${ivA._id}/live/finish`, { token: adminToken });
    expect(r.status).toBe(200);
    // H1 oson pass 1/1 + C1 o'rta partial 1/2 + J1 o'rta открыт без оценки 0/2 → 2/5 = 40%
    expect(r.body.score).toMatchObject({ earned: 2, total: 5, percentage: 40, passed: false, unrated: 1 });
    expect(r.body.result.closedOpen).toEqual(["J1"]);
    expect(r.body.status).toBe("finished");
    expect(r.body.access.status).toBe("revoked");
    expect(r.body.letter.uz).toContain("CSS");

    const iv = await Interview.findById(ivA._id).lean();
    expect(iv).toMatchObject({ status: "completed", mode: "live", percentage: 40, passed: false, scoreEarned: 2, scoreTotal: 5 });
    expect(iv.items.map((i) => [i.questionCode, i.result, i.weight, i.earned])).toEqual([["H1", "pass", 1, 1], ["C1", "partial", 2, 1], ["J1", undefined, 2, 0]]);
    expect(iv.cooldownUntil).toBeTruthy();
    expect(iv.roadmap).toEqual(["CSS", "JavaScript"]);

    // письмо — как для чек-листа (его забирает interns-agent): только темы
    const letter = await api("GET", `/api/interviews/${ivA._id}/letter`, { token: adminToken });
    expect(letter.status).toBe(200);
    expect(letter.body.letter.uz).toContain("CSS");
    expect(letter.text).not.toContain("qisqa-");
    expect(letter.text).not.toContain("Sintetik");

    const c = await api("GET", "/api/candidate/session", { token: ctoken });
    expect(c.status).toBe(401);
    expect(c.body.code).toBe("finished");
    expect((await login(cred.username, cred.password)).body.code).toBe("finished");
    expect((await api("POST", `/api/interviews/${ivA._id}/live/finish`, { token: adminToken })).status).toBe(409);
    expect((await api("POST", `/api/interviews/${ivA._id}/live/access/reset`, { token: adminToken })).status).toBe(409);

    const hist = await api("GET", "/api/interviews/live/history?track=frontend-react", { token: adminToken });
    const rowA = hist.body.items.find((x) => String(x.interviewId) === String(ivA._id));
    expect(rowA).toMatchObject({ candidate: "Alpha Test", percentage: 40, passed: false });
    expect(rowA.set.number).toBe(1);

    const list = await api("GET", "/api/interviews?status=completed", { token: adminToken });
    expect(list.body.items.find((x) => String(x._id) === String(ivA._id)).live.status).toBe("finished");
  });
});

describe("окно доступа, сброс пароля, блокировка", () => {
  let iv;
  let cred;

  beforeAll(async () => {
    iv = await newInterview("Charlie");
    const r = await api("POST", `/api/interviews/${iv._id}/live`, { token: adminToken, body: { generate: true, size: 6 } });
    expect(r.status).toBe(201);
    cred = r.body.credentials;
  });

  test("сгенерированный набор: состав по уровням, source generated, номер следующий", async () => {
    const s = await InterviewSession.findOne({ interview: iv._id }).populate("set").lean();
    expect(s.set.source).toBe("generated");
    expect(s.set.number).toBe(3);
    const levels = s.questions.map((q) => q.level);
    expect(levels.filter((l) => l === "oson")).toHaveLength(2);
    expect(levels.filter((l) => l === "orta")).toHaveLength(2);
    expect(levels.filter((l) => l === "qiyin")).toHaveLength(2);
  });

  test("предпросмотр генерации не сохраняет набор; неверный ручной набор → 422", async () => {
    const before = await InterviewSet.countDocuments();
    const p = await api("POST", "/api/interviews/live/sets/preview", { token: adminToken, body: { track: "frontend-react", size: 6 } });
    expect(p.status).toBe(200);
    expect(p.body.questionCodes).toHaveLength(6);
    expect(await InterviewSet.countDocuments()).toBe(before);
    const ivX = await newInterview("Xray");
    const bad = await api("POST", `/api/interviews/${ivX._id}/live`, {
      token: adminToken, body: { questionCodes: ["H1", "J3", "R1", "R3", "C2", "C3"] }, // 4 oson
    });
    expect(bad.status).toBe(422);
    expect(await InterviewSession.exists({ interview: ivX._id })).toBeNull();
  });

  test("истёкший доступ: вход и токен → expired; «Продлить» возвращает", async () => {
    const token = (await login(cred.username, cred.password)).body.token;
    await CandidateAccess.updateOne({ interview: iv._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await api("GET", "/api/candidate/session", { token });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("expired");
    expect((await login(cred.username, cred.password)).body.code).toBe("expired");

    const { expireDueAccesses } = require("../src/services/candidateAccess");
    expect(await expireDueAccesses()).toBe(1);
    const v = (await api("GET", `/api/interviews/${iv._id}/live`, { token: adminToken })).body;
    expect(v.access).toMatchObject({ status: "expired", expired: true });

    const ext = await api("POST", `/api/interviews/${iv._id}/live/access/extend`, { token: adminToken, body: { minutes: 30 } });
    expect(ext.body.access).toMatchObject({ status: "active", expired: false });
    expect((await api("GET", "/api/candidate/session", { token })).status).toBe(200);
  });

  test("вход раньше окна → 403 not_yet с временем открытия", async () => {
    await CandidateAccess.updateOne({ interview: iv._id }, { $set: { validFrom: new Date(Date.now() + 3600e3) } });
    const r = await login(cred.username, cred.password);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("not_yet");
    expect(r.body.validFrom).toBeTruthy();
    await CandidateAccess.updateOne({ interview: iv._id }, { $set: { validFrom: new Date(Date.now() - 60e3) } });
  });

  test("сброс пароля гасит старый токен; новый пароль работает", async () => {
    const old = (await login(cred.username, cred.password)).body.token;
    const r = await api("POST", `/api/interviews/${iv._id}/live/access/reset`, { token: adminToken });
    expect(r.body.credentials.password).toHaveLength(8);
    expect((await api("GET", "/api/candidate/session", { token: old })).status).toBe(401);
    expect((await login(cred.username, cred.password)).status).toBe(401);
    const fresh = await login(cred.username, r.body.credentials.password);
    expect(fresh.status).toBe(200);
    cred = { ...cred, password: r.body.credentials.password };
  });

  test("8 неверных паролей → блокировка 423 даже с верным; сброс снимает", async () => {
    for (let i = 0; i < 8; i += 1) expect((await login(cred.username, `bad${i}xxx`)).status).toBe(401);
    expect((await login(cred.username, cred.password)).status).toBe(423);
    const r = await api("POST", `/api/interviews/${iv._id}/live/access/reset`, { token: adminToken });
    expect((await login(cred.username, r.body.credentials.password)).status).toBe(200);
  });
});
