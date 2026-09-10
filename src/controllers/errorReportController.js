const jwt = require("jsonwebtoken");
const errorTracker = require("../services/errorTracker");
// Константы, а не модель: ingest не должен тянуть mongoose ради двух массивов.
const { APPS, KINDS } = require("../utils/errorKinds");

const maxBatch = () => Number(process.env.ERROR_INGEST_MAX_BATCH) || 20;

/**
 * Кто прислал отчёт.
 *
 * Эндпоинт неавторизованный — падение бывает и до логина, и после протухания
 * токена. Значит личность клиент заявляет сам, и доверять этому нельзя.
 * Держим то же различие, что в аудит-логе:
 *   name/id   — подтверждено (подпись токена проверена),
 *   identifier — со слов клиента, ничем не подтверждено.
 *
 * Подпись проверяем, но в БД не ходим: это всего лишь подпись на отчёте о
 * падении, а не авторизация. Поэтому `isAdmin` отсюда НЕ берём — claims не
 * источник истины для прав (урок инцидента 2026-08), а для атрибуции он и не нужен.
 */
const resolveActor = (req, item) => {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    try {
      const decoded = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET);
      if (decoded && decoded.typ === "access" && decoded.id) {
        return {
          id: String(decoded.id),
          kind: decoded.kind === "intern" ? "intern" : "mentor",
          role: decoded.role || null,
          isAdmin: false,
          name: null,
          identifier: null,
        };
      }
    } catch {
      // Протухший или битый токен на этом эндпоинте — штатная ситуация,
      // ради неё отчёт не выбрасываем.
    }
  }

  const claimed = item && typeof item.user === "string" ? item.user.trim() : "";
  return {
    id: null,
    kind: "anonymous",
    role: null,
    isAdmin: false,
    name: null,
    identifier: claimed ? claimed.slice(0, 120) : null,
  };
};

// POST /api/error-reports
exports.ingest = (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.events) ? body.events : [body];

  const stats = { accepted: 0, dropped: 0, invalid: 0 };

  for (const item of items.slice(0, maxBatch())) {
    if (!item || typeof item !== "object") {
      stats.invalid += 1;
      continue;
    }
    // Приложение обязано быть известным: неизвестное значение атрибутировать
    // некуда, а enum модели всё равно отвергнет запись.
    if (!APPS.includes(item.app)) {
      stats.invalid += 1;
      continue;
    }
    // Неизвестный kind не выбрасываем: разошедшаяся версия клиента не должна
    // приводить к тихой потере всех отчётов.
    const kind = KINDS.includes(item.kind) ? item.kind : "window-error";

    const verdict = errorTracker.track({
      app: item.app,
      kind,
      message: item.message,
      stack: item.stack,
      componentStack: item.componentStack,
      release: item.release,
      url: item.url,
      breadcrumbs: item.breadcrumbs,
      context: item.context,
      // Наблюдаемое сервером важнее заявленного клиентом.
      userAgent: req.headers["user-agent"],
      ip: req.ip || (req.socket && req.socket.remoteAddress) || null,
      actor: resolveActor(req, item),
    });

    if (!verdict || verdict.decision === "drop") stats.dropped += 1;
    else stats.accepted += 1;
  }

  if (items.length > maxBatch()) stats.dropped += items.length - maxBatch();

  // 202: приняли к обработке. Запись асинхронная (буфер), клиент её не ждёт.
  res.status(202).json(stats);
};
