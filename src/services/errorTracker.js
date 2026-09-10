const ErrorEvent = require("../models/errorEventModel");
const ErrorIssue = require("../models/errorIssueModel");
const { redact, redactAndCap } = require("../utils/redact");
const { classifyReport } = require("../utils/fingerprint");
const { maybeAlert } = require("./errorAlerts");

/**
 * Трекер ошибок: приём, фильтрация шума, группировка, запись.
 *
 * Те же три правила, что у аудит-лога, и по той же причине:
 *  1. Трекер НИКОГДА не ломает вызывающий код. Всё в try/catch, `track()`
 *     синхронный и не бросает. Упавшая запись = строка в консоли.
 *  2. Секреты не попадают в хранилище — context и breadcrumbs прогоняются
 *     через общий редактор (utils/redact.js).
 *  3. Не топит Mongo: буфер + insertMany, TTL на событиях.
 *
 * Отдельно: трекер не имеет права репортить собственные сбои — это петля.
 */

const isEnabled = () => process.env.ERROR_TRACKING_ENABLED !== "false";
const flushMs = () => Number(process.env.ERROR_FLUSH_MS) || 2000;
const maxContextBytes = () => Number(process.env.ERROR_MAX_BODY_BYTES) || 16384;

const MAX_BUFFER = 200;
const MAX_BREADCRUMBS = 20;
// Выборка задетых пользователей на issue. Полный список у массового бага
// разрастётся на тысячи строк и раздует документ.
const AFFECTED_CAP = 50;

const MAX_MESSAGE = 1000;
const MAX_STACK = 8000;
const MAX_COMPONENT_STACK = 4000;

const str = (v, max) => (v == null ? null : String(v).slice(0, max));

// ─── Нормализация входящего отчёта ───────────────────────────────────────────
const sanitizeBreadcrumbs = (list) => {
  if (!Array.isArray(list)) return [];
  return list.slice(-MAX_BREADCRUMBS).map((b) => redact(b));
};

const buildEvent = (report, verdict) => ({
  fingerprint: verdict.fingerprint,
  app: report.app,
  // classifyReport может переписать kind (сетевые ошибки).
  kind: verdict.kind || report.kind,
  message: str(report.message, MAX_MESSAGE) || "",
  normalizedMessage: verdict.normalizedMessage,
  stack: str(report.stack, MAX_STACK),
  topFrames: verdict.topFrames,
  componentStack: str(report.componentStack, MAX_COMPONENT_STACK),
  release: str(report.release, 100),
  url: str(report.url, 500),
  userAgent: str(report.userAgent, 400),
  actor: report.actor || {},
  breadcrumbs: sanitizeBreadcrumbs(report.breadcrumbs),
  context: redactAndCap(report.context, maxContextBytes()),
  routePattern: str(report.routePattern, 200),
  ip: str(report.ip, 60),
  createdAt: report.createdAt instanceof Date ? report.createdAt : new Date(),
});

// ─── Буфер ───────────────────────────────────────────────────────────────────
let buffer = [];
let timer = null;
// Отброшенное шумовым фильтром — считаем, чтобы было видно в логах, что
// фильтр работает, и чтобы не гадать «почему ошибок нет».
const dropped = { "browser-extension": 0, "no-own-frames": 0, disabled: 0 };

const scheduleFlush = () => {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flush();
  }, flushMs());
  if (typeof timer.unref === "function") timer.unref();
};

/**
 * Обновляет issue по пачке событий одного fingerprint.
 * Возвращает { issue, isNew } либо null, если issue заводить не нужно.
 */
const upsertIssue = async (fingerprint, events) => {
  const last = events[events.length - 1];
  const users = [
    ...new Set(events.map((e) => e.actor && e.actor.id).filter(Boolean)),
  ];
  const releases = [...new Set(events.map((e) => e.release).filter(Boolean))];
  const lastSeen = events.reduce(
    (max, e) => (e.createdAt > max ? e.createdAt : max),
    events[0].createdAt
  );

  const res = await ErrorIssue.findOneAndUpdate(
    { fingerprint },
    {
      $inc: { count: events.length },
      $max: { lastSeen },
      $setOnInsert: {
        fingerprint,
        app: last.app,
        kind: last.kind,
        normalizedMessage: last.normalizedMessage,
        topFrames: last.topFrames,
        firstSeen: events[0].createdAt,
        status: "new",
      },
      // sampleMessage обновляем всегда — свежий текст полезнее первого.
      $set: { sampleMessage: last.message },
      $addToSet: {
        affectedUsers: { $each: users },
        releases: { $each: releases },
      },
    },
    { upsert: true, new: true, includeResultMetadata: true }
  );

  let issue = res.value;
  const isNew = !res.lastErrorObject?.updatedExisting;

  // Регресс: закрытая проблема вернулась.
  //
  // Без этого «resolved» работает как ловушка — errorAlerts глушит закрытые
  // issue, и вернувшаяся ошибка молча копит счётчик, о котором никто не узнает.
  // Переоткрываем и сбрасываем троттлинг, чтобы алерт сработал заново.
  // `ignored` при этом НЕ трогаем: в том и смысл игнора, что он окончательный.
  let regressed = false;
  if (!isNew && issue && issue.status === "resolved") {
    const reopened = await ErrorIssue.findOneAndUpdate(
      { fingerprint, status: "resolved" },
      { $set: { status: "new", regressedAt: new Date(), lastAlertCount: 0, resolvedAt: null } },
      { new: true }
    );
    if (reopened) {
      issue = reopened;
      regressed = true;
    }
  }

  // $addToSet не умеет $slice, поэтому подрезаем отдельным запросом — и только
  // когда выборка реально переросла потолок, то есть редко.
  if (issue && issue.affectedUsers.length > AFFECTED_CAP) {
    await ErrorIssue.updateOne(
      { fingerprint },
      { $push: { affectedUsers: { $each: [], $slice: AFFECTED_CAP } } }
    );
  }

  return { issue, isNew, regressed };
};

const flush = async () => {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (buffer.length === 0) return;

  const batch = buffer;
  buffer = [];

  try {
    await ErrorEvent.insertMany(
      batch.map((b) => b.event),
      { ordered: false }
    );
  } catch (err) {
    console.error("[errors] insert failed:", err.message);
  }

  // Issue заводим только для decision === 'full'. Сетевые события ('event-only')
  // остаются метрикой доступности и в разбор не попадают.
  const groups = new Map();
  for (const { event, decision } of batch) {
    if (decision !== "full") continue;
    if (!groups.has(event.fingerprint)) groups.set(event.fingerprint, []);
    groups.get(event.fingerprint).push(event);
  }

  for (const [fingerprint, events] of groups) {
    try {
      const result = await upsertIssue(fingerprint, events);
      if (result && result.issue) {
        // Регресс сообщаем как новую проблему: она снова требует внимания.
        await maybeAlert(result.issue, result.isNew, { regressed: result.regressed });
      }
    } catch (err) {
      console.error("[errors] issue upsert failed:", err.message);
    }
  }
};

// ─── Публичный вход ──────────────────────────────────────────────────────────
/**
 * Принять отчёт. Синхронный и НЕ бросающий — можно звать откуда угодно,
 * в том числе из обработчика ошибок.
 *
 * Возвращает вердикт фильтра (для тестов и для ответа ingest-эндпоинта),
 * либо null, если трекер выключен или отчёт невалиден.
 */
const track = (report) => {
  try {
    if (!isEnabled()) {
      dropped.disabled += 1;
      return null;
    }
    if (!report || !report.app || !report.kind) return null;

    const verdict = classifyReport(report);

    if (verdict.decision === "drop") {
      dropped[verdict.reason] = (dropped[verdict.reason] || 0) + 1;
      return verdict;
    }

    buffer.push({ event: buildEvent(report, verdict), decision: verdict.decision });
    if (buffer.length >= MAX_BUFFER) flush();
    else scheduleFlush();

    return verdict;
  } catch (err) {
    console.error("[errors] track failed:", err.message);
    return null;
  }
};

/**
 * Записать и дождаться записи. Нужен там, где после вызова процесс умрёт —
 * uncaughtException/unhandledRejection. Таймаут обязателен: если Mongo висит,
 * процесс не должен зависнуть вместе с ней.
 */
const trackNow = async (report, timeoutMs = 3000) => {
  const verdict = track(report);
  let timeoutId;
  const guard = new Promise((r) => {
    timeoutId = setTimeout(r, timeoutMs);
    // Незакрытый таймер держал бы event loop живым после успешной записи.
    if (typeof timeoutId.unref === "function") timeoutId.unref();
  });
  await Promise.race([flush().catch(() => {}), guard]);
  clearTimeout(timeoutId);
  return verdict;
};

/**
 * Обёртка для задач по расписанию. Сейчас падение cron-задачи молча уходит в
 * console и не видно нигде — обёртка превращает его в событие.
 */
const guardJob = (name, fn) => async (...args) => {
  try {
    return await fn(...args);
  } catch (err) {
    console.error(`[cron:${name}] failed:`, err);
    track({
      app: "server",
      kind: "cron-failure",
      message: `[${name}] ${err.message}`,
      stack: err.stack,
      context: { job: name },
    });
    return undefined;
  }
};

if (process.env.NODE_ENV !== "test") {
  process.on("beforeExit", () => {
    if (buffer.length) flush();
  });
}

module.exports = {
  track,
  trackNow,
  flush,
  guardJob,
  _bufferSize: () => buffer.length,
  _dropped: () => ({ ...dropped }),
  AFFECTED_CAP,
  MAX_BREADCRUMBS,
};
