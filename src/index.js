require("dotenv").config();

// ─── ENV validation ───────────────────────────────────────────────────────────
const Joi = require("joi");
const envSchema = Joi.object({
  MONGO_URI:           Joi.string().required(),
  JWT_SECRET:          Joi.string().min(8).required(),
  JWT_REFRESH_SECRET:  Joi.string().min(8).required(),
  VAPID_PUBLIC_KEY:    Joi.string().required(),
  VAPID_PRIVATE_KEY:   Joi.string().required(),
  PORT:                Joi.number().default(3000),
  NODE_ENV:            Joi.string().valid("development", "production", "test").default("development"),
  CORS_ORIGINS:        Joi.string().optional(), // comma-separated list
  // Mars ID OIDC (optional — feature is gated, disabled when missing)
  MARS_ID_ISSUER:                 Joi.string().uri().optional(),
  MARS_ID_CLIENT_ID:              Joi.string().optional(),
  MARS_ID_CLIENT_SECRET:          Joi.string().optional(),
  MARS_ID_REDIRECT_URI:           Joi.string().uri().optional(),
  MARS_ID_RETURN_URL_MENTORS:     Joi.string().uri().optional(),
  MARS_ID_RETURN_URL_INTERNS:     Joi.string().uri().optional(),
  MARS_ID_RETURN_URL_ADMIN:       Joi.string().uri().optional(),
  // Telegram (used for application notifications). Optional — if absent,
  // notifications log an error on the Application doc but submit still succeeds.
  TELEGRAM_BOT_TOKEN:             Joi.string().optional(),
  // Аудит-лог. Выключается без выката кода (AUDIT_ENABLED=false).
  AUDIT_ENABLED:         Joi.string().valid("true", "false").default("true"),
  AUDIT_RETENTION_DAYS:  Joi.number().integer().min(1).default(180),
  AUDIT_FLUSH_MS:        Joi.number().integer().min(100).default(2000),
  AUDIT_MAX_BODY_BYTES:  Joi.number().integer().min(256).default(4096),
  // Трекер ошибок. Все опциональны — система работает на дефолтах.
  ERROR_TRACKING_ENABLED: Joi.string().valid("true", "false").default("true"),
  ERROR_RETENTION_DAYS:   Joi.number().integer().min(1).default(30),
  ERROR_FLUSH_MS:         Joi.number().integer().min(100).default(2000),
  ERROR_MAX_BODY_BYTES:   Joi.number().integer().min(512).default(16384),
  ERROR_INGEST_MAX_BODY:  Joi.string().default("64kb"),
  ERROR_INGEST_RATE_MAX:  Joi.number().integer().min(1).default(30),
  ERROR_INGEST_MAX_BATCH: Joi.number().integer().min(1).default(20),
  // Уведомления об ошибках в Telegram (переиспользуют TELEGRAM_BOT_TOKEN).
  ERROR_ALERTS_ENABLED:     Joi.string().valid("true", "false").default("true"),
  ERROR_ALERT_CHAT_IDS:     Joi.string().allow("").optional(), // через запятую
  ERROR_ALERT_COOLDOWN_MIN: Joi.number().integer().min(0).default(30), // 0 = без кулдауна
  ERROR_ALERT_MAX_PER_HOUR: Joi.number().integer().min(1).default(20),
}).unknown(true);

const { error: envError } = envSchema.validate(process.env);
if (envError) {
  console.error("❌ Invalid environment variables:", envError.message);
  process.exit(1);
}

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const cronService = require("./services/cronService");

// Init Cron Jobs
cronService.init();

const app = express();
app.set("trust proxy", 1);
const connectDB = require("./config/database");
const internRoutes = require("./routes/internRoutes");
const branchRoutes = require("./routes/branchRoutes");
const mentorRoutes = require("./routes/mentorRoutes");
const lessonsRoutes = require("./routes/lessonRoutes");
const rulesRoutes = require("./routes/rulesRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const AppError = require("./utils/AppError");
const globalErrorHandler = require("./controllers/errorController");
const port = process.env.PORT || 3000;

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS ─────────────────────────────────────────────────────────────────────
const defaultOrigins = [
  "https://mentors-rho.vercel.app",
  "https://interns-lovat.vercel.app",
  "https://internship-admin-zeta.vercel.app",
  "https://www.interns-mars.uz",
  "https://interns-mars.uz",
  "https://mentors-mars.uz",
  "https://interns-admin.uz",
  "https://www.interns-admin.uz",
  "https://internup-zeta.vercel.app",
  "https://internup-mars.uz",
  "https://www.internup-mars.uz",
];
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim())
  : defaultOrigins;

const localhostRe = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (localhostRe.test(origin)) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

// ─── Приём отчётов об ошибках ─────────────────────────────────────────────────
// Смонтирован ДО общего лимитера и ДО глобального парсера тела — намеренно.
// Иначе крэш-луп в браузере съедал бы общий лимит 100 req/min и ломал бы
// пользователю само приложение, а 10-килобайтный потолок резал бы стеки.
// Свои лимитер и парсер — внутри роутера.
app.use("/api/error-reports", require("./routes/errorReportRoutes"));

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());


// ─── Rate limiting ─────────────────────────────────────────────────────────────
// General: 100 req/min per IP
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много запросов. Попробуйте через минуту." },
});

// Auth: 20 attempts per 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много попыток входа. Попробуйте через 15 минут." },
  skipSuccessfulRequests: true,
});

app.use("/api", generalLimiter);
app.use("/api/interns/login", authLimiter);
app.use("/api/mentors/login", authLimiter);

// ─── Audit log ────────────────────────────────────────────────────────────────
// До роутов, но после парсинга тела и rate-limit'а: нужен разобранный req.body,
// а отлупы лимитера (429) — сами по себе сигнал, их логировать полезно.
app.use("/api", require("./middleware/auditLog"));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/interns", internRoutes);
app.use("/api/mentors", mentorRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/lessons", lessonsRoutes);
app.use("/api/rules", rulesRoutes);
app.use("/api/violations", require("./routes/violationRoutes"));
app.use("/api/complaints", require("./routes/complaintRoutes"));
app.use("/api/notifications", notificationRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/uploads", require("./routes/uploadRoutes"));
app.use("/api/locations", require("./routes/locationRoutes"));
app.use("/api/grade-config", require("./routes/gradeConfigRoutes"));
app.use("/api/settings", require("./routes/settingsRoutes"));
app.use("/api/lesson-criteria", require("./routes/lessonCriteriaRoutes"));
app.use("/api/auth/marsid", require("./routes/marsIdAuthRoutes"));
app.use("/api/applications", require("./routes/applicationRoutes"));
app.use("/api/interviews", require("./routes/interviewRoutes"));
app.use("/api/interview-topics", require("./routes/interviewTopicRoutes"));
app.use("/api/intern-requests", require("./routes/internRequestRoutes"));
app.use("/api/badges", require("./routes/badgeRoutes"));
app.use("/api/audit-logs", require("./routes/auditLogRoutes"));
app.use("/api/error-issues", require("./routes/errorIssueRoutes"));

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.all(/(.*)/, (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(globalErrorHandler);

// ─── Падения вне запроса ──────────────────────────────────────────────────────
// Логика в utils/fatalHandler.js — там её можно протестировать, здесь нельзя.
require("./utils/fatalHandler").installFatalHandlers();

connectDB();

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port} [${process.env.NODE_ENV}]`);
});
