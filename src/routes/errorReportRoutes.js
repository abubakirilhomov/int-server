const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const errorReportCtrl = require("../controllers/errorReportController");

/**
 * Приём отчётов об ошибках с трёх фронтендов.
 *
 * Эндпоинт неавторизованный (падение бывает до логина), поэтому все защиты —
 * здесь:
 *
 *  • СВОЙ rate-limiter, а не общий. Это главный риск эндпоинта: на `/api`
 *    висит 100 req/min на IP, и крэш-луп в браузере одного пользователя,
 *    отправляя отчёты, сожрал бы его же лимит и сломал бы ему приложение.
 *    Роутер монтируется в index.js ДО общего лимитера — иначе отдельный
 *    лимит не имеет смысла, оба всё равно считали бы одни и те же запросы.
 *
 *  • Свой парсер тела с увеличенным потолком: глобальный стоит на 10 КБ, а
 *    стек с breadcrumbs в него не влезает. Больше 10 КБ здесь нужно, но
 *    неограниченно — нельзя, отсюда ERROR_INGEST_MAX_BODY.
 *
 *  • sanitizeBody здесь НЕ нужен, и это осознанно. Он вырезает mongo-операторы,
 *    опасные в ЗАПРОСЕ; тело отчёта только сохраняется (context/breadcrumbs как
 *    Mixed) и в запрос не попадает никогда: fingerprint мы считаем сами (sha1),
 *    `app` сверяем с перечнем. Инъектировать через это нечего.
 */
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.ERROR_INGEST_RATE_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  // Отлуп отдаём тихо: клиентский репортер на 429 просто замолкает, ему не
  // нужно сообщение, а лишний трафик в крэш-лупе вреден.
  message: { accepted: 0, dropped: 0, throttled: true },
});

const bodyLimit = process.env.ERROR_INGEST_MAX_BODY || "64kb";

router.post(
  "/",
  limiter,
  express.json({ limit: bodyLimit }),
  // navigator.sendBeacon не умеет ставить заголовки: с application/json он
  // упирается в preflight, которого не переживает, поэтому шлёт text/plain.
  // Без этой строки beacon-путь молча не доставляет — а это единственный путь
  // в браузерах без fetch(keepalive) и при закрытии вкладки.
  express.text({ type: "text/plain", limit: bodyLimit }),
  (req, res, next) => {
    if (typeof req.body === "string") {
      try {
        req.body = JSON.parse(req.body);
      } catch {
        return res.status(400).json({ error: "INVALID_JSON" });
      }
    }
    next();
  },
  errorReportCtrl.ingest
);

module.exports = router;
