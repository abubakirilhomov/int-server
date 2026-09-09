// Точка приёма отчётов. Эндпоинт неавторизованный, поэтому проверяем прежде
// всего защиты: лимитер, потолок тела, валидацию и то, что крэш-луп не может
// сломать пользователю само приложение.
//
// Mongo здесь не нужна — запись покрыта в errorTracker.test.js. Трекер
// подменён, что заодно позволяет пересоздавать роутер (а с ним и лимитер)
// на каждый тест.
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "x".repeat(40);

jest.setTimeout(30000);

const tracked = [];
jest.mock("../src/services/errorTracker", () => ({
  track: (report) => {
    tracked.push(report);
    // Повторяем контракт настоящего трекера: возвращаем вердикт фильтра.
    const { classifyReport } = jest.requireActual("../src/utils/fingerprint");
    return classifyReport(report);
  },
}));

const ORIGIN = "https://interns-mars.uz";
const ownStack = "TypeError: boom\n    at LessonCard (" + ORIGIN + "/assets/index-Abc12345.js:4:8)";

// Поднимает приложение в ТОЙ ЖЕ последовательности, что index.js:
// error-reports смонтирован ДО общего лимитера и ДО глобального парсера тела.
const buildApp = (env = {}) => {
  let server;
  jest.isolateModules(() => {
    for (const [k, v] of Object.entries(env)) process.env[k] = String(v);

    const express = require("express");
    const rateLimit = require("express-rate-limit");
    const app = express();

    app.use("/api/error-reports", require("../src/routes/errorReportRoutes"));

    app.use(express.json({ limit: "10kb" }));
    app.use(
      "/api",
      rateLimit({
        windowMs: 60 * 1000,
        max: 100,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Слишком много запросов. Попробуйте через минуту." },
      })
    );
    // Обычный маршрут приложения — на нём проверяем, что лимит не съеден.
    app.get("/api/interns", (req, res) => res.json({ ok: true }));

    server = app.listen(0);
  });
  return server;
};

let server;
let base;

const start = async (env) => {
  server = buildApp(env);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  return base;
};

const post = (body, headers = {}) =>
  fetch(`${base}/api/error-reports`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const report = (over = {}) => ({
  app: "interns",
  kind: "react-render",
  message: "Cannot read properties of undefined (reading 'name')",
  stack: ownStack,
  url: `${ORIGIN}/lessons`,
  ...over,
});

beforeEach(() => {
  tracked.length = 0;
  delete process.env.ERROR_INGEST_RATE_MAX;
  delete process.env.ERROR_INGEST_MAX_BODY;
  delete process.env.ERROR_INGEST_MAX_BATCH;
});

afterEach(async () => {
  if (server) await new Promise((r) => server.close(r));
  server = null;
});

// ─────────────────────────────────────────────────────────────────────────────
describe("приём отчёта", () => {
  test("принимает одиночный отчёт без авторизации", async () => {
    await start();
    const res = await post(report());
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 1, dropped: 0, invalid: 0 });
    expect(tracked).toHaveLength(1);
    expect(tracked[0].app).toBe("interns");
  });

  test("принимает пачку — очередь ретрая с клиента", async () => {
    await start();
    const res = await post({ events: [report(), report(), report()] });
    expect((await res.json()).accepted).toBe(3);
    expect(tracked).toHaveLength(3);
  });

  test("пачка сверх потолка обрезается, а не принимается целиком", async () => {
    await start({ ERROR_INGEST_MAX_BATCH: 2 });
    const res = await post({ events: [report(), report(), report(), report()] });
    const body = await res.json();
    expect(body.accepted).toBe(2);
    expect(body.dropped).toBe(2);
    expect(tracked).toHaveLength(2);
  });

  test("неизвестное приложение отвергается", async () => {
    await start();
    const res = await post(report({ app: "нет-такого" }));
    expect((await res.json())).toEqual({ accepted: 0, dropped: 0, invalid: 1 });
    expect(tracked).toHaveLength(0);
  });

  test("неизвестный kind не теряется, а приводится к window-error", async () => {
    // Разошедшаяся версия клиента не должна приводить к тихой потере отчётов.
    await start();
    await post(report({ kind: "какой-то-новый" }));
    expect(tracked).toHaveLength(1);
    expect(tracked[0].kind).toBe("window-error");
  });

  test("мусор вместо тела не роняет сервер", async () => {
    await start();
    for (const body of ["null", "[]", '"строка"', "{}"]) {
      const res = await post(body);
      expect([202, 400]).toContain(res.status);
    }
    const alive = await fetch(`${base}/api/interns`);
    expect(alive.status).toBe(200);
  });

  test("битый JSON не роняет сервер", async () => {
    await start();
    const res = await post("{не json");
    expect(res.status).toBeGreaterThanOrEqual(400);
    const alive = await fetch(`${base}/api/interns`);
    expect(alive.status).toBe(200);
  });
});

describe("rate-limiter — главная защита эндпоинта", () => {
  test("крэш-луп упирается в свой лимит", async () => {
    await start({ ERROR_INGEST_RATE_MAX: 5 });

    const codes = [];
    for (let i = 0; i < 8; i += 1) codes.push((await post(report())).status);

    expect(codes.filter((c) => c === 202)).toHaveLength(5);
    expect(codes.filter((c) => c === 429)).toHaveLength(3);
    // Отброшенные лимитером до трекера не доходят.
    expect(tracked).toHaveLength(5);
  });

  test("крэш-луп НЕ съедает общий лимит приложения", async () => {
    // Ради этого эндпоинт и смонтирован до общего лимитера: иначе 100 отчётов
    // в минуту исчерпали бы пользователю бюджет /api и сломали бы ему само
    // приложение — то есть трекер ошибок сам стал бы аварией.
    await start({ ERROR_INGEST_RATE_MAX: 200 });

    for (let i = 0; i < 120; i += 1) await post(report());

    const res = await fetch(`${base}/api/interns`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("отлуп лимитера не мешает обычным запросам", async () => {
    await start({ ERROR_INGEST_RATE_MAX: 1 });
    await post(report());
    expect((await post(report())).status).toBe(429);
    expect((await fetch(`${base}/api/interns`)).status).toBe(200);
  });
});

describe("потолок размера тела", () => {
  test("гигантский отчёт отвергается, сервер жив", async () => {
    await start({ ERROR_INGEST_MAX_BODY: "8kb" });
    const res = await post(report({ context: { blob: "x".repeat(40000) } }));
    expect(res.status).toBe(413);
    expect(tracked).toHaveLength(0);
    expect((await fetch(`${base}/api/interns`)).status).toBe(200);
  });

  test("потолок здесь ВЫШЕ глобальных 10 КБ — стек с breadcrumbs должен влезать", async () => {
    await start();
    const big = report({
      stack: ownStack + "\n" + "    at f (https://interns-mars.uz/assets/index-Abc12345.js:1:1)".repeat(200),
      breadcrumbs: Array.from({ length: 20 }, (_, i) => ({ i, note: "y".repeat(400) })),
    });
    expect(JSON.stringify(big).length).toBeGreaterThan(10 * 1024);
    expect((await post(big)).status).toBe(202);
    expect(tracked).toHaveLength(1);
  });
});

describe("кто прислал", () => {
  const sign = (payload) => jwt.sign(payload, process.env.JWT_SECRET);

  test("валидный access-токен → подтверждённый актор", async () => {
    await start();
    const token = sign({ typ: "access", kind: "intern", id: "64b7f9a2c1234567890abc01", role: "intern" });
    await post(report(), { authorization: `Bearer ${token}` });

    expect(tracked[0].actor).toMatchObject({
      id: "64b7f9a2c1234567890abc01",
      kind: "intern",
      role: "intern",
      identifier: null,
    });
  });

  test("isAdmin из claims НЕ берётся — claims не источник истины для прав", async () => {
    await start();
    const token = sign({ typ: "access", kind: "mentor", id: "64b7f9a2c1234567890abc01", role: "admin", isAdmin: true });
    await post(report(), { authorization: `Bearer ${token}` });
    expect(tracked[0].actor.isAdmin).toBe(false);
  });

  test("подделанная подпись игнорируется, актор становится анонимом", async () => {
    await start();
    const forged = jwt.sign({ typ: "access", kind: "mentor", id: "хакер" }, "wrong-secret-".repeat(3));
    await post(report({ user: "ali" }), { authorization: `Bearer ${forged}` });

    expect(tracked[0].actor.kind).toBe("anonymous");
    expect(tracked[0].actor.id).toBeNull();
    expect(tracked[0].actor.identifier).toBe("ali");
  });

  test("без токена: заявленное имя идёт в identifier, а не в name", async () => {
    // Ровно то же различие, что в аудит-логе: name — подтверждено,
    // identifier — со слов клиента.
    await start();
    await post(report({ user: "ali" }));
    expect(tracked[0].actor).toMatchObject({
      id: null, kind: "anonymous", name: null, identifier: "ali",
    });
  });

  test("протухший токен не приводит к потере отчёта", async () => {
    await start();
    const expired = jwt.sign(
      { typ: "access", kind: "intern", id: "64b7f9a2c1234567890abc01" },
      process.env.JWT_SECRET,
      { expiresIn: -10 }
    );
    const res = await post(report(), { authorization: `Bearer ${expired}` });
    expect(res.status).toBe(202);
    expect(tracked[0].actor.kind).toBe("anonymous");
  });

  test("ip и user-agent берутся с сервера, а не со слов клиента", async () => {
    await start();
    await post(report({ ip: "1.1.1.1", userAgent: "враньё" }), { "user-agent": "jest-probe" });
    expect(tracked[0].userAgent).toBe("jest-probe");
    expect(tracked[0].ip).toBeTruthy();
    expect(tracked[0].ip).not.toBe("1.1.1.1");
  });
});

describe("шум отсекается на входе", () => {
  test("расширение браузера считается отброшенным", async () => {
    await start();
    const res = await post(report({
      stack: "TypeError: x\n    at inject (chrome-extension://kkk/c.js:1:1)",
    }));
    expect(await res.json()).toMatchObject({ accepted: 0, dropped: 1 });
  });

  test("стек без наших кадров отбрасывается", async () => {
    await start();
    const res = await post(report({
      stack: "TypeError: x\n    at t (https://mc.yandex.ru/metrika/tag.js:1:1)",
    }));
    expect(await res.json()).toMatchObject({ accepted: 0, dropped: 1 });
  });

  test("сетевая ошибка принимается как событие", async () => {
    await start();
    const res = await post(report({ kind: "api-failure", message: "Failed to fetch", stack: null }));
    expect(await res.json()).toMatchObject({ accepted: 1, dropped: 0 });
  });
});
