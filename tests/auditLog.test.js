// Поведение аудит-middleware без обращения к Mongo: модель подменена,
// проверяем ЧТО именно уходит на запись и что аудит не влияет на ответ.
const mockInsertMany = jest.fn().mockResolvedValue([]);
jest.mock("../src/models/auditLogModel", () => ({
  insertMany: (...args) => mockInsertMany(...args),
}));

const express = require("express");
const { EventEmitter } = require("events");
const auditLog = require("../src/middleware/auditLog");
const { redact, redactAndCap, normalizePath, flush } = auditLog;

jest.setTimeout(30000);

// ─── Мини-приложение, повторяющее монтаж из index.js ─────────────────────────
let server, baseUrl;

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api", auditLog);

  const interns = express.Router();
  interns.post("/login", (req, res) => {
    if (req.body.password === "correct") return res.json({ token: "jwt-value" });
    res.status(401).json({ error: "Неверное имя пользователя или пароль" });
  });
  interns.get("/:id", (req, res) => res.json({ id: req.params.id }));
  interns.patch("/:id/activation", (req, res) => {
    req.user = undefined;
    res.json({ ok: true });
  });
  // Аутентифицированный маршрут: auth кладёт req.user, как настоящий.
  interns.post("/:id/violations", (req, res) => res.status(201).json({ ok: true }));
  app.use("/api/interns", (req, res, next) => {
    if (req.headers["x-test-user"]) req.user = JSON.parse(req.headers["x-test-user"]);
    next();
  }, interns);

  app.get("/api/audit-logs", (req, res) => res.json({ data: [] }));
  app.all(/(.*)/, (req, res) => res.status(404).json({ message: "Not found" }));
  return app;
};

beforeAll(async () => {
  server = buildApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((r) => server.close(r)));

beforeEach(() => {
  mockInsertMany.mockClear();
  mockInsertMany.mockResolvedValue([]);
  process.env.AUDIT_ENABLED = "true";
});

// Один запрос → слив буфера → записанные документы.
const recorded = async (path, init) => {
  const res = await fetch(baseUrl + path, init);
  await res.text();
  await flush();
  return mockInsertMany.mock.calls.flatMap(([batch]) => batch);
};

const json = (body, headers = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

// ─────────────────────────────────────────────────────────────────────────────
describe("redact — секреты не попадают в журнал", () => {
  test("вырезает все перечисленные ключи", () => {
    const out = redact({
      password: "hunter2",
      currentPassword: "old",
      newPassword: "new",
      token: "t",
      refreshToken: "rt",
      accessToken: "at",
      authorization: "Bearer x",
      secret: "s",
      jwt: "j",
    });
    for (const v of Object.values(out)) expect(v).toBe("[REDACTED]");
  });

  test("работает рекурсивно и внутри массивов", () => {
    const out = redact({
      user: { name: "Ali", credentials: { password: "hunter2" } },
      sessions: [{ accessToken: "a" }, { accessToken: "b" }],
    });
    expect(out.user.name).toBe("Ali");
    expect(out.user.credentials.password).toBe("[REDACTED]");
    expect(out.sessions).toEqual([{ accessToken: "[REDACTED]" }, { accessToken: "[REDACTED]" }]);
  });

  test("ловит варианты написания: refresh_token, Refresh-Token, JWT_SECRET", () => {
    const out = redact({ refresh_token: "a", "Refresh-Token": "b", JWT_SECRET: "c" });
    expect(Object.values(out)).toEqual(["[REDACTED]", "[REDACTED]", "[REDACTED]"]);
  });

  test("несекретные поля не портятся", () => {
    const body = { name: "Ali", stars: 5, tags: ["a"], nested: { x: 1 }, ok: null };
    expect(redact(body)).toEqual(body);
  });

  test("не мутирует исходный req.body", () => {
    const body = { password: "hunter2" };
    redact(body);
    expect(body.password).toBe("hunter2");
  });

  test("обрезает тело больше лимита, сохраняя список полей", () => {
    const out = redactAndCap({ photo: "x".repeat(10000), name: "Ali" });
    expect(out._truncated).toBe(true);
    expect(out._keys).toEqual(expect.arrayContaining(["photo", "name"]));
    expect(JSON.stringify(out).length).toBeLessThan(500);
  });
});

describe("сквозь HTTP: тело мутаций пишется отредактированным", () => {
  test("пароль из тела логина не уходит в журнал", async () => {
    const docs = await recorded("/api/interns/login", json({ username: "ali", password: "hunter2" }));
    expect(docs).toHaveLength(1);
    expect(docs[0].body).toEqual({ username: "ali", password: "[REDACTED]" });
    expect(JSON.stringify(docs[0])).not.toContain("hunter2");
  });

  test("токен из успешного ответа тоже нигде не всплывает", async () => {
    const docs = await recorded("/api/interns/login", json({ username: "ali", password: "correct" }));
    expect(JSON.stringify(docs[0])).not.toContain("jwt-value");
  });

  test("у GET тело не пишется вовсе", async () => {
    const docs = await recorded("/api/interns/64b7f9a2c1234567890abcde");
    expect(docs[0].body).toBeNull();
    expect(docs[0].method).toBe("GET");
  });
});

describe("неудачные входы", () => {
  test("401 на логине пишется с kind=anonymous и логином без пароля", async () => {
    const docs = await recorded("/api/interns/login", json({ username: "ali", password: "wrong" }));
    const d = docs[0];
    expect(d.statusCode).toBe(401);
    expect(d.actor.kind).toBe("anonymous");
    expect(d.actor.id).toBeNull();
    expect(d.actor.identifier).toBe("ali");
    expect(d.error).toBe("Неверное имя пользователя или пароль");
    expect(JSON.stringify(d)).not.toContain("wrong");
  });

  test("ментор логинится парой name+lastName — она и попадает в identifier", async () => {
    const docs = await recorded("/api/interns/login", json({ name: "Bek", lastName: "M", password: "x" }));
    expect(docs[0].actor.identifier).toBe("Bek M");
  });
});

describe("актор из req.user", () => {
  const user = {
    id: "64b7f9a2c1234567890abcde",
    role: "mentor",
    isAdmin: true,
    name: "Bek",
    lastName: "Manager",
    branchId: "64b7f9a2c1234567890abcd0",
  };

  test("ментор: kind, role, isAdmin, имя и филиал", async () => {
    const docs = await recorded(
      "/api/interns/64b7f9a2c1234567890abcde/violations",
      json({ ruleId: "1" }, { "x-test-user": JSON.stringify(user) })
    );
    const d = docs[0];
    expect(d.actor).toMatchObject({ id: user.id, kind: "mentor", role: "mentor", isAdmin: true, name: "Bek Manager" });
    expect(String(d.branchId)).toBe(user.branchId);
    expect(d.statusCode).toBe(201);
  });

  test("стажёр отличается по role → kind=intern", async () => {
    const docs = await recorded(
      "/api/interns/64b7f9a2c1234567890abcde/violations",
      json({}, { "x-test-user": JSON.stringify({ id: user.id, role: "intern" }) })
    );
    expect(docs[0].actor.kind).toBe("intern");
    expect(docs[0].actor.isAdmin).toBe(false);
    expect(docs[0].actor.name).toBeNull(); // auth.js имя стажёра не грузит
  });
});

describe("routePattern", () => {
  test("конкретный id схлопывается в :id", async () => {
    const docs = await recorded("/api/interns/64b7f9a2c1234567890abcde");
    expect(docs[0].routePattern).toBe("/api/interns/:id");
    expect(docs[0].path).toBe("/api/interns/64b7f9a2c1234567890abcde");
    expect(docs[0].resource).toEqual({ type: "interns", id: "64b7f9a2c1234567890abcde" });
  });

  test("вложенный сегмент сохраняется", async () => {
    const docs = await recorded(
      "/api/interns/64b7f9a2c1234567890abcde/violations",
      json({})
    );
    expect(docs[0].routePattern).toBe("/api/interns/:id/violations");
  });

  test("404 (роут не сматчился) — нормализуем путь вручную", async () => {
    const docs = await recorded("/api/nope/64b7f9a2c1234567890abcde");
    expect(docs[0].routePattern).toBe("/api/nope/:id");
    expect(docs[0].statusCode).toBe(404);
  });

  test("числовые и uuid-сегменты тоже схлопываются", () => {
    expect(normalizePath("/api/lessons/42/rate")).toBe("/api/lessons/:id/rate");
    expect(normalizePath("/api/x/3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe("/api/x/:id");
  });

  test("query пишется, но в path его нет", async () => {
    const docs = await recorded("/api/interns/64b7f9a2c1234567890abcde?expand=1");
    expect(docs[0].path).toBe("/api/interns/64b7f9a2c1234567890abcde");
    expect(docs[0].query).toEqual({ expand: "1" });
  });
});

describe("аудит не ломает запрос", () => {
  test("падение insertMany не влияет на ответ", async () => {
    mockInsertMany.mockRejectedValue(new Error("mongo down"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await fetch(baseUrl + "/api/interns/64b7f9a2c1234567890abcde");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "64b7f9a2c1234567890abcde" });
    await flush();
    expect(spy).toHaveBeenCalledWith("[audit] flush failed:", "mongo down");
    spy.mockRestore();
  });

  test("исключение при сборке документа гасится, ответ уже отдан", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = new EventEmitter();
    Object.assign(res, { statusCode: 200, json: (p) => p });
    const req = {
      method: "POST",
      originalUrl: "/api/interns",
      headers: {},
      body: { a: 1 },
      get params() { throw new Error("boom"); },
    };
    const next = jest.fn();
    expect(() => auditLog(req, res, next)).not.toThrow();
    expect(next).toHaveBeenCalled();
    expect(() => res.emit("finish")).not.toThrow();
    expect(spy).toHaveBeenCalledWith("[audit] failed to record request:", "boom");
    spy.mockRestore();
  });

  test("исключение до навешивания хука тоже гасится и next() зовётся", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const next = jest.fn();
    const req = { method: "POST", get originalUrl() { throw new Error("bad url"); } };
    expect(() => auditLog(req, {}, next)).not.toThrow();
    expect(next).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("объём и переключатели", () => {
  test("AUDIT_ENABLED=false полностью выключает запись", async () => {
    process.env.AUDIT_ENABLED = "false";
    const docs = await recorded("/api/interns/64b7f9a2c1234567890abcde");
    expect(docs).toHaveLength(0);
  });

  test("сам /api/audit-logs в журнал не пишется", async () => {
    const docs = await recorded("/api/audit-logs?page=1");
    expect(docs).toHaveLength(0);
  });

  test("несколько запросов уходят одной пачкой insertMany", async () => {
    await Promise.all([
      fetch(baseUrl + "/api/interns/64b7f9a2c1234567890abc01"),
      fetch(baseUrl + "/api/interns/64b7f9a2c1234567890abc02"),
      fetch(baseUrl + "/api/interns/64b7f9a2c1234567890abc03"),
    ]);
    await flush();
    expect(mockInsertMany).toHaveBeenCalledTimes(1);
    expect(mockInsertMany.mock.calls[0][0]).toHaveLength(3);
    expect(mockInsertMany.mock.calls[0][1]).toEqual({ ordered: false });
  });

  test("пишутся длительность, ip и user-agent", async () => {
    const docs = await recorded("/api/interns/64b7f9a2c1234567890abcde", {
      headers: { "user-agent": "jest-probe" },
    });
    expect(docs[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(docs[0].userAgent).toBe("jest-probe");
    expect(docs[0].ip).toBeTruthy();
    expect(docs[0].createdAt).toBeInstanceOf(Date);
  });
});
