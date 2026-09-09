const mongoose = require("mongoose");
const AuditLog = require("../models/auditLogModel");

/**
 * Аудит-лог: пишет по записи на каждый запрос к /api.
 *
 * Три жёстких правила, из которых следует вся реализация ниже:
 *
 *  1. Аудит НИКОГДА не ломает запрос. Вся работа — внутри try/catch, ничего
 *     не await-ится в цепочке обработки, запись идёт после res 'finish'.
 *     Упавшая запись = строчка в консоли, и только.
 *
 *  2. Секреты в лог не попадают. Пароли/токены вырезаются рекурсивно перед
 *     записью — иначе журнал становится дампом учёток, что хуже его отсутствия.
 *
 *  3. Не съедает диск и не топит Mongo. TTL на модели + буфер в памяти,
 *     который сливается пачкой (insertMany) раз в AUDIT_FLUSH_MS.
 */

// ─── Конфиг (читается лениво: AUDIT_ENABLED можно дёрнуть без выката кода) ────
const isEnabled = () => process.env.AUDIT_ENABLED !== "false";
const flushMs = () => Number(process.env.AUDIT_FLUSH_MS) || 2000;
const maxBodyBytes = () => Number(process.env.AUDIT_MAX_BODY_BYTES) || 4096;
// Жёсткий потолок буфера: при всплеске сливаем не дожидаясь таймера,
// чтобы память не росла неограниченно, если Mongo тормозит.
const MAX_BUFFER = 500;

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// ─── Редактирование секретов и нормализация пути ─────────────────────────────
// Живут в utils/redact.js — их же использует трекер ошибок, и расходиться
// этим двум реализациям нельзя.
const {
  redact,
  redactAndCap: capTo,
  normalizePath,
} = require("../utils/redact");

const redactAndCap = (body) => capTo(body, maxBodyBytes());

/**
 * К моменту 'finish' роут уже отработал, поэтому req.route заполнен.
 * У catch-all 404 в index.js path — RegExp, от него толку нет: уходим в fallback.
 */
const resolveRoutePattern = (req) => {
  const routePath = req.route && req.route.path;
  if (typeof routePath === "string") {
    const joined = `${req.baseUrl || ""}${routePath}`.replace(/\/+$/, "") || "/";
    return normalizePath(joined);
  }
  return normalizePath((req.originalUrl || "").split("?")[0]);
};

// ─── Актор ───────────────────────────────────────────────────────────────────
// Чем пользователь представился на неудачном логине. Пароль — никогда.
const IDENTIFIER_FIELDS = ["username", "login", "email", "phone", "phoneNumber"];

const anonymousIdentifier = (body) => {
  if (!body || typeof body !== "object") return null;
  for (const f of IDENTIFIER_FIELDS) {
    if (typeof body[f] === "string" && body[f].trim()) return body[f].trim().slice(0, 120);
  }
  // Менторы логинятся парой name + lastName.
  if (typeof body.name === "string" && body.name.trim()) {
    return `${body.name} ${body.lastName || ""}`.trim().slice(0, 120);
  }
  return null;
};

const buildActor = (req) => {
  const u = req.user;
  if (!u || !u.id) {
    return {
      id: null,
      kind: "anonymous",
      role: null,
      isAdmin: false,
      name: null,
      identifier: anonymousIdentifier(req.body),
    };
  }
  const name = [u.name, u.lastName].filter(Boolean).join(" ").trim() || null;
  return {
    id: String(u.id),
    kind: u.role === "intern" ? "intern" : "mentor",
    role: u.role || null,
    isAdmin: u.isAdmin === true || u.role === "admin",
    name,
    identifier: null,
  };
};

// ─── Ресурс ──────────────────────────────────────────────────────────────────
// Тип берём из первого сегмента после /api: /api/interns/:id → "interns".
const buildResource = (req, routePattern) => {
  const parts = String(routePattern || "").split("/").filter(Boolean);
  const type = parts[0] === "api" ? parts[1] || null : parts[0] || null;
  const p = req.params || {};
  const id = p.id || p.internId || p.mentorId || p.lessonId || p.branchId || null;
  return { type: type || null, id: id ? String(id) : null };
};

const toObjectId = (v) =>
  v && mongoose.isValidObjectId(String(v)) ? new mongoose.Types.ObjectId(String(v)) : null;

// ─── Буферизованная запись ───────────────────────────────────────────────────
// Отдельный insertOne на каждый запрос — это удвоение числа round-trip'ов
// в Mongo под пиком. Пачка в 2 секунды стоит нам потери максимум последних
// 2 секунд журнала при жёстком падении процесса — приемлемая цена.
let buffer = [];
let timer = null;

const flush = async () => {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  try {
    // ordered: false — одна кривая запись не должна отменять остальную пачку.
    await AuditLog.insertMany(batch, { ordered: false });
  } catch (err) {
    console.error("[audit] flush failed:", err.message);
  }
};

const scheduleFlush = () => {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flush();
  }, flushMs());
  // unref: пустой буфер-таймер не должен держать процесс (и jest) живым.
  if (typeof timer.unref === "function") timer.unref();
};

const enqueue = (doc) => {
  buffer.push(doc);
  if (buffer.length >= MAX_BUFFER) flush();
  else scheduleFlush();
};

// Слив на выключение: без него последняя пачка (в т.ч. события,
// приведшие к перезапуску) теряется. В тестах не вешаем — незачем.
if (process.env.NODE_ENV !== "test") {
  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.once(sig, async () => {
      await flush();
      process.exit(0);
    });
  }
  process.on("beforeExit", () => {
    if (buffer.length) flush();
  });
}

// ─── Middleware ──────────────────────────────────────────────────────────────
// Сам себя в журнал не пишем. /api/error-reports сюда и так не доходит (он
// смонтирован в index.js выше по стеку), но если порядок монтирования однажды
// поменяют, крэш-луп не должен утопить аудит-лог.
const SKIP_PREFIXES = ["/api/audit-logs", "/api/error-reports"];

module.exports = function auditLog(req, res, next) {
  try {
    if (!isEnabled()) return next();
    // Preflight — шум без информации.
    if (req.method === "OPTIONS") return next();

    const url = req.originalUrl || req.url || "";
    if (SKIP_PREFIXES.some((p) => url.startsWith(p))) return next();

    const startedAt = process.hrtime.bigint();
    // Тело снимаем СЕЙЧАС: контроллеры (и sanitizeBody выше по стеку)
    // спокойно мутируют req.body, к 'finish' там может быть уже не то.
    const capturedBody = MUTATING.has(req.method) ? redactAndCap(req.body) : null;
    const loginBody = req.body;

    // Текст ошибки достаём из тела ответа — иного места к 'finish' нет.
    // Патчим только json (все ответы API идут через него) и только читаем.
    let errorMessage = null;
    const originalJson = res.json.bind(res);
    res.json = function auditJsonSpy(payload) {
      try {
        if (res.statusCode >= 400 && payload && typeof payload === "object") {
          const m = payload.message || payload.error;
          if (typeof m === "string") errorMessage = m.slice(0, 500);
        }
      } catch {
        /* аудит не имеет права мешать ответу */
      }
      return originalJson(payload);
    };

    res.on("finish", () => {
      try {
        if (!isEnabled()) return;

        const routePattern = resolveRoutePattern(req);
        const actor = buildActor({ user: req.user, body: loginBody });
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

        enqueue({
          actor,
          method: req.method,
          path: url.split("?")[0],
          routePattern,
          statusCode: res.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
          branchId:
            toObjectId(req.user && (req.user.activeBranchId || req.user.branchId)) || null,
          ip: req.ip || (req.socket && req.socket.remoteAddress) || null,
          userAgent: (req.headers && req.headers["user-agent"]) || null,
          query: req.query && Object.keys(req.query).length ? redact(req.query) : null,
          params: req.params && Object.keys(req.params).length ? redact(req.params) : null,
          body: capturedBody,
          resource: buildResource(req, routePattern),
          error: res.statusCode >= 400 ? errorMessage : null,
          createdAt: new Date(),
        });
      } catch (err) {
        console.error("[audit] failed to record request:", err.message);
      }
    });
  } catch (err) {
    console.error("[audit] middleware error:", err.message);
  }
  return next();
};

// Экспорт для тестов и для graceful shutdown.
module.exports.redact = redact;
module.exports.redactAndCap = redactAndCap;
module.exports.normalizePath = normalizePath;
module.exports.resolveRoutePattern = resolveRoutePattern;
module.exports.flush = flush;
module.exports._bufferSize = () => buffer.length;
