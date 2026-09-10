const errorTracker = require("../services/errorTracker");
const auditLogMw = require("../middleware/auditLog");

/**
 * Обработчики падений вне HTTP-запроса.
 *
 * До их появления uncaughtException и unhandledRejection не логировались
 * нигде: аудит-лог их не видит (они вне запроса), Railway молча перезапускал
 * процесс, причина оставалась только в эфемерном stdout.
 *
 * Вынесено из index.js отдельным модулем, чтобы это можно было протестировать:
 * требовать index.js в тестах нельзя, он поднимает сервер и коннектится к БД.
 *
 * Процесс обязан завершиться. После uncaughtException состояние приложения не
 * определено — продолжать работу нельзя, это худший вариант, чем перезапуск.
 * Код 1, чтобы платформа подняла заново.
 */
const createFatalHandler = (kind, deps = {}) => {
  const exit = deps.exit || ((code) => process.exit(code));
  const log = deps.log || console.error;
  const timeoutMs = deps.timeoutMs != null ? deps.timeoutMs : 3000;

  return async (err) => {
    const error = err instanceof Error ? err : new Error(String(err));
    log(`💥 ${kind}:`, error);

    try {
      // trackNow ограничен таймаутом внутри: зависшая Mongo не должна
      // превратить падение в вечно висящий процесс.
      await errorTracker.trackNow(
        {
          app: "server",
          kind,
          message: error.message,
          stack: error.stack,
        },
        timeoutMs
      );
      // Аудит-лог сбрасываем тоже — в его буфере лежат последние запросы,
      // то есть ровно то, что привело к падению.
      await auditLogMw.flush();
    } catch (e) {
      log("[fatal] не удалось записать событие:", e.message);
    }

    exit(1);
  };
};

const installFatalHandlers = (deps = {}) => {
  process.on("uncaughtException", createFatalHandler("uncaught-exception", deps));
  process.on("unhandledRejection", createFatalHandler("unhandled-rejection", deps));
};

module.exports = { createFatalHandler, installFatalHandlers };
