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
}).unknown(true);

const { error: envError } = envSchema.validate(process.env);
if (envError) {
  console.error("❌ Invalid environment variables:", envError.message);
  process.exit(1);
}

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoSanitize = require("express-mongo-sanitize");
const xss = require("xss-clean");
const cronService = require("./services/cronService");

// Init Cron Jobs
cronService.init();

const app = express();
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
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "https://mentors-rho.vercel.app",
  "https://interns-lovat.vercel.app",
  "https://internship-admin-zeta.vercel.app",
  "https://www.interns-mars.uz",
  "https://interns-mars.uz",
  "https://mentors-mars.uz",
  "https://interns-admin.uz",
  "https://www.interns-admin.uz",
];
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim())
  : defaultOrigins;

app.use(cors({ origin: allowedOrigins }));

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10kb" }));

// ─── NoSQL injection + XSS sanitization ──────────────────────────────────────
app.use(mongoSanitize());
app.use(xss());

// ─── Rate limiting ─────────────────────────────────────────────────────────────
// General: 100 req/min per IP
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много запросов. Попробуйте через минуту." },
});

// Auth: 5 attempts per 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много попыток входа. Попробуйте через 15 минут." },
  skipSuccessfulRequests: true,
});

app.use("/api", generalLimiter);
app.use("/api/interns/login", authLimiter);
app.use("/api/mentors/login", authLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/interns", internRoutes);
app.use("/api/mentors", mentorRoutes);
app.use("/api/branches", branchRoutes);
app.use("/api/lessons", lessonsRoutes);
app.use("/api/rules", rulesRoutes);
app.use("/api/violations", require("./routes/violationRoutes"));
app.use("/api/notifications", notificationRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/uploads", require("./routes/uploadRoutes"));

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.all(/(.*)/, (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

app.use(globalErrorHandler);

connectDB();

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port} [${process.env.NODE_ENV}]`);
});
