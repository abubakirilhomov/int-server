// Трекер против настоящей (in-memory) Mongo: группировка в issue, редакция
// секретов, TTL/индексы, фатальные обработчики.
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

// Telegram не дёргаем — проверяем только, что трекер его вызывает.
const mockSendMessage = jest.fn().mockResolvedValue({ sent: 1, failed: 0, errors: [] });
jest.mock("../src/services/telegramService", () => ({
  sendMessage: (...a) => mockSendMessage(...a),
}));

const ErrorEvent = require("../src/models/errorEventModel");
const ErrorIssue = require("../src/models/errorIssueModel");
const errorTracker = require("../src/services/errorTracker");
const errorAlerts = require("../src/services/errorAlerts");
const { createFatalHandler } = require("../src/utils/fatalHandler");

jest.setTimeout(120000);

let mongod;

const ORIGIN = "https://interns-mars.uz";
const ownStack = (fn = "LessonCard") =>
  [`TypeError: boom`, `    at ${fn} (${ORIGIN}/assets/index-Abc12345.js:4:8)`].join("\n");

const report = (over = {}) => ({
  app: "interns",
  kind: "react-render",
  message: "Cannot read properties of undefined (reading 'name')",
  stack: ownStack(),
  url: `${ORIGIN}/lessons`,
  ...over,
});

const trackAndFlush = async (...reports) => {
  for (const r of reports) errorTracker.track(r);
  await errorTracker.flush();
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([ErrorEvent.deleteMany({}), ErrorIssue.deleteMany({})]);
  mockSendMessage.mockClear();
  errorAlerts._resetBudget();
  process.env.ERROR_TRACKING_ENABLED = "true";
  process.env.ERROR_ALERTS_ENABLED = "false"; // включаем точечно в своём блоке
  delete process.env.ERROR_ALERT_CHAT_IDS;
});

// ─────────────────────────────────────────────────────────────────────────────
describe("индексы и TTL", () => {
  test("ErrorEvent: TTL 30 дней по умолчанию + индексы разбора", async () => {
    await ErrorEvent.syncIndexes();
    const idx = await ErrorEvent.collection.indexes();
    const byKey = (k) => idx.find((i) => JSON.stringify(i.key) === JSON.stringify(k));

    expect(byKey({ fingerprint: 1, createdAt: -1 })).toBeDefined();
    expect(byKey({ createdAt: -1 })).toBeDefined();
    expect(byKey({ app: 1, createdAt: -1 })).toBeDefined();

    const ttl = byKey({ createdAt: 1 });
    expect(ttl).toBeDefined();
    expect(ttl.expireAfterSeconds).toBe(30 * 24 * 60 * 60);
  });

  test("ErrorIssue: TTL НЕТ — счётчик переживает исчезновение сырья", async () => {
    await ErrorIssue.syncIndexes();
    const idx = await ErrorIssue.collection.indexes();
    expect(idx.some((i) => i.expireAfterSeconds !== undefined)).toBe(false);
    expect(idx.find((i) => JSON.stringify(i.key) === '{"fingerprint":1}').unique).toBe(true);
  });
});

describe("группировка в issue", () => {
  test("одинаковые ошибки → один issue со счётчиком", async () => {
    await trackAndFlush(report(), report(), report());

    expect(await ErrorEvent.countDocuments()).toBe(3);
    const issues = await ErrorIssue.find().lean();
    expect(issues).toHaveLength(1);
    expect(issues[0].count).toBe(3);
    expect(issues[0].status).toBe("new");
    expect(issues[0].app).toBe("interns");
    expect(issues[0].topFrames[0]).toBe("LessonCard@assets/index.js");
  });

  test("счётчик копится между сбросами буфера", async () => {
    await trackAndFlush(report());
    await trackAndFlush(report(), report());
    const issue = await ErrorIssue.findOne().lean();
    expect(issue.count).toBe(3);
    expect(await ErrorIssue.countDocuments()).toBe(1);
  });

  test("разные ошибки → разные issue", async () => {
    await trackAndFlush(report(), report({ stack: ownStack("ProfileCard") }));
    expect(await ErrorIssue.countDocuments()).toBe(2);
  });

  test("firstSeen не сдвигается, lastSeen растёт", async () => {
    const t0 = new Date(Date.now() - 60_000);
    const t1 = new Date();
    await trackAndFlush(report({ createdAt: t0 }));
    await trackAndFlush(report({ createdAt: t1 }));

    const issue = await ErrorIssue.findOne().lean();
    expect(issue.firstSeen.getTime()).toBe(t0.getTime());
    expect(issue.lastSeen.getTime()).toBe(t1.getTime());
  });

  test("собираются задетые пользователи и релизы, без дублей", async () => {
    const withUser = (id, release) => report({ actor: { id, kind: "intern" }, release });
    await trackAndFlush(withUser("u1", "sha-a"), withUser("u2", "sha-a"), withUser("u1", "sha-b"));

    const issue = await ErrorIssue.findOne().lean();
    expect(issue.affectedUsers.sort()).toEqual(["u1", "u2"]);
    expect(issue.releases.sort()).toEqual(["sha-a", "sha-b"]);
  });

  test("выборка задетых ограничена потолком, а не растёт бесконечно", async () => {
    const many = Array.from({ length: errorTracker.AFFECTED_CAP + 25 }, (_, i) =>
      report({ actor: { id: `user-${i}`, kind: "intern" } })
    );
    await trackAndFlush(...many);

    const issue = await ErrorIssue.findOne().lean();
    expect(issue.count).toBe(many.length);
    expect(issue.affectedUsers.length).toBe(errorTracker.AFFECTED_CAP);
  });

  test("sampleMessage обновляется на свежий, normalizedMessage общий", async () => {
    await trackAndFlush(
      report({ message: "Intern 64b7f9a2c1234567890abc01 not found" }),
      report({ message: "Intern 64b7f9a2c1234567890abc02 not found" })
    );
    const issue = await ErrorIssue.findOne().lean();
    expect(issue.count).toBe(2);
    expect(issue.normalizedMessage).toBe("Intern <id> not found");
    expect(issue.sampleMessage).toBe("Intern 64b7f9a2c1234567890abc02 not found");
  });
});

describe("шум не доходит до хранилища", () => {
  test("кадры расширения — ни события, ни issue", async () => {
    await trackAndFlush(report({
      stack: "TypeError: x\n    at inject (chrome-extension://kkk/c.js:1:1)",
    }));
    expect(await ErrorEvent.countDocuments()).toBe(0);
    expect(await ErrorIssue.countDocuments()).toBe(0);
  });

  test("стек без наших кадров — ни события, ни issue", async () => {
    await trackAndFlush(report({
      stack: "TypeError: x\n    at t (https://mc.yandex.ru/metrika/tag.js:1:1)",
    }));
    expect(await ErrorEvent.countDocuments()).toBe(0);
  });

  test("сетевая ошибка — событие есть, issue нет", async () => {
    await trackAndFlush(report({ kind: "api-failure", message: "Failed to fetch", stack: null }));

    const events = await ErrorEvent.find().lean();
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("network");
    expect(await ErrorIssue.countDocuments()).toBe(0);
  });

  test("отброшенное считается — видно, что фильтр работает", async () => {
    const before = errorTracker._dropped();
    errorTracker.track(report({ stack: "x\n    at i (chrome-extension://k/c.js:1:1)" }));
    expect(errorTracker._dropped()["browser-extension"]).toBe(before["browser-extension"] + 1);
  });

  test("ERROR_TRACKING_ENABLED=false выключает запись целиком", async () => {
    process.env.ERROR_TRACKING_ENABLED = "false";
    await trackAndFlush(report());
    expect(await ErrorEvent.countDocuments()).toBe(0);
  });
});

describe("секреты не попадают в хранилище", () => {
  test("context и breadcrumbs прогоняются через редактор", async () => {
    await trackAndFlush(report({
      context: {
        form: { username: "ali", password: "hunter2" },
        session: { accessToken: "eyJhbGciOi", nested: { refreshToken: "rt-secret" } },
      },
      breadcrumbs: [
        { type: "api", url: "/api/interns/login", body: { password: "hunter2" } },
        { type: "click", target: "button" },
      ],
    }));

    const event = await ErrorEvent.findOne().lean();
    expect(event.context.form.password).toBe("[REDACTED]");
    expect(event.context.form.username).toBe("ali");
    expect(event.context.session.accessToken).toBe("[REDACTED]");
    expect(event.context.session.nested.refreshToken).toBe("[REDACTED]");
    expect(event.breadcrumbs[0].body.password).toBe("[REDACTED]");

    const raw = JSON.stringify(event);
    expect(raw).not.toContain("hunter2");
    expect(raw).not.toContain("rt-secret");
    expect(raw).not.toContain("eyJhbGciOi");
  });

  test("огромный context обрезается, форма сохраняется", async () => {
    await trackAndFlush(report({ context: { blob: "x".repeat(50000), page: "lessons" } }));
    const event = await ErrorEvent.findOne().lean();
    expect(event.context._truncated).toBe(true);
    expect(event.context._keys).toEqual(expect.arrayContaining(["blob", "page"]));
  });

  test("breadcrumbs обрезаются по количеству", async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ i }));
    await trackAndFlush(report({ breadcrumbs: many }));
    const event = await ErrorEvent.findOne().lean();
    expect(event.breadcrumbs).toHaveLength(errorTracker.MAX_BREADCRUMBS);
    // Сохраняются ПОСЛЕДНИЕ — они ближе всего к падению.
    expect(event.breadcrumbs[event.breadcrumbs.length - 1].i).toBe(99);
  });
});

describe("трекер не роняет вызывающий код", () => {
  test("track синхронный и не бросает на мусоре", () => {
    expect(() => errorTracker.track(null)).not.toThrow();
    expect(() => errorTracker.track({})).not.toThrow();
    expect(() => errorTracker.track({ app: "interns" })).not.toThrow();
    expect(() => errorTracker.track({ app: "нет-такого", kind: "react-render" })).not.toThrow();
  });

  test("падение записи в Mongo не пробрасывается наружу", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const insert = jest.spyOn(ErrorEvent, "insertMany").mockRejectedValue(new Error("mongo down"));

    errorTracker.track(report());
    await expect(errorTracker.flush()).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith("[errors] insert failed:", "mongo down");

    insert.mockRestore();
    spy.mockRestore();
  });

  test("guardJob ловит падение задачи и пишет cron-failure", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const job = errorTracker.guardJob("daily-notifications", async () => {
      throw new Error("mentor lookup failed");
    });

    await expect(job()).resolves.toBeUndefined(); // не бросает — cron не падает
    await errorTracker.flush();

    const event = await ErrorEvent.findOne({ kind: "cron-failure" }).lean();
    expect(event).toBeTruthy();
    expect(event.message).toContain("[daily-notifications]");
    expect(event.context.job).toBe("daily-notifications");
    spy.mockRestore();
  });

  test("guardJob возвращает результат успешной задачи", async () => {
    const job = errorTracker.guardJob("ok-job", async () => 42);
    expect(await job()).toBe(42);
  });
});

describe("фатальные обработчики", () => {
  test("uncaughtException пишет событие ДО выхода и выходит с кодом 1", async () => {
    const exit = jest.fn();
    const log = jest.fn();
    const handler = createFatalHandler("uncaught-exception", { exit, log });

    await handler(new Error("всё сломалось"));

    const event = await ErrorEvent.findOne({ kind: "uncaught-exception" }).lean();
    expect(event).toBeTruthy();
    expect(event.app).toBe("server");
    expect(event.message).toBe("всё сломалось");
    expect(event.stack).toContain("Error: всё сломалось");
    expect(exit).toHaveBeenCalledWith(1);
    // Порядок важен: сначала запись, потом выход.
    expect(exit.mock.invocationCallOrder[0]).toBeGreaterThan(0);
  });

  test("unhandledRejection с не-Error значением тоже пишется", async () => {
    const exit = jest.fn();
    const handler = createFatalHandler("unhandled-rejection", { exit, log: jest.fn() });

    await handler("строка вместо ошибки");

    const event = await ErrorEvent.findOne({ kind: "unhandled-rejection" }).lean();
    expect(event.message).toBe("строка вместо ошибки");
    expect(exit).toHaveBeenCalledWith(1);
  });

  test("зависшая запись не мешает процессу выйти", async () => {
    const exit = jest.fn();
    const insert = jest
      .spyOn(ErrorEvent, "insertMany")
      .mockImplementation(() => new Promise(() => {})); // висит вечно

    const handler = createFatalHandler("uncaught-exception", {
      exit, log: jest.fn(), timeoutMs: 100,
    });
    await handler(new Error("boom"));

    expect(exit).toHaveBeenCalledWith(1);
    insert.mockRestore();
  });
});

describe("алерты в Telegram", () => {
  beforeEach(() => {
    process.env.ERROR_ALERTS_ENABLED = "true";
    process.env.ERROR_ALERT_CHAT_IDS = "111,222";
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
  });

  test("новый issue уходит в чат", async () => {
    await trackAndFlush(report());
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const [ids, text] = mockSendMessage.mock.calls[0];
    expect(ids).toEqual(["111", "222"]);
    expect(text).toContain("Новая ошибка");
    expect(text).toContain("interns");
  });

  test("повтор той же ошибки чат не заливает", async () => {
    await trackAndFlush(report());
    mockSendMessage.mockClear();
    for (let i = 0; i < 8; i += 1) await trackAndFlush(report());
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  test("всплеск частоты пробивает кулдаун по порогу", async () => {
    process.env.ERROR_ALERT_COOLDOWN_MIN = "0";
    await trackAndFlush(report());
    mockSendMessage.mockClear();
    // Перешагиваем порог 10.
    await trackAndFlush(...Array.from({ length: 12 }, () => report()));
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0][1]).toContain("участилась");
    delete process.env.ERROR_ALERT_COOLDOWN_MIN;
  });

  test("часовой потолок ограничивает веерное падение", async () => {
    process.env.ERROR_ALERT_MAX_PER_HOUR = "3";
    // 6 разных issue — уведомлений должно уйти не больше трёх.
    await trackAndFlush(
      ...Array.from({ length: 6 }, (_, i) => report({ stack: ownStack(`Card${i}`) }))
    );
    expect(mockSendMessage.mock.calls.length).toBeLessThanOrEqual(3);
    delete process.env.ERROR_ALERT_MAX_PER_HOUR;
  });

  test("закрытая ошибка вернулась — issue переоткрывается и алерт уходит", async () => {
    // Без этого "resolved" работает как ловушка: алерты закрытые issue глушат,
    // и регресс молча копил бы счётчик, о котором никто не узнает.
    await trackAndFlush(report());
    await ErrorIssue.updateOne({}, { $set: { status: "resolved", resolvedAt: new Date() } });
    mockSendMessage.mockClear();

    await trackAndFlush(report());

    const issue = await ErrorIssue.findOne().lean();
    expect(issue.status).toBe("new");
    expect(issue.regressedAt).toBeTruthy();
    expect(issue.resolvedAt).toBeNull();
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0][1]).toContain("вернулась");
  });

  test("регресс пробивает кулдаун от прошлой жизни issue", async () => {
    await trackAndFlush(report());
    await ErrorIssue.updateOne({}, {
      $set: { status: "resolved", lastAlertAt: new Date(), lastAlertCount: 1 },
    });
    mockSendMessage.mockClear();

    await trackAndFlush(report());
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  test("заигноренный НЕ переоткрывается — в том и смысл игнора", async () => {
    await trackAndFlush(report());
    await ErrorIssue.updateOne({}, { $set: { status: "ignored" } });
    mockSendMessage.mockClear();

    await trackAndFlush(report(), report());

    const issue = await ErrorIssue.findOne().lean();
    expect(issue.status).toBe("ignored");
    expect(issue.count).toBe(3); // счётчик всё равно растёт
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  test("заигноренный issue молчит", async () => {
    await trackAndFlush(report());
    await ErrorIssue.updateOne({}, { $set: { status: "ignored" } });
    mockSendMessage.mockClear();
    await trackAndFlush(...Array.from({ length: 30 }, () => report()));
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  test("падение Telegram не ломает запись ошибки", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockSendMessage.mockRejectedValueOnce(new Error("telegram down"));

    await trackAndFlush(report());

    expect(await ErrorEvent.countDocuments()).toBe(1);
    expect(await ErrorIssue.countDocuments()).toBe(1);
    spy.mockRestore();
  });

  test("без списка чатов молчим, но пишем", async () => {
    delete process.env.ERROR_ALERT_CHAT_IDS;
    await trackAndFlush(report());
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(await ErrorIssue.countDocuments()).toBe(1);
  });
});

describe("errorController: 5xx пишем, 4xx нет", () => {
  // 4xx — это в основном штатная работа приложения (не нашёл, не авторизован,
  // не прошёл валидацию). Они уже лежат в аудит-логе; заводить по ним issue
  // значит утопить разбор в шуме. 5xx — всегда наша вина.
  const express = require("express");
  const AppError = require("../src/utils/AppError");
  const globalErrorHandler = require("../src/controllers/errorController");

  let srv;
  let base;

  beforeAll(async () => {
    const app = express();
    app.get("/api/boom", () => { throw new Error("внезапно всё сломалось"); });
    app.get("/api/unavailable", (req, res, next) => next(new AppError("Сервис недоступен", 503)));
    app.get("/api/missing/:id", (req, res, next) => next(new AppError("Не найдено", 404)));
    app.get("/api/forbidden", (req, res, next) => next(new AppError("Нет доступа", 403)));
    app.use(globalErrorHandler);
    srv = app.listen(0);
    await new Promise((r) => srv.once("listening", r));
    base = `http://127.0.0.1:${srv.address().port}`;
  });

  afterAll(async () => { await new Promise((r) => srv.close(r)); });

  const hit = async (path) => {
    const res = await fetch(base + path);
    await res.text();
    await errorTracker.flush();
    return res;
  };

  test("необработанное исключение в роуте → событие http-5xx", async () => {
    const res = await hit("/api/boom");
    expect(res.status).toBe(500);

    const event = await ErrorEvent.findOne({ kind: "http-5xx" }).lean();
    expect(event).toBeTruthy();
    expect(event.app).toBe("server");
    expect(event.message).toBe("внезапно всё сломалось");
    expect(event.routePattern).toBe("/api/boom");
    expect(event.context.statusCode).toBe(500);
    expect(await ErrorIssue.countDocuments()).toBe(1);
  });

  test("операционная 5xx (503) тоже пишется — о ней надо знать", async () => {
    await hit("/api/unavailable");
    const event = await ErrorEvent.findOne({ kind: "http-5xx" }).lean();
    expect(event.message).toBe("Сервис недоступен");
  });

  test("404 и 403 не пишутся вообще", async () => {
    await hit("/api/missing/64b7f9a2c1234567890abcde");
    await hit("/api/forbidden");
    expect(await ErrorEvent.countDocuments()).toBe(0);
    expect(await ErrorIssue.countDocuments()).toBe(0);
  });

  test("одинаковые 5xx с разных id группируются в один issue", async () => {
    await hit("/api/boom");
    await hit("/api/boom");
    const issues = await ErrorIssue.find().lean();
    expect(issues).toHaveLength(1);
    expect(issues[0].count).toBe(2);
  });
});
