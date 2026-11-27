// API кандидата живого собеседования. Свой middleware (candidateAuth, свой
// ключ подписи) — общий auth и роли интернов/менторов здесь не участвуют.
// Тело PUT /answers до 200 КБ — парсер подключается в index.js ДО общего 10 КБ.
const express = require("express");
const rateLimit = require("express-rate-limit");
const candidateAuth = require("../middleware/candidateAuth");
const ctrl = require("../controllers/candidateController");

const router = express.Router();

// Вход: 15 неудачных попыток на логин за 15 мин и 30 на IP (офис за одним NAT).
// Основная защита — блокировка доступа после 8 неверных паролей (candidateAccess).
const loginByIp = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { code: "rate_limited", message: "Слишком много попыток входа. Попробуйте через 15 минут." },
});
const loginByUsername = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `u:${String(req.body?.username || "").trim().toUpperCase()}`,
  message: { code: "rate_limited", message: "Слишком много попыток входа. Попробуйте через 15 минут." },
});
// Опрос раз в 2 с + черновики: свой лимит вместо общего 100/мин.
const candidateTraffic = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: "rate_limited", message: "Слишком много запросов" },
});

router.use(candidateTraffic);
router.post("/login", loginByIp, loginByUsername, ctrl.login);

router.use(candidateAuth);
router.get("/session", ctrl.getSession);
router.put("/answers/:position", ctrl.putAnswer);
router.post("/signals", ctrl.postSignal);
router.patch("/language", ctrl.setLanguage);

module.exports = router;
