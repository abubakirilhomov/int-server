// Живые сцены вопросов: формат, запись, кандидатский вид. Сцены синтетические.
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const BankQuestion = require("../src/models/bankQuestionModel");
const InterviewSession = require("../src/models/interviewSessionModel");
const { normalizeDemo, normalizeDemoFix, DemoError } = require("../src/utils/questionBank/demo");
const { applyDemos, exportDemos } = require("../src/services/questionDemos");
const { toCandidateQuestion, toCandidateSession } = require("../src/serializers/candidateView");

const FIX_MARK = "FIXSECRET";
const demo = (over = {}) => ({
  html: '<div class="box"><button id="go">Go</button></div>',
  css: ".box{width:100px}",
  steps: [{ type: "wait", ms: 300 }, { type: "click", target: "#go" }, { type: "scroll", to: 400 }],
  caption: "Sintetik sahna",
  captionRu: "Синтетическая сцена",
  height: 240,
  slider: true,
  layers3d: true,
  ...over,
});
const fix = { css: `.box{width:200px} /* ${FIX_MARK} */`, caption: "Tuzatilgan", captionRu: "Исправлено" };

describe("normalizeDemo", () => {
  test("заполняет умолчания и чистит шаги до известных полей", () => {
    const out = normalizeDemo(demo({ steps: [{ type: "click", target: "#go", evil: "x" }] }));
    expect(out).toEqual({
      html: demo().html, css: demo().css, caption: "Sintetik sahna", captionRu: "Синтетическая сцена",
      height: 240, width: 1440, slider: true, layers3d: true, audience: "candidate",
      steps: [{ type: "click", target: "#go" }],
    });
    expect(normalizeDemo({ html: "<p>x</p>" })).toMatchObject({ width: 375, height: 320, slider: false, steps: [] });
  });

  test("пустая сцена → null, без исключения", () => {
    expect(normalizeDemo(null)).toBeNull();
    expect(normalizeDemo({ html: "   ", css: "a{}" })).toBeNull();
    expect(normalizeDemoFix({})).toBeNull();
  });

  test("собирает все ошибки сразу", () => {
    let err;
    try {
      normalizeDemo(demo({
        audience: "everyone",
        height: 5,
        steps: [{ type: "eval", code: "x" }, { type: "click" }, { type: "addClass", target: "a", className: "1 bad" }],
      }));
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(DemoError);
    expect(err.errors).toHaveLength(5);
    expect(err.message).toMatch(/неизвестный тип "eval"/);
  });

  test("лимиты размера", () => {
    expect(() => normalizeDemo({ html: "x".repeat(20001) })).toThrow(/html длиннее/);
    expect(() => normalizeDemo({ html: "x", steps: Array(41).fill({ type: "wait" }) })).toThrow(/больше 40/);
  });
});

describe("кандидатский вид", () => {
  const q = { code: "C99", level: "qiyin", prompt: "Savol", promptRu: "Вопрос", answerKind: "text",
    demo: normalizeDemo(demo()), demoFix: normalizeDemoFix(fix) };

  test("сцена есть, исправления нет ни в каком виде", () => {
    const out = toCandidateQuestion(q, 1, "uz");
    expect(out.demo).toEqual({
      html: demo().html, css: demo().css, height: 240, width: 1440, slider: true, layers3d: true,
      caption: "Sintetik sahna",
      steps: [{ type: "wait", ms: 300 }, { type: "click", target: "#go" }, { type: "scroll", to: 400, ms: 1200 }],
    });
    const json = JSON.stringify(out);
    expect(json).not.toContain(FIX_MARK);
    expect(json).not.toContain("Tuzatilgan");
    expect(json).not.toMatch(/audience|demoFix|fix/i);
  });

  test("подпись на выбранном языке, без перевода — узбекская", () => {
    expect(toCandidateQuestion(q, 1, "ru").demo.caption).toBe("Синтетическая сцена");
    const noRu = { ...q, demo: { ...q.demo, captionRu: "" } };
    expect(toCandidateQuestion(noRu, 1, "ru").demo.caption).toBe("Sintetik sahna");
  });

  test("сцена «для интервьюера» кандидату не отдаётся", () => {
    const iq = { ...q, demo: { ...q.demo, audience: "interviewer" } };
    expect(toCandidateQuestion(iq, 1, "uz").demo).toBeUndefined();
    expect(toCandidateQuestion({ ...q, demo: undefined }, 1).demo).toBeUndefined();
  });

  test("сессия: сцена в открытом вопросе, исправление даже если оно попало в снимок", () => {
    const session = { status: "live", rev: 1, questions: [
      { ...q, order: 0, state: "open", openedAt: new Date(), demoFix: normalizeDemoFix(fix) },
    ] };
    const out = toCandidateSession(session, "uz");
    expect(out.questions[0].demo.html).toBe(demo().html);
    expect(JSON.stringify(out)).not.toContain(FIX_MARK);
  });
});

describe("в БД", () => {
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
    await BankQuestion.deleteMany({});
    await BankQuestion.create([
      { code: "C98", topic: "css", level: "orta", prompt: "Sintetik 1" },
      { code: "C99", topic: "css", level: "qiyin", prompt: "Sintetik 2" },
    ]);
  });

  test("запись идемпотентна; demoFix не отдаётся обычным find()", async () => {
    const entries = [{ code: "C99", demo: demo(), fix }, { code: "C00", demo: demo() }];
    const r1 = await applyDemos(entries);
    expect(r1).toMatchObject({ updated: 1, unchanged: 0, notFound: ["C00"], invalid: [] });
    const r2 = await applyDemos(entries);
    expect(r2).toMatchObject({ updated: 0, unchanged: 1 });

    const plain = await BankQuestion.findOne({ code: "C99" }).lean();
    expect(plain.demo.html).toBe(demo().html);
    expect(plain.demoFix).toBeUndefined();
    expect(JSON.stringify(plain)).not.toContain(FIX_MARK);
    const admin = await BankQuestion.findOne({ code: "C99" }).select("+demoFix").lean();
    expect(admin.demoFix.css).toContain(FIX_MARK);

    const exported = await exportDemos();
    expect(exported).toEqual([{ code: "C99", demo: normalizeDemo(demo()), fix: normalizeDemoFix(fix) }]);
  });

  test("dry-run ничего не пишет; невалидная сцена отклоняется; demo:null убирает", async () => {
    const dry = await applyDemos([{ code: "C99", demo: demo() }], { dryRun: true });
    expect(dry.updated).toBe(1);
    expect((await BankQuestion.findOne({ code: "C99" }).lean()).demo).toBeUndefined();

    const bad = await applyDemos([{ code: "C99", demo: demo({ steps: [{ type: "eval" }] }) }]);
    expect(bad.invalid).toHaveLength(1);

    await applyDemos([{ code: "C99", demo: demo(), fix }]);
    const rm = await applyDemos([{ code: "C99", demo: null }]);
    expect(rm.removed).toBe(1);
    const after = await BankQuestion.findOne({ code: "C99" }).select("+demoFix").lean();
    expect(after.demo).toBeUndefined();
    expect(after.demoFix).toBeUndefined();
  });

  test("модель не сохраняет сцену с неизвестным шагом", async () => {
    const q = await BankQuestion.findOne({ code: "C98" });
    q.demo = { html: "<p>x</p>", steps: [{ type: "eval", code: "alert(1)" }] };
    await expect(q.save()).rejects.toThrow(/неизвестный тип/);
  });

  test("снимок сессии хранит сцену, а поля demoFix в нём нет", async () => {
    expect(InterviewSession.schema.path("questions").schema.path("demo")).toBeDefined();
    expect(InterviewSession.schema.path("questions").schema.path("demoFix")).toBeUndefined();
  });
});
