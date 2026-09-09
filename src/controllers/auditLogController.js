const mongoose = require("mongoose");
const AuditLog = require("../models/auditLogModel");
const Mentor = require("../models/mentorModel");
const Intern = require("../models/internModel");
const catchAsync = require("../utils/catchAsync");

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Диапазон статусов: точное число (404) либо класс (2xx/4xx/5xx).
 * Возвращает готовый фрагмент фильтра или null, если значение мусорное.
 */
const statusFilter = (raw) => {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase();
  const cls = v.match(/^([1-5])xx$/);
  if (cls) {
    const base = Number(cls[1]) * 100;
    return { $gte: base, $lt: base + 100 };
  }
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

const parseDate = (raw) => {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

const buildQuery = (q) => {
  const filter = {};

  if (q.actorId) filter["actor.id"] = String(q.actorId);
  if (q.kind) filter["actor.kind"] = String(q.kind);
  if (q.role) filter["actor.role"] = String(q.role);
  if (q.method) filter.method = String(q.method).toUpperCase();
  if (q.routePattern) filter.routePattern = String(q.routePattern);

  const status = statusFilter(q.status);
  if (status !== null) filter.statusCode = status;

  if (q.branchId && mongoose.isValidObjectId(String(q.branchId))) {
    filter.branchId = new mongoose.Types.ObjectId(String(q.branchId));
  }

  // Поиск по конкретному пути — подстрока, экранированная: пользовательский
  // ввод в $regex без экранирования это и падения, и ReDoS.
  if (q.path) filter.path = { $regex: escapeRegex(q.path), $options: "i" };

  const from = parseDate(q.from);
  const to = parseDate(q.to);
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }

  return filter;
};

/**
 * auth.js не грузит имя стажёра, поэтому в записи стоит actor.name: null.
 * Дорезолвим на чтении — одна выборка на страницу (≤200 записей) дешевле,
 * чем лишний запрос в Mongo на каждый записываемый запрос.
 */
const attachActorNames = async (logs) => {
  const missing = { intern: new Set(), mentor: new Set() };
  for (const l of logs) {
    const a = l.actor;
    if (a && a.id && !a.name && missing[a.kind] && mongoose.isValidObjectId(a.id)) {
      missing[a.kind].add(a.id);
    }
  }
  if (!missing.intern.size && !missing.mentor.size) return logs;

  const [interns, mentors] = await Promise.all([
    missing.intern.size
      ? Intern.find({ _id: { $in: [...missing.intern] } }).select("name lastName").lean()
      : [],
    missing.mentor.size
      ? Mentor.find({ _id: { $in: [...missing.mentor] } }).select("name lastName").lean()
      : [],
  ]);

  const names = new Map();
  for (const d of [...interns, ...mentors]) {
    names.set(String(d._id), [d.name, d.lastName].filter(Boolean).join(" ").trim() || null);
  }
  for (const l of logs) {
    if (l.actor && l.actor.id && !l.actor.name) {
      l.actor.name = names.get(l.actor.id) || null;
    }
  }
  return logs;
};

// GET /api/audit-logs
exports.getAuditLogs = catchAsync(async (req, res) => {
  const filter = buildQuery(req.query);

  const limit = Math.min(
    Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

  const [logs, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);

  await attachActorNames(logs);

  res.json({
    data: logs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
      hasMore: page * limit < total,
    },
  });
});

// GET /api/audit-logs/stats
exports.getAuditStats = catchAsync(async (req, res) => {
  const filter = buildQuery(req.query);

  // Без явного периода смотрим последние сутки: полная свёртка по всей
  // коллекции за полгода — это долгий скан на каждое открытие дашборда.
  if (!filter.createdAt) {
    filter.createdAt = { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) };
  }

  // Шаг корзины под длину периода: на суточном окне почасовые точки читаемы,
  // на месячном их 720 — график превращается в шум.
  const spanMs =
    (filter.createdAt.$lte || new Date()).getTime() - filter.createdAt.$gte.getTime();
  const bucketUnit = spanMs > 3 * 24 * 60 * 60 * 1000 ? "day" : "hour";

  const [facet] = await AuditLog.aggregate([
    { $match: filter },
    {
      $facet: {
        // Динамика: сколько запросов и сколько из них ошибок по корзинам.
        timeline: [
          {
            $group: {
              _id: { $dateTrunc: { date: "$createdAt", unit: bucketUnit } },
              total: { $sum: 1 },
              errors: { $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] } },
            },
          },
          { $sort: { _id: 1 } },
        ],
        totals: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              errors: { $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] } },
              clientErrors: {
                $sum: {
                  $cond: [
                    { $and: [{ $gte: ["$statusCode", 400] }, { $lt: ["$statusCode", 500] }] },
                    1,
                    0,
                  ],
                },
              },
              serverErrors: { $sum: { $cond: [{ $gte: ["$statusCode", 500] }, 1, 0] } },
              avgDurationMs: { $avg: "$durationMs" },
            },
          },
        ],
        topActors: [
          { $match: { "actor.id": { $ne: null } } },
          {
            $group: {
              _id: "$actor.id",
              count: { $sum: 1 },
              kind: { $last: "$actor.kind" },
              role: { $last: "$actor.role" },
              name: { $last: "$actor.name" },
              errors: { $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] } },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ],
        topRoutes: [
          {
            $group: {
              _id: { routePattern: "$routePattern", method: "$method" },
              count: { $sum: 1 },
              avgDurationMs: { $avg: "$durationMs" },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ],
        topErrorRoutes: [
          { $match: { statusCode: { $gte: 400 } } },
          {
            $group: {
              _id: { routePattern: "$routePattern", method: "$method" },
              count: { $sum: 1 },
              clientErrors: { $sum: { $cond: [{ $lt: ["$statusCode", 500] }, 1, 0] } },
              serverErrors: { $sum: { $cond: [{ $gte: ["$statusCode", 500] }, 1, 0] } },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ],
        // Неудачные входы — то, ради чего журнал в первую очередь и заводился.
        failedLogins: [
          {
            $match: {
              statusCode: { $in: [400, 401, 403] },
              routePattern: { $regex: "login|refresh-token" },
            },
          },
          {
            $group: {
              _id: { identifier: "$actor.identifier", ip: "$ip" },
              count: { $sum: 1 },
              lastAt: { $max: "$createdAt" },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ],
      },
    },
  ]);

  const t = (facet && facet.totals[0]) || {
    total: 0,
    errors: 0,
    clientErrors: 0,
    serverErrors: 0,
    avgDurationMs: 0,
  };

  res.json({
    period: {
      from: filter.createdAt.$gte || null,
      to: filter.createdAt.$lte || null,
      bucketUnit,
    },
    totals: {
      requests: t.total,
      errors: t.errors,
      clientErrors: t.clientErrors,
      serverErrors: t.serverErrors,
      errorRate: t.total ? Math.round((t.errors / t.total) * 10000) / 100 : 0,
      avgDurationMs: Math.round((t.avgDurationMs || 0) * 100) / 100,
    },
    timeline: (facet && facet.timeline) || [],
    topActors: (facet && facet.topActors) || [],
    topRoutes: (facet && facet.topRoutes) || [],
    topErrorRoutes: (facet && facet.topErrorRoutes) || [],
    failedLogins: (facet && facet.failedLogins) || [],
  });
});
