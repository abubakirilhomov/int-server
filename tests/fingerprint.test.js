// Группировка ошибок. Если этот файл врёт, врёт вся система: слишком грубо —
// разные баги слипнутся в один issue и Hermes починит не то; слишком тонко —
// один баг размажется на тысячу issue и утонет.
const {
  normalizeMessage,
  parseStack,
  classifyFrame,
  computeFingerprint,
  classifyReport,
  isNetworkError,
} = require("../src/utils/fingerprint");

const ORIGIN = "https://interns-mars.uz";
const PAGE = `${ORIGIN}/lessons`;

// Стек нашего бандла: hash в имени файла и номера строк меняются на каждом деплое.
const bundleStack = (hash, line) =>
  [
    "TypeError: Cannot read properties of undefined (reading 'name')",
    `    at LessonCard (${ORIGIN}/assets/index-${hash}.js:${line}:1234)`,
    `    at renderWithHooks (${ORIGIN}/assets/vendor-${hash}.js:12:99)`,
  ].join("\n");

const serverStack = [
  "TypeError: Cannot read properties of null (reading 'branch')",
  "    at getInternPlanStatus (/app/src/utils/internPlanStatus.js:42:18)",
  "    at async loginIntern (/app/src/controllers/internController.js:71:26)",
  "    at async /app/node_modules/express/lib/router/index.js:280:10",
].join("\n");

const report = (over = {}) => ({
  app: "interns",
  kind: "react-render",
  message: "Cannot read properties of undefined (reading 'name')",
  stack: bundleStack("DsvmxSug", 48),
  url: PAGE,
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
describe("normalizeMessage", () => {
  test("схлопывает ObjectId, uuid, числа, url, даты и email", () => {
    expect(normalizeMessage("Intern 64b7f9a2c1234567890abcde not found")).toBe(
      "Intern <id> not found"
    );
    expect(normalizeMessage("job 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed")).toBe(
      "job <uuid> failed"
    );
    expect(normalizeMessage("Request to https://api.x.com/v2/users?id=7 failed")).toBe(
      "Request to <url> failed"
    );
    expect(normalizeMessage("expected 5 got 12")).toBe("expected <n> got <n>");
    expect(normalizeMessage("since 2026-09-04T10:00:00Z")).toBe("since <date>");
    expect(normalizeMessage("user ali@mars.uz blocked")).toBe("user <email> blocked");
  });

  test("сохраняет имя свойства — оно и есть суть ошибки", () => {
    expect(normalizeMessage("Cannot read properties of undefined (reading 'name')"))
      .toBe("Cannot read properties of undefined (reading 'name')");
  });

  test("не падает на пустом и нестроковом", () => {
    expect(normalizeMessage(null)).toBe("");
    expect(normalizeMessage(undefined)).toBe("");
    expect(normalizeMessage({ a: 1 })).toBe("[object Object]");
  });
});

describe("parseStack", () => {
  test("формат V8: 'at fn (loc)' и 'at loc'", () => {
    const f = parseStack(serverStack);
    expect(f).toHaveLength(3);
    expect(f[0]).toMatchObject({ fn: "getInternPlanStatus" });
    expect(f[1].fn).toBe("loginIntern"); // 'async' отброшен
    expect(f[2].fn).toBeNull();          // кадр без имени функции
  });

  test("формат Firefox/Safari: 'fn@loc'", () => {
    const f = parseStack("LessonCard@https://x.uz/assets/index.js:1:2\n@https://x.uz/a.js:3:4");
    expect(f[0].fn).toBe("LessonCard");
    expect(f[1].fn).toBeNull();
  });

  test("строка 'Error: message' кадром не считается", () => {
    expect(parseStack("Error: boom")).toHaveLength(0);
  });

  test("пустой и отсутствующий стек", () => {
    expect(parseStack(null)).toEqual([]);
    expect(parseStack("")).toEqual([]);
    expect(parseStack(undefined)).toEqual([]);
  });
});

describe("classifyFrame", () => {
  const f = (loc) => ({ loc, fn: "x" });

  test("расширения браузера", () => {
    expect(classifyFrame(f("chrome-extension://abc/inject.js:1:1"))).toBe("extension");
    expect(classifyFrame(f("moz-extension://abc/inject.js:1:1"))).toBe("extension");
    expect(classifyFrame(f("safari-extension://abc/x.js:1:1"))).toBe("extension");
  });

  test("node_modules и внутренности ноды — vendor", () => {
    expect(classifyFrame(f("/app/node_modules/express/lib/router.js:1:1"))).toBe("vendor");
    expect(classifyFrame(f("node:internal/process/task_queues:95:5"))).toBe("vendor");
  });

  test("чужой origin — vendor, свой — own", () => {
    expect(classifyFrame(f("https://mc.yandex.ru/metrika/tag.js:1:1"), ORIGIN)).toBe("vendor");
    expect(classifyFrame(f("https://evil.example/x.js:1:1"), ORIGIN)).toBe("vendor");
    expect(classifyFrame(f(`${ORIGIN}/assets/index-Abc.js:1:1`), ORIGIN)).toBe("own");
  });

  test("native и <anonymous>", () => {
    expect(classifyFrame(f("[native code]"))).toBe("native");
    expect(classifyFrame(f("<anonymous>"))).toBe("native");
  });

  test("серверный путь нашего кода — own", () => {
    expect(classifyFrame(f("/app/src/controllers/internController.js:71:26"))).toBe("own");
  });
});

describe("fingerprint группирует одинаковое", () => {
  test("переживает деплой: другой hash сборки и другие номера строк", () => {
    const a = computeFingerprint(report({ stack: bundleStack("DsvmxSug", 48) }));
    const b = computeFingerprint(report({ stack: bundleStack("ZZZZZZZZ", 991) }));
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.topFrames[0]).toBe("LessonCard@assets/index.js");
  });

  test("конкретные id в тексте не разводят одну ошибку по разным issue", () => {
    const a = computeFingerprint(report({ message: "Intern 64b7f9a2c1234567890abc01 not found" }));
    const b = computeFingerprint(report({ message: "Intern 64b7f9a2c1234567890abc02 not found" }));
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  test("серверный стек: абсолютный путь схлопывается до src/", () => {
    const fp = computeFingerprint({
      app: "server", kind: "http-5xx",
      message: "Cannot read properties of null (reading 'branch')",
      stack: serverStack,
    });
    expect(fp.topFrames).toEqual([
      "getInternPlanStatus@src/utils/internPlanStatus.js",
      "loginIntern@src/controllers/internController.js",
    ]);
    // Кадр из node_modules в ключ не попал.
    expect(fp.topFrames.join()).not.toContain("express");
  });
});

describe("fingerprint разделяет разное", () => {
  const base = computeFingerprint(report());

  test("другое место в коде", () => {
    const other = computeFingerprint(
      report({ stack: bundleStack("DsvmxSug", 48).replace("LessonCard", "ProfileCard") })
    );
    expect(other.fingerprint).not.toBe(base.fingerprint);
  });

  test("другое сообщение", () => {
    expect(computeFingerprint(report({ message: "x is not a function" })).fingerprint)
      .not.toBe(base.fingerprint);
  });

  test("другое приложение", () => {
    expect(computeFingerprint(report({ app: "mentors" })).fingerprint)
      .not.toBe(base.fingerprint);
  });

  test("другой kind", () => {
    expect(computeFingerprint(report({ kind: "window-error" })).fingerprint)
      .not.toBe(base.fingerprint);
  });

  test("берётся не больше трёх верхних кадров", () => {
    const deep = [
      "Error: boom",
      ...Array.from({ length: 8 }, (_, i) => `    at fn${i} (/app/src/a${i}.js:1:1)`),
    ].join("\n");
    const fp = computeFingerprint({ app: "server", kind: "http-5xx", message: "boom", stack: deep });
    expect(fp.topFrames).toHaveLength(3);
    expect(fp.topFrames[0]).toBe("fn0@src/a0.js");
  });
});

describe("шумовые фильтры", () => {
  test("стек без наших кадров — drop", () => {
    const v = classifyReport(report({
      stack: [
        "TypeError: x",
        "    at t (https://mc.yandex.ru/metrika/tag.js:1:1)",
        "    at n (https://connect.facebook.net/sdk.js:2:2)",
      ].join("\n"),
    }));
    expect(v.decision).toBe("drop");
    expect(v.reason).toBe("no-own-frames");
    expect(v.hasOwnFrames).toBe(false);
  });

  test("стека нет вообще — drop ('Script error.' из cross-origin)", () => {
    const v = classifyReport(report({ message: "Script error.", stack: null }));
    expect(v.decision).toBe("drop");
    expect(v.reason).toBe("no-own-frames");
  });

  test("расширение браузера — drop, даже если есть наш кадр", () => {
    const v = classifyReport(report({
      stack: [
        "TypeError: x",
        "    at inject (chrome-extension://kkk/content.js:1:1)",
        `    at LessonCard (${ORIGIN}/assets/index-Abc.js:1:1)`,
      ].join("\n"),
    }));
    expect(v.decision).toBe("drop");
    expect(v.reason).toBe("browser-extension");
  });

  test("сетевая ошибка на клиенте — событие без issue", () => {
    for (const msg of ["Failed to fetch", "NetworkError when attempting to fetch resource", "Load failed"]) {
      const v = classifyReport(report({ kind: "api-failure", message: msg, stack: null }));
      expect(v.decision).toBe("event-only");
      expect(v.reason).toBe("network");
      expect(v.kind).toBe("network");
    }
  });

  test("сетевая ошибка НА СЕРВЕРЕ — полноценный issue", () => {
    // ECONNREFUSED к Mongo это не «метрика доступности клиента», а ровно то,
    // о чём надо кричать.
    const v = classifyReport({
      app: "server", kind: "uncaught-exception",
      message: "connect ECONNREFUSED 127.0.0.1:27017",
      stack: "Error\n    at connect (/app/src/config/database.js:8:5)",
    });
    expect(isNetworkError({ app: "server", message: "connect ECONNREFUSED" })).toBe(false);
    expect(v.decision).toBe("full");
  });

  test("нормальная ошибка проходит целиком", () => {
    const v = classifyReport(report());
    expect(v.decision).toBe("full");
    expect(v.reason).toBeNull();
    expect(v.hasOwnFrames).toBe(true);
  });
});
