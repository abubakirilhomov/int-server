// Читающий API разбора ошибок: список, детализация, переходы статуса и
// связка с аудит-логом — та самая, ради которой журнал свой, а не Sentry.
//
// auth подменён: проверяем гейт isAdmin и сами запросы, а не аутентификацию.
jest.mock("../src/middleware/auth", () => {
  const fn = (req, res, next) => {
    const u = global.__errTestUser;
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

const ErrorIssue = require("../src/models/errorIssueModel");
const ErrorEvent = require("../src/models/errorEventModel");
const AuditLog = require("../src/models/auditLogModel");
const Intern = require("../src/models/internModel");
const Branch = require("../src/models/branchModel");
const Mentor = require("../src/models/mentorModel");
const errorIssueRoutes = require("../src/routes/errorIssueRoutes");
const globalErrorHandler = require("../src/controllers/errorController");
const { ALLOWED_TRANSITIONS } = require("../src/controllers/errorIssueController");

jest.setTimeout(120000);

let mongod, server, baseUrl, intern;

const setUser = (u) => { global.__errTestUser = u; };
const admin = () => setUser({ id: String(new mongoose.Types.ObjectId()), role: "admin", name: "Бек", lastName: "Админов" });

const req = async (method, path, body) => {
  const res = await fetch(baseUrl + path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const get = (p) => req("GET", p);
const patch = (p, b) => req("PATCH", p, b);

const at = (minAgo) => new Date(Date.now() - minAgo * 60 * 1000);
const FP = (n) => String(n).padStart(40, "a");

const issue = (over = {}) => ({
  fingerprint: FP(1), app: "interns", kind: "react-render",
  sampleMessage: "Cannot read properties of undefined (reading 'name')",
  normalizedMessage: "Cannot read properties of undefined (reading 'name')",
  topFrames: ["LessonCard@assets/index.js"],
  firstSeen: at(60), lastSeen: at(5), count: 3, status: "new",
  affectedUsers: [], releases: ["r1"], ...over,
});

const event = (over = {}) => ({
  fingerprint: FP(1), app: "interns", kind: "react-render",
  message: "boom", normalizedMessage: "boom",
  stack: "TypeError: boom\n    at LessonCard (/assets/index.js:1:1)",
  topFrames: ["LessonCard@assets/index.js"],
  createdAt: at(5), actor: { id: null, kind: "anonymous" }, ...over,
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const app = express();
  app.use(express.json());
  app.use("/api/error-issues", errorIssueRoutes);
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
    ErrorIssue.deleteMany({}), ErrorEvent.deleteMany({}), AuditLog.deleteMany({}),
    Intern.deleteMany({}), Branch.deleteMany({}), Mentor.deleteMany({}),
  ]);
  const branch = await Branch.create({ name: "Minor" });
  const mentor = await Mentor.create({
    name: "Bek", lastName: "M", password: "hashed-placeholder", role: "mentor", branches: [branch._id],
  });
  intern = await Intern.create({
    name: "Али", lastName: "Валиев", username: `ali${Date.now()}`,
    password: "hashed-placeholder", branches: [{ branch: branch._id, mentor: mentor._id }],
  });
  admin();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("админ-гейт", () => {
  test("без пользователя — 401", async () => {
    setUser(null);
    expect((await get("/api/error-issues")).status).toBe(401);
  });

  test("обычный ментор — 403 на всех ручках", async () => {
    await ErrorIssue.create(issue());
    setUser({ id: "x", role: "mentor", isAdmin: false });
    for (const p of ["/api/error-issues", "/api/error-issues/stats", `/api/error-issues/${FP(1)}`]) {
      expect((await get(p)).status).toBe(403);
    }
    expect((await patch(`/api/error-issues/${FP(1)}`, { status: "ignored" })).status).toBe(403);
  });

  test("стажёр — 403", async () => {
    setUser({ id: "x", role: "intern", isAdmin: false });
    expect((await get("/api/error-issues")).status).toBe(403);
  });

  test("ментор с isAdmin и легаси role=admin проходят", async () => {
    setUser({ id: "x", role: "mentor", isAdmin: true });
    expect((await get("/api/error-issues")).status).toBe(200);
    setUser({ id: "x", role: "admin" });
    expect((await get("/api/error-issues")).status).toBe(200);
  });
});

describe("GET /api/error-issues — список и фильтры", () => {
  beforeEach(async () => {
    await ErrorIssue.insertMany([
      issue({ fingerprint: FP(1), app: "interns", kind: "react-render", count: 100, lastSeen: at(1), status: "new", releases: ["r1"] }),
      issue({ fingerprint: FP(2), app: "mentors", kind: "unhandled-rejection", count: 5, lastSeen: at(10), status: "triaged", releases: ["r2"], sampleMessage: "x is not a function" }),
      issue({ fingerprint: FP(3), app: "admin", kind: "http-5xx", count: 50, lastSeen: at(30), status: "resolved", releases: ["r1", "r2"] }),
      issue({ fingerprint: FP(4), app: "interns", kind: "network", count: 1, lastSeen: at(60 * 48), status: "ignored" }),
    ]);
  });

  test("отдаёт issue, а не события", async () => {
    const { body } = await get("/api/error-issues");
    expect(body.data).toHaveLength(4);
    expect(body.data[0]).toHaveProperty("fingerprint");
    expect(body.data[0]).toHaveProperty("count");
  });

  test("сортировка по lastSeen убыв. по умолчанию", async () => {
    const { body } = await get("/api/error-issues");
    const ts = body.data.map((d) => new Date(d.lastSeen).getTime());
    expect(ts).toEqual([...ts].sort((a, b) => b - a));
  });

  test("сортировка по частоте", async () => {
    const { body } = await get("/api/error-issues?sort=count");
    expect(body.data.map((d) => d.count)).toEqual([100, 50, 5, 1]);
    const asc = await get("/api/error-issues?sort=count&order=asc");
    expect(asc.body.data.map((d) => d.count)).toEqual([1, 5, 50, 100]);
  });

  test("неизвестное поле сортировки не ломает запрос", async () => {
    const r = await get("/api/error-issues?sort=$where");
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(4);
  });

  test("фильтры app / kind / status", async () => {
    expect((await get("/api/error-issues?app=interns")).body.pagination.total).toBe(2);
    expect((await get("/api/error-issues?kind=http-5xx")).body.pagination.total).toBe(1);
    expect((await get("/api/error-issues?status=new")).body.pagination.total).toBe(1);
  });

  test("несколько статусов через запятую — «покажи всё открытое»", async () => {
    const { body } = await get("/api/error-issues?status=new,triaged,fix-proposed");
    expect(body.pagination.total).toBe(2);
  });

  test("фильтр по релизу", async () => {
    expect((await get("/api/error-issues?release=r2")).body.pagination.total).toBe(2);
  });

  test("поиск по сообщению и по кадру стека", async () => {
    expect((await get("/api/error-issues?q=is not a function")).body.pagination.total).toBe(1);
    expect((await get("/api/error-issues?q=LessonCard")).body.pagination.total).toBe(4);
  });

  test("спецсимволы в поиске не ломают regex", async () => {
    const r = await get("/api/error-issues?q=" + encodeURIComponent("(("));
    expect(r.status).toBe(200);
    expect(r.body.pagination.total).toBe(0);
  });

  test("период по lastSeen", async () => {
    const { body } = await get(`/api/error-issues?from=${at(60).toISOString()}`);
    expect(body.pagination.total).toBe(3); // без двухдневной
  });

  test("пагинация и потолок limit", async () => {
    const p1 = (await get("/api/error-issues?limit=2&page=1")).body;
    const p2 = (await get("/api/error-issues?limit=2&page=2")).body;
    expect(p1.data).toHaveLength(2);
    expect(p1.pagination).toMatchObject({ total: 4, totalPages: 2, hasMore: true });
    expect(p2.pagination.hasMore).toBe(false);
    const ids = new Set([...p1.data, ...p2.data].map((d) => d.fingerprint));
    expect(ids.size).toBe(4);
    expect((await get("/api/error-issues?limit=99999")).body.pagination.limit).toBe(200);
  });
});

describe("GET /api/error-issues/:id — детализация", () => {
  beforeEach(async () => {
    await ErrorIssue.create(issue({ count: 3 }));
    await ErrorEvent.insertMany([
      event({ createdAt: at(30), release: "r1", actor: { id: String(intern._id), kind: "intern" } }),
      event({ createdAt: at(20), release: "r1", actor: { id: "u2", kind: "mentor", name: "Ментор" } }),
      event({ createdAt: at(10), release: "r2", actor: { id: String(intern._id), kind: "intern" },
              componentStack: "\n    in LessonCard", url: "https://x.uz/lessons",
              userAgent: "Mozilla/5.0", breadcrumbs: [{ type: "click", target: "button#add" }] }),
    ]);
  });

  test("отдаёт issue + события + разбивки", async () => {
    const { status, body } = await get(`/api/error-issues/${FP(1)}`);
    expect(status).toBe(200);
    expect(body.issue.fingerprint).toBe(FP(1));
    expect(body.events).toHaveLength(3);
    expect(body.events[0].createdAt > body.events[1].createdAt).toBe(true);
    expect(body.byRelease.map((r) => r._id).sort()).toEqual(["r1", "r2"]);
    expect(body.timeline.length).toBeGreaterThan(0);
  });

  test("события несут стек, componentStack, breadcrumbs, url, userAgent", async () => {
    const { body } = await get(`/api/error-issues/${FP(1)}`);
    const e = body.events[0];
    expect(e.stack).toContain("LessonCard");
    expect(e.componentStack).toContain("in LessonCard");
    expect(e.breadcrumbs[0].target).toBe("button#add");
    expect(e.url).toBe("https://x.uz/lessons");
    expect(e.userAgent).toBe("Mozilla/5.0");
  });

  test("точное число задетых считается по событиям, а не по выборке в issue", async () => {
    const { body } = await get(`/api/error-issues/${FP(1)}`);
    expect(body.affectedUsersExact).toBe(2); // intern дважды — один человек
  });

  test("имя стажёра дорезолвивается (auth.js его не грузит)", async () => {
    const { body } = await get(`/api/error-issues/${FP(1)}`);
    const withIntern = body.events.find((e) => e.actor.id === String(intern._id));
    expect(withIntern.actor.name).toBe("Али Валиев");
  });

  test("работает и по ObjectId, и по fingerprint", async () => {
    const doc = await ErrorIssue.findOne().lean();
    expect((await get(`/api/error-issues/${doc._id}`)).status).toBe(200);
    expect((await get(`/api/error-issues/${FP(1)}`)).status).toBe(200);
  });

  test("мусорный id — 400, несуществующий — 404", async () => {
    expect((await get("/api/error-issues/не-идентификатор")).status).toBe(400);
    expect((await get(`/api/error-issues/${FP(9)}`)).status).toBe(404);
  });

  test("число событий ограничено потолком", async () => {
    const { body } = await get(`/api/error-issues/${FP(1)}?events=99999`);
    expect(body.events.length).toBeLessThanOrEqual(50);
  });
});

describe("связка с аудит-логом — что делал перед падением", () => {
  const actorId = "64b7f9a2c1234567890abc01";
  let crashAt;

  beforeEach(async () => {
    crashAt = at(10);
    await ErrorIssue.create(issue());
    await ErrorEvent.create(event({
      createdAt: crashAt,
      actor: { id: actorId, kind: "mentor", role: "mentor", name: "Бек" },
    }));

    const t = (secBefore) => new Date(crashAt.getTime() - secBefore * 1000);
    await AuditLog.insertMany([
      { actor: { id: actorId, kind: "mentor" }, method: "GET", path: "/api/lessons",
        routePattern: "/api/lessons", statusCode: 200, createdAt: t(90) },
      { actor: { id: actorId, kind: "mentor" }, method: "POST", path: "/api/lessons",
        routePattern: "/api/lessons", statusCode: 201, createdAt: t(20) },
      { actor: { id: actorId, kind: "mentor" }, method: "GET", path: "/api/interns/x",
        routePattern: "/api/interns/:id", statusCode: 500, createdAt: t(2) },
      // Другой пользователь в то же время — не должен попасть.
      { actor: { id: "другой", kind: "mentor" }, method: "GET", path: "/api/x",
        routePattern: "/api/x", statusCode: 200, createdAt: t(5) },
      // Тот же пользователь, но вне окна.
      { actor: { id: actorId, kind: "mentor" }, method: "GET", path: "/api/old",
        routePattern: "/api/old", statusCode: 200, createdAt: t(3600) },
    ]);
  });

  test("отдаёт действия того же пользователя вокруг падения", async () => {
    const { status, body } = await get(`/api/error-issues/${FP(1)}/context`);
    expect(status).toBe(200);
    expect(body.entries).toHaveLength(3);
    expect(body.entries.every((e) => e.actor.id === actorId)).toBe(true);
    // По возрастанию времени — читается как лента событий.
    const ts = body.entries.map((e) => new Date(e.createdAt).getTime());
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  test("чужие записи не подмешиваются", async () => {
    const { body } = await get(`/api/error-issues/${FP(1)}/context`);
    expect(body.entries.some((e) => e.actor.id === "другой")).toBe(false);
  });

  test("записи вне окна отсекаются, окно настраивается", async () => {
    const narrow = await get(`/api/error-issues/${FP(1)}/context?windowSec=30`);
    expect(narrow.body.entries).toHaveLength(2); // 20с и 2с, без 90с

    const wide = await get(`/api/error-issues/${FP(1)}/context?windowSec=3600`);
    expect(wide.body.entries).toHaveLength(4); // добавилась запись из t(3600)
  });

  test("помечается запись, ближайшая к моменту падения", async () => {
    const { body } = await get(`/api/error-issues/${FP(1)}/context`);
    expect(body.closestIndex).toBe(2);
    expect(body.entries[body.closestIndex].statusCode).toBe(500);
  });

  test("окно возвращается в ответе — видно, что именно смотрели", async () => {
    const { body } = await get(`/api/error-issues/${FP(1)}/context?windowSec=60&afterSec=10`);
    const from = new Date(body.window.from).getTime();
    const to = new Date(body.window.to).getTime();
    expect(Math.round((to - from) / 1000)).toBe(70);
  });

  test("аноним честно помечается несвязываемым, а не пустым результатом", async () => {
    await ErrorEvent.deleteMany({});
    await ErrorEvent.create(event({ createdAt: crashAt, actor: { id: null, kind: "anonymous" } }));
    const { body } = await get(`/api/error-issues/${FP(1)}/context`);
    expect(body.entries).toEqual([]);
    expect(body.reason).toBe("anonymous-actor");
    expect(body.note).toBeTruthy();
  });

  test("можно попросить контекст конкретного события", async () => {
    const older = await ErrorEvent.create(event({
      createdAt: at(600), actor: { id: actorId, kind: "mentor" },
    }));
    const { body } = await get(`/api/error-issues/${FP(1)}/context?eventId=${older._id}`);
    expect(String(body.event._id)).toBe(String(older._id));
    expect(body.entries).toHaveLength(0); // вокруг того момента действий нет
  });

  test("событий не осталось (TTL съел) — объясняем, а не молчим", async () => {
    await ErrorEvent.deleteMany({});
    const { body } = await get(`/api/error-issues/${FP(1)}/context`);
    expect(body.reason).toBe("no-events");
    expect(body.event).toBeNull();
  });

  test("мусорный eventId — 400", async () => {
    expect((await get(`/api/error-issues/${FP(1)}/context?eventId=мусор`)).status).toBe(400);
  });
});

describe("PATCH /api/error-issues/:id — переходы статуса", () => {
  const mk = (status) => ErrorIssue.create(issue({ status }));

  test("основной маршрут плана проходит целиком", async () => {
    await mk("new");
    for (const [from, to] of [["new", "triaged"], ["triaged", "fix-proposed"], ["fix-proposed", "resolved"]]) {
      const r = await patch(`/api/error-issues/${FP(1)}`, { status: to });
      expect(r.status).toBe(200);
      expect(r.body.status).toBe(to);
    }
  });

  test("недопустимый переход — 400, а не молчаливое применение", async () => {
    await mk("resolved");
    const r = await patch(`/api/error-issues/${FP(1)}`, { status: "fix-proposed" });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain("Недопустимый переход");
    // Главное — статус не поменялся.
    expect((await ErrorIssue.findOne().lean()).status).toBe("resolved");
  });

  test("из ignored нельзя сразу в resolved", async () => {
    await mk("ignored");
    expect((await patch(`/api/error-issues/${FP(1)}`, { status: "resolved" })).status).toBe(400);
  });

  test("переоткрыть закрытое можно", async () => {
    await mk("resolved");
    expect((await patch(`/api/error-issues/${FP(1)}`, { status: "new" })).body.status).toBe("new");
  });

  test("отмахнуться можно с любого рабочего этапа", async () => {
    for (const from of ["new", "triaged", "fix-proposed"]) {
      await ErrorIssue.deleteMany({});
      await mk(from);
      expect((await patch(`/api/error-issues/${FP(1)}`, { status: "ignored" })).body.status).toBe("ignored");
    }
  });

  test("неизвестный статус — 400 со списком допустимых", async () => {
    await mk("new");
    const r = await patch(`/api/error-issues/${FP(1)}`, { status: "выдуманный" });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain("new");
  });

  test("тот же статус — идемпотентно, не ошибка", async () => {
    await mk("triaged");
    const r = await patch(`/api/error-issues/${FP(1)}`, { status: "triaged" });
    expect(r.status).toBe(200);
  });

  test("пустое тело — 400", async () => {
    await mk("new");
    expect((await patch(`/api/error-issues/${FP(1)}`, {})).status).toBe(400);
  });

  test("несуществующий issue — 404", async () => {
    expect((await patch(`/api/error-issues/${FP(9)}`, { status: "ignored" })).status).toBe(404);
  });

  test("пишется, кто менял статус", async () => {
    await mk("new");
    const { body } = await patch(`/api/error-issues/${FP(1)}`, { status: "triaged" });
    expect(body.statusChangedBy.name).toBe("Бек Админов");
    expect(body.statusChangedAt).toBeTruthy();
  });

  test("resolvedAt ставится и снимается", async () => {
    await mk("new");
    const resolved = await patch(`/api/error-issues/${FP(1)}`, { status: "resolved" });
    expect(resolved.body.resolvedAt).toBeTruthy();
    const reopened = await patch(`/api/error-issues/${FP(1)}`, { status: "new" });
    expect(reopened.body.resolvedAt).toBeNull();
  });

  test("заметку можно сохранить отдельно от статуса", async () => {
    await mk("new");
    const r = await patch(`/api/error-issues/${FP(1)}`, { notes: "чинит Азиз" });
    expect(r.body.notes).toBe("чинит Азиз");
    expect(r.body.status).toBe("new");
  });

  test("таблица переходов не содержит путей в самого себя", () => {
    for (const [from, to] of Object.entries(ALLOWED_TRANSITIONS)) {
      expect(to).not.toContain(from);
    }
  });
});

describe("GET /api/error-issues/stats", () => {
  beforeEach(async () => {
    await ErrorIssue.insertMany([
      issue({ fingerprint: FP(1), app: "interns", status: "new", count: 100, firstSeen: at(30) }),
      issue({ fingerprint: FP(2), app: "interns", status: "triaged", count: 5, firstSeen: at(30) }),
      issue({ fingerprint: FP(3), app: "mentors", status: "resolved", count: 50, firstSeen: at(60 * 24 * 30) }),
      issue({ fingerprint: FP(4), app: "admin", status: "ignored", count: 1, firstSeen: at(60 * 24 * 30) }),
    ]);
    await ErrorEvent.insertMany([
      event({ createdAt: at(10) }), event({ createdAt: at(20) }), event({ createdAt: at(30) }),
    ]);
  });

  test("сводка по статусам, приложениям и видам", async () => {
    const { body } = await get("/api/error-issues/stats");
    expect(body.byStatus).toMatchObject({ new: 1, triaged: 1, resolved: 1, ignored: 1 });
    expect(body.byApp.find((a) => a._id === "interns").count).toBe(2);
    expect(body.byKind["react-render"]).toBe(4);
  });

  test("итоги: сколько открыто и сколько новых за период", async () => {
    const { body } = await get("/api/error-issues/stats");
    expect(body.totals.issues).toBe(4);
    expect(body.totals.open).toBe(2); // new + triaged
    expect(body.totals.newInPeriod).toBe(2);
  });

  test("топ открытых — по частоте, закрытые не мешаются", async () => {
    const { body } = await get("/api/error-issues/stats");
    expect(body.topOpen[0].count).toBe(100);
    expect(body.topOpen.some((i) => i.status === "resolved")).toBe(false);
  });

  test("динамика событий по корзинам", async () => {
    const { body } = await get("/api/error-issues/stats");
    expect(body.timeline.reduce((a, b) => a + b.total, 0)).toBe(3);
    // Период по умолчанию — неделя, поэтому корзины суточные.
    expect(body.period.bucketUnit).toBe("day");
  });

  test("на коротком периоде корзины почасовые", async () => {
    const { body } = await get(`/api/error-issues/stats?from=${at(120).toISOString()}`);
    expect(body.period.bucketUnit).toBe("hour");
    expect(body.timeline.reduce((a, b) => a + b.total, 0)).toBe(3);
  });

  test("пустая база не роняет сводку", async () => {
    await Promise.all([ErrorIssue.deleteMany({}), ErrorEvent.deleteMany({})]);
    const { body } = await get("/api/error-issues/stats");
    expect(body.totals).toMatchObject({ issues: 0, open: 0, events: 0 });
    expect(body.topOpen).toEqual([]);
  });

  test("/stats не принимается за идентификатор", async () => {
    // Роут /:id объявлен ниже — если порядок сломают, здесь будет 400/404.
    expect((await get("/api/error-issues/stats")).status).toBe(200);
  });
});
