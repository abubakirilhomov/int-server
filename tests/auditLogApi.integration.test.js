// Аудит против настоящей (in-memory) Mongo: индексы и TTL реально создаются,
// фильтры/пагинация читающего API работают, не-админ до журнала не доходит.
//
// auth подменён: он лезет в БД за менторами и в RevokedToken, а проверяем мы
// здесь не аутентификацию, а гейт isAdmin и сами запросы.
jest.mock("../src/middleware/auth", () => {
  const fn = (req, res, next) => {
    const u = global.__auditTestUser;
    if (!u) return res.status(401).json({ message: "Нет токена" });
    req.user = u;
    next();
  };
  fn.invalidateIdentity = () => {};
  return fn;
});

const mongoose = require("mongoose");
const express = require("express");
const { MongoMemoryServer } = require("mongodb-memory-server");

const AuditLog = require("../src/models/auditLogModel");
const Intern = require("../src/models/internModel");
const Branch = require("../src/models/branchModel");
const Mentor = require("../src/models/mentorModel");
const auditLogRoutes = require("../src/routes/auditLogRoutes");
const globalErrorHandler = require("../src/controllers/errorController");

jest.setTimeout(120000);

let mongod, server, baseUrl, branchA, branchB, mentor, intern;

const setUser = (u) => {
  global.__auditTestUser = u;
};

const get = async (path) => {
  const res = await fetch(baseUrl + path);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
};

const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60 * 1000);

// Фабрика записей: заполняет только то, что читает API.
const log = (over = {}) => ({
  actor: { id: null, kind: "anonymous", role: null, isAdmin: false, name: null, identifier: null },
  method: "GET",
  path: "/api/interns",
  routePattern: "/api/interns",
  statusCode: 200,
  durationMs: 10,
  createdAt: at(1),
  ...over,
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const app = express();
  app.use(express.json());
  app.use("/api/audit-logs", auditLogRoutes);
  app.use(globalErrorHandler);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    AuditLog.deleteMany({}), Intern.deleteMany({}), Branch.deleteMany({}), Mentor.deleteMany({}),
  ]);
  branchA = await Branch.create({ name: "Minor" });
  branchB = await Branch.create({ name: "Tinchlik" });
  mentor = await Mentor.create({
    name: "Bek", lastName: "Manager", password: "hashed-placeholder",
    role: "mentor", branches: [branchA._id],
  });
  intern = await Intern.create({
    name: "Ali", lastName: "Valiev", username: `ali${Date.now()}`,
    password: "hashed-placeholder", branches: [{ branch: branchA._id, mentor: mentor._id }],
  });
  setUser({ id: String(new mongoose.Types.ObjectId()), role: "admin", isAdmin: true });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("индексы и TTL", () => {
  test("создаются все индексы мониторинга + TTL на createdAt", async () => {
    await AuditLog.syncIndexes();
    const idx = await AuditLog.collection.indexes();
    const byKey = (k) => idx.find((i) => JSON.stringify(i.key) === JSON.stringify(k));

    expect(byKey({ createdAt: -1 })).toBeDefined();
    expect(byKey({ "actor.id": 1, createdAt: -1 })).toBeDefined();
    expect(byKey({ routePattern: 1, createdAt: -1 })).toBeDefined();
    expect(byKey({ statusCode: 1, createdAt: -1 })).toBeDefined();

    const ttl = byKey({ createdAt: 1 });
    expect(ttl).toBeDefined();
    expect(ttl.expireAfterSeconds).toBe(180 * 24 * 60 * 60); // дефолт 180 дней
  });

  test("AUDIT_RETENTION_DAYS меняет срок TTL-индекса", () => {
    jest.isolateModules(() => {
      const prev = process.env.AUDIT_RETENTION_DAYS;
      process.env.AUDIT_RETENTION_DAYS = "7";
      // Отдельный реестр моделей, чтобы не конфликтовать с уже собранной AuditLog.
      const m = require("mongoose");
      const orig = m.model.bind(m);
      m.model = (name, schema) => {
        if (name === "AuditLog") {
          const ttl = schema.indexes().find(([k]) => JSON.stringify(k) === '{"createdAt":1}');
          expect(ttl[1].expireAfterSeconds).toBe(7 * 24 * 60 * 60);
          return {};
        }
        return orig(name, schema);
      };
      require("../src/models/auditLogModel");
      m.model = orig;
      if (prev === undefined) delete process.env.AUDIT_RETENTION_DAYS;
      else process.env.AUDIT_RETENTION_DAYS = prev;
    });
  });
});

describe("админ-гейт", () => {
  test("без пользователя — 401", async () => {
    setUser(null);
    expect((await get("/api/audit-logs")).status).toBe(401);
  });

  test("обычный ментор — 403", async () => {
    setUser({ id: "x", role: "mentor", isAdmin: false });
    const r = await get("/api/audit-logs");
    expect(r.status).toBe(403);
    expect(r.body.message).toBe("Требуется роль администратора");
  });

  test("стажёр — 403, в т.ч. на /stats", async () => {
    setUser({ id: "x", role: "intern", isAdmin: false });
    expect((await get("/api/audit-logs")).status).toBe(403);
    expect((await get("/api/audit-logs/stats")).status).toBe(403);
  });

  test("ментор с флагом isAdmin проходит", async () => {
    setUser({ id: "x", role: "mentor", isAdmin: true });
    expect((await get("/api/audit-logs")).status).toBe(200);
  });

  test("легаси role=admin тоже проходит", async () => {
    setUser({ id: "x", role: "admin" });
    expect((await get("/api/audit-logs")).status).toBe(200);
  });
});

describe("GET /api/audit-logs — фильтры", () => {
  const actorA = "64b7f9a2c1234567890abc01";

  beforeEach(async () => {
    await AuditLog.insertMany([
      log({ actor: { id: actorA, kind: "mentor", role: "mentor", isAdmin: false, name: "Bek" },
            method: "POST", path: "/api/lessons", routePattern: "/api/lessons",
            statusCode: 201, createdAt: at(10), branchId: branchA._id }),
      log({ actor: { id: actorA, kind: "mentor", role: "mentor", isAdmin: false, name: "Bek" },
            method: "DELETE", path: "/api/interns/64b7f9a2c1234567890abcde",
            routePattern: "/api/interns/:id", statusCode: 404, createdAt: at(20),
            error: "Не найдено", branchId: branchA._id }),
      log({ actor: { id: String(intern._id), kind: "intern", role: "intern", isAdmin: false, name: null },
            method: "GET", path: "/api/interns/me", routePattern: "/api/interns/me",
            statusCode: 500, createdAt: at(30), error: "boom", branchId: branchB._id }),
      log({ actor: { id: null, kind: "anonymous", role: null, isAdmin: false, name: null, identifier: "ali" },
            method: "POST", path: "/api/interns/login", routePattern: "/api/interns/login",
            statusCode: 401, createdAt: at(40), error: "Неверные данные" }),
      log({ path: "/api/old", routePattern: "/api/old", createdAt: at(60 * 48) }), // для from/to
    ]);
  });

  const ids = (b) => b.data.map((d) => d.routePattern);

  test("по умолчанию — сортировка по createdAt убыв.", async () => {
    const { body } = await get("/api/audit-logs");
    expect(body.data).toHaveLength(5);
    const times = body.data.map((d) => new Date(d.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  test("actorId", async () => {
    const { body } = await get(`/api/audit-logs?actorId=${actorA}`);
    expect(body.pagination.total).toBe(2);
    expect(body.data.every((d) => d.actor.id === actorA)).toBe(true);
  });

  test("kind и role", async () => {
    // Аноним — это и неудачный логин, и фоновая запись без пользователя.
    expect((await get("/api/audit-logs?kind=anonymous")).body.pagination.total).toBe(2);
    expect((await get("/api/audit-logs?role=intern")).body.pagination.total).toBe(1);
  });

  test("method (регистронезависимо)", async () => {
    expect((await get("/api/audit-logs?method=post")).body.pagination.total).toBe(2);
  });

  test("status: точное значение", async () => {
    const { body } = await get("/api/audit-logs?status=404");
    expect(body.pagination.total).toBe(1);
    expect(body.data[0].error).toBe("Не найдено");
  });

  test("status: диапазоны 4xx / 5xx / 2xx", async () => {
    expect((await get("/api/audit-logs?status=4xx")).body.pagination.total).toBe(2);
    expect((await get("/api/audit-logs?status=5xx")).body.pagination.total).toBe(1);
    expect((await get("/api/audit-logs?status=2xx")).body.pagination.total).toBe(2);
  });

  test("routePattern — точное совпадение", async () => {
    expect(ids((await get("/api/audit-logs?routePattern=/api/interns/:id")).body))
      .toEqual(["/api/interns/:id"]);
  });

  test("поиск по пути — подстрока", async () => {
    const { body } = await get("/api/audit-logs?path=/api/interns");
    expect(body.pagination.total).toBe(3);
  });

  test("спецсимволы в поиске по пути не ломают regex", async () => {
    const r = await get("/api/audit-logs?path=" + encodeURIComponent("interns/("));
    expect(r.status).toBe(200);
    expect(r.body.pagination.total).toBe(0);
  });

  test("branchId", async () => {
    expect((await get(`/api/audit-logs?branchId=${branchA._id}`)).body.pagination.total).toBe(2);
    expect((await get(`/api/audit-logs?branchId=${branchB._id}`)).body.pagination.total).toBe(1);
  });

  test("невалидный branchId просто игнорируется, а не роняет запрос", async () => {
    const r = await get("/api/audit-logs?branchId=not-an-id");
    expect(r.status).toBe(200);
    expect(r.body.pagination.total).toBe(5);
  });

  test("from / to", async () => {
    const { body } = await get(`/api/audit-logs?from=${at(60).toISOString()}`);
    expect(body.pagination.total).toBe(4); // без двухдневной
    const only = await get(`/api/audit-logs?from=${at(25).toISOString()}&to=${at(15).toISOString()}`);
    expect(only.body.pagination.total).toBe(1);
    expect(only.body.data[0].method).toBe("DELETE");
  });

  test("фильтры комбинируются", async () => {
    const { body } = await get(`/api/audit-logs?actorId=${actorA}&status=4xx`);
    expect(body.pagination.total).toBe(1);
    expect(body.data[0].method).toBe("DELETE");
  });

  test("имя стажёра дорезолвивается на чтении (в записи его нет)", async () => {
    const { body } = await get("/api/audit-logs?role=intern");
    expect(body.data[0].actor.name).toBe("Ali Valiev");
  });
});

describe("GET /api/audit-logs — пагинация", () => {
  beforeEach(async () => {
    await AuditLog.insertMany(
      Array.from({ length: 25 }, (_, i) => log({ path: `/api/x/${i}`, createdAt: at(i) }))
    );
  });

  test("limit и page режут выдачу, страницы не пересекаются", async () => {
    const p1 = (await get("/api/audit-logs?limit=10&page=1")).body;
    const p2 = (await get("/api/audit-logs?limit=10&page=2")).body;
    const p3 = (await get("/api/audit-logs?limit=10&page=3")).body;

    expect(p1.data).toHaveLength(10);
    expect(p2.data).toHaveLength(10);
    expect(p3.data).toHaveLength(5);
    expect(p1.pagination).toMatchObject({ page: 1, limit: 10, total: 25, totalPages: 3, hasMore: true });
    expect(p3.pagination.hasMore).toBe(false);

    const all = new Set([...p1.data, ...p2.data, ...p3.data].map((d) => String(d._id)));
    expect(all.size).toBe(25);
  });

  test("limit ограничен потолком 200", async () => {
    expect((await get("/api/audit-logs?limit=100000")).body.pagination.limit).toBe(200);
  });

  test("мусорные limit/page откатываются к дефолтам", async () => {
    const { body } = await get("/api/audit-logs?limit=abc&page=-4");
    expect(body.pagination).toMatchObject({ limit: 50, page: 1 });
  });
});

describe("GET /api/audit-logs/stats", () => {
  beforeEach(async () => {
    await AuditLog.insertMany([
      ...Array.from({ length: 6 }, () =>
        log({ routePattern: "/api/lessons", method: "POST", statusCode: 201, durationMs: 20,
              actor: { id: "a1", kind: "mentor", role: "mentor", isAdmin: false, name: "Bek" } })),
      ...Array.from({ length: 3 }, () =>
        log({ routePattern: "/api/interns/:id", method: "PATCH", statusCode: 403, durationMs: 5,
              actor: { id: "a2", kind: "intern", role: "intern", isAdmin: false, name: null } })),
      log({ routePattern: "/api/interns/:id", method: "PATCH", statusCode: 500, durationMs: 5,
            actor: { id: "a2", kind: "intern", role: "intern", isAdmin: false, name: null } }),
      ...Array.from({ length: 4 }, () =>
        log({ routePattern: "/api/interns/login", method: "POST", statusCode: 401,
              actor: { id: null, kind: "anonymous", role: null, isAdmin: false, name: null, identifier: "hacker" },
              ip: "1.2.3.4" })),
      log({ createdAt: at(60 * 48) }), // вне окна по умолчанию
    ]);
  });

  test("сводка по умолчанию — за сутки, без старой записи", async () => {
    const { body } = await get("/api/audit-logs/stats");
    expect(body.totals.requests).toBe(14);
    expect(body.totals.errors).toBe(8);
    expect(body.totals.clientErrors).toBe(7);
    expect(body.totals.serverErrors).toBe(1);
    expect(body.totals.errorRate).toBeCloseTo(57.14, 1);
    expect(body.totals.avgDurationMs).toBeGreaterThan(0);
  });

  test("топ акторов", async () => {
    const { body } = await get("/api/audit-logs/stats");
    expect(body.topActors[0]).toMatchObject({ _id: "a1", count: 6, kind: "mentor", errors: 0 });
    expect(body.topActors[1]).toMatchObject({ _id: "a2", count: 4, errors: 4 });
    expect(body.topActors.some((a) => a._id === null)).toBe(false);
  });

  test("топ эндпоинтов и топ по ошибкам", async () => {
    const { body } = await get("/api/audit-logs/stats");
    expect(body.topRoutes[0]._id).toEqual({ routePattern: "/api/lessons", method: "POST" });
    expect(body.topRoutes[0].count).toBe(6);

    const errRoutes = Object.fromEntries(body.topErrorRoutes.map((r) => [r._id.routePattern, r]));
    expect(errRoutes["/api/interns/:id"]).toMatchObject({ count: 4, clientErrors: 3, serverErrors: 1 });
    expect(errRoutes["/api/lessons"]).toBeUndefined();
  });

  test("неудачные входы группируются по логину и ip", async () => {
    const { body } = await get("/api/audit-logs/stats");
    expect(body.failedLogins[0]).toMatchObject({ _id: { identifier: "hacker", ip: "1.2.3.4" }, count: 4 });
  });

  test("динамика: почасовые корзины на суточном окне", async () => {
    const { body } = await get("/api/audit-logs/stats");
    expect(body.period.bucketUnit).toBe("hour");
    expect(body.timeline.length).toBeGreaterThan(0);
    const sum = body.timeline.reduce((a, b) => a + b.total, 0);
    const errs = body.timeline.reduce((a, b) => a + b.errors, 0);
    expect(sum).toBe(body.totals.requests);
    expect(errs).toBe(body.totals.errors);
    // Корзины идут по возрастанию времени — график строится как есть.
    const ts = body.timeline.map((b) => new Date(b._id).getTime());
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  test("на длинном периоде корзины укрупняются до суток", async () => {
    const { body } = await get(`/api/audit-logs/stats?from=${at(60 * 24 * 10).toISOString()}`);
    expect(body.period.bucketUnit).toBe("day");
  });

  test("явный период учитывает и старые записи", async () => {
    const { body } = await get(`/api/audit-logs/stats?from=${at(60 * 72).toISOString()}`);
    expect(body.totals.requests).toBe(15);
  });

  test("пустой период не роняет сводку", async () => {
    await AuditLog.deleteMany({});
    const { body } = await get("/api/audit-logs/stats");
    expect(body.totals).toMatchObject({ requests: 0, errors: 0, errorRate: 0 });
    expect(body.topActors).toEqual([]);
  });
});
