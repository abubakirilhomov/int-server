const mongoose = require("mongoose");
const ErrorIssue = require("../models/errorIssueModel");
const ErrorEvent = require("../models/errorEventModel");
const AuditLog = require("../models/auditLogModel");
const Mentor = require("../models/mentorModel");
const Intern = require("../models/internModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { STATUSES } = ErrorIssue;

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const MAX_EVENTS = 50;
const DEFAULT_EVENTS = 20;

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseDate = (raw) => {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * В :id принимаем и ObjectId, и fingerprint.
 *
 * Fingerprint (sha1, 40 hex) — естественный ключ проблемы: он одинаков на
 * дев-стенде и в проде, его удобно вставить из алерта в Telegram. ObjectId
 * (24 hex) остаётся для ссылок из UI.
 */
const issueQuery = (id) => {
  const s = String(id || "");
  if (mongoose.isValidObjectId(s) && s.length === 24) return { _id: s };
  if (/^[0-9a-f]{40}$/i.test(s)) return { fingerprint: s.toLowerCase() };
  return null;
};

// ─── Переходы статуса ────────────────────────────────────────────────────────
/**
 * Основной маршрут из плана: new → triaged → fix-proposed → resolved | ignored.
 *
 * Плюс к нему разрешены откаты и переоткрытие — без них рабочий процесс
 * встаёт: PR от Hermes отклонили, и issue навсегда застрял бы в fix-proposed;
 * ошибку закрыли, она вернулась — переоткрыть было бы нечем.
 *
 * `ignored` и `resolved` доступны из любого рабочего состояния: отмахнуться
 * от проблемы можно на любом этапе, заставлять ради этого проходить всю
 * цепочку бессмысленно.
 */
const ALLOWED_TRANSITIONS = {
  new: ["triaged", "fix-proposed", "resolved", "ignored"],
  triaged: ["fix-proposed", "resolved", "ignored", "new"],
  "fix-proposed": ["resolved", "ignored", "triaged"],
  // Из терминальных — только переоткрытие: регресс или передумали.
  resolved: ["new"],
  ignored: ["new"],
};

const canTransition = (from, to) => (ALLOWED_TRANSITIONS[from] || []).includes(to);

// ─── Список ──────────────────────────────────────────────────────────────────
const buildFilter = (q) => {
  const filter = {};

  if (q.app) filter.app = String(q.app);
  if (q.kind) filter.kind = String(q.kind);
  if (q.release) filter.releases = String(q.release);

  if (q.status) {
    // Несколько статусов через запятую: «покажи всё, кроме закрытого».
    const list = String(q.status).split(",").map((s) => s.trim()).filter(Boolean);
    const valid = list.filter((s) => STATUSES.includes(s));
    if (valid.length === 1) filter.status = valid[0];
    else if (valid.length > 1) filter.status = { $in: valid };
  }

  if (q.q) {
    // Экранируем: пользовательский ввод в $regex — это и падения, и ReDoS.
    const rx = { $regex: escapeRegex(q.q), $options: "i" };
    filter.$or = [{ sampleMessage: rx }, { normalizedMessage: rx }, { topFrames: rx }];
  }

  // Период по lastSeen: «что болит сейчас» важнее, чем когда впервые возникло.
  const from = parseDate(q.from);
  const to = parseDate(q.to);
  if (from || to) {
    filter.lastSeen = {};
    if (from) filter.lastSeen.$gte = from;
    if (to) filter.lastSeen.$lte = to;
  }

  return filter;
};

const SORTABLE = ["count", "lastSeen", "firstSeen"];

// GET /api/error-issues
exports.getIssues = catchAsync(async (req, res) => {
  const filter = buildFilter(req.query);

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

  const sortField = SORTABLE.includes(req.query.sort) ? req.query.sort : "lastSeen";
  const order = req.query.order === "asc" ? 1 : -1;
  // Вторым ключом — _id: без него порядок внутри равных значений не определён
  // и записи «прыгают» между страницами.
  const sort = { [sortField]: order, _id: -1 };

  const [issues, total] = await Promise.all([
    ErrorIssue.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    ErrorIssue.countDocuments(filter),
  ]);

  res.json({
    data: issues,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
      hasMore: page * limit < total,
    },
  });
});

// ─── Сводка ──────────────────────────────────────────────────────────────────
// GET /api/error-issues/stats
exports.getStats = catchAsync(async (req, res) => {
  const from = parseDate(req.query.from) || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const to = parseDate(req.query.to) || null;

  const eventWindow = { createdAt: { $gte: from, ...(to ? { $lte: to } : {}) } };
  const bucketUnit =
    (to || new Date()).getTime() - from.getTime() > 3 * 24 * 60 * 60 * 1000 ? "day" : "hour";

  const [issueFacet] = await ErrorIssue.aggregate([
    {
      $facet: {
        byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
        byApp: [{ $group: { _id: "$app", count: { $sum: 1 }, events: { $sum: "$count" } } }],
        byKind: [{ $group: { _id: "$kind", count: { $sum: 1 } } }],
        // Что горит: открытое, отсортированное по частоте.
        topOpen: [
          { $match: { status: { $in: ["new", "triaged", "fix-proposed"] } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
          {
            $project: {
              fingerprint: 1, app: 1, kind: 1, status: 1, count: 1,
              sampleMessage: 1, lastSeen: 1, topFrames: 1,
            },
          },
        ],
        totals: [
          {
            $group: {
              _id: null,
              issues: { $sum: 1 },
              open: {
                $sum: {
                  $cond: [{ $in: ["$status", ["new", "triaged", "fix-proposed"]] }, 1, 0],
                },
              },
              events: { $sum: "$count" },
            },
          },
        ],
        // Новые за период — по firstSeen, а не по lastSeen.
        fresh: [{ $match: { firstSeen: { $gte: from } } }, { $count: "n" }],
      },
    },
  ]);

  const timeline = await ErrorEvent.aggregate([
    { $match: eventWindow },
    {
      $group: {
        _id: { $dateTrunc: { date: "$createdAt", unit: bucketUnit } },
        total: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const asMap = (rows) =>
    Object.fromEntries((rows || []).map((r) => [r._id, r.count]));

  const t = (issueFacet && issueFacet.totals[0]) || { issues: 0, open: 0, events: 0 };

  res.json({
    period: { from, to, bucketUnit },
    totals: {
      issues: t.issues,
      open: t.open,
      events: t.events,
      newInPeriod: (issueFacet && issueFacet.fresh[0] && issueFacet.fresh[0].n) || 0,
    },
    byStatus: asMap(issueFacet && issueFacet.byStatus),
    byKind: asMap(issueFacet && issueFacet.byKind),
    byApp: (issueFacet && issueFacet.byApp) || [],
    topOpen: (issueFacet && issueFacet.topOpen) || [],
    timeline,
  });
});

// ─── Детализация ─────────────────────────────────────────────────────────────
// GET /api/error-issues/:id
exports.getIssue = catchAsync(async (req, res, next) => {
  const q = issueQuery(req.params.id);
  if (!q) return next(new AppError("Некорректный идентификатор проблемы", 400));

  const issue = await ErrorIssue.findOne(q).lean();
  if (!issue) return next(new AppError("Проблема не найдена", 404));

  const limit = Math.min(Math.max(parseInt(req.query.events, 10) || DEFAULT_EVENTS, 1), MAX_EVENTS);
  const fp = issue.fingerprint;

  const [events, distinctUsers, byRelease, timeline] = await Promise.all([
    ErrorEvent.find({ fingerprint: fp }).sort({ createdAt: -1 }).limit(limit).lean(),
    // Точное число задетых — здесь, а не в issue.affectedUsers: там осознанно
    // лежит ограниченная выборка. Считается по событиям, поэтому охватывает
    // только последние ERROR_RETENTION_DAYS (по умолчанию 30 дней).
    ErrorEvent.distinct("actor.id", { fingerprint: fp, "actor.id": { $ne: null } }),
    ErrorEvent.aggregate([
      { $match: { fingerprint: fp } },
      { $group: { _id: "$release", count: { $sum: 1 }, lastSeen: { $max: "$createdAt" } } },
      { $sort: { lastSeen: -1 } },
    ]),
    ErrorEvent.aggregate([
      { $match: { fingerprint: fp } },
      {
        $group: {
          _id: { $dateTrunc: { date: "$createdAt", unit: "hour" } },
          total: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $limit: 336 }, // две недели по часам
    ]),
  ]);

  await attachActorNames(events);

  res.json({
    issue,
    events,
    affectedUsersExact: distinctUsers.length,
    // Честно говорим, откуда число: сырьё живёт 30 дней, старое уже удалено TTL.
    affectedUsersNote: "различные actor.id по сохранённым событиям (TTL сырья)",
    byRelease,
    timeline,
  });
});

/**
 * Имена акторов: auth.js не грузит имя стажёра, поэтому в событии стоит null.
 * Дорезолвим на чтении — одна выборка на страницу вместо запроса в Mongo на
 * каждое записываемое событие. Та же логика, что в auditLogController.
 */
const attachActorNames = async (rows) => {
  const missing = { intern: new Set(), mentor: new Set() };
  for (const r of rows) {
    const a = r.actor;
    if (a && a.id && !a.name && missing[a.kind] && mongoose.isValidObjectId(a.id)) {
      missing[a.kind].add(a.id);
    }
  }
  if (!missing.intern.size && !missing.mentor.size) return rows;

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
  for (const r of rows) {
    if (r.actor && r.actor.id && !r.actor.name) r.actor.name = names.get(r.actor.id) || null;
  }
  return rows;
};

// ─── Связка с аудит-логом ────────────────────────────────────────────────────
const DEFAULT_BEFORE_SEC = 120;
const DEFAULT_AFTER_SEC = 15;
const MAX_WINDOW_SEC = 3600;

/**
 * GET /api/error-issues/:id/context
 *
 * «Что человек делал за минуту до падения» — то, ради чего журнал свой, а не
 * Sentry: у внешнего сервиса нет нашего аудит-лога, и связать падение с
 * действиями пользователя он не может в принципе.
 *
 * Берём конкретное событие (по умолчанию последнее), его actor.id и время —
 * и отдаём записи аудит-лога того же пользователя вокруг этого момента.
 *
 * Окно асимметрично намеренно: интересно прежде всего то, что было ДО, а
 * «после» нужно лишь чтобы увидеть сам упавший запрос.
 */
exports.getIssueContext = catchAsync(async (req, res, next) => {
  const q = issueQuery(req.params.id);
  if (!q) return next(new AppError("Некорректный идентификатор проблемы", 400));

  const issue = await ErrorIssue.findOne(q).lean();
  if (!issue) return next(new AppError("Проблема не найдена", 404));

  const eventFilter = { fingerprint: issue.fingerprint };
  if (req.query.eventId) {
    if (!mongoose.isValidObjectId(String(req.query.eventId))) {
      return next(new AppError("Некорректный идентификатор события", 400));
    }
    eventFilter._id = String(req.query.eventId);
  }

  const event = await ErrorEvent.findOne(eventFilter).sort({ createdAt: -1 }).lean();
  if (!event) {
    return res.json({
      event: null,
      entries: [],
      reason: "no-events",
      note: "События этой проблемы уже удалены по TTL — восстановить контекст не из чего",
    });
  }

  const beforeSec = Math.min(
    Math.max(parseInt(req.query.windowSec, 10) || DEFAULT_BEFORE_SEC, 1),
    MAX_WINDOW_SEC
  );
  const afterSec = Math.min(
    Math.max(parseInt(req.query.afterSec, 10) || DEFAULT_AFTER_SEC, 0),
    MAX_WINDOW_SEC
  );

  const at = new Date(event.createdAt);
  const window = {
    from: new Date(at.getTime() - beforeSec * 1000),
    to: new Date(at.getTime() + afterSec * 1000),
  };

  // Аноним не связывается: у него нет id, а сшивать по IP — гадание, которое
  // в отчёте выглядело бы как факт.
  if (!event.actor || !event.actor.id) {
    return res.json({
      event,
      entries: [],
      window,
      reason: "anonymous-actor",
      note: "Отчёт пришёл без подтверждённой личности — связать с аудит-логом не по чему",
    });
  }

  const entries = await AuditLog.find({
    "actor.id": event.actor.id,
    createdAt: { $gte: window.from, $lte: window.to },
  })
    .sort({ createdAt: 1 })
    .limit(MAX_LIMIT)
    .lean();

  // Помечаем запись, ближайшую к моменту падения: почти всегда именно она и
  // есть тот самый запрос, на котором всё сломалось.
  let closestIdx = -1;
  let bestDelta = Infinity;
  entries.forEach((e, i) => {
    const d = Math.abs(new Date(e.createdAt).getTime() - at.getTime());
    if (d < bestDelta) {
      bestDelta = d;
      closestIdx = i;
    }
  });

  res.json({
    event,
    window,
    entries,
    closestIndex: closestIdx,
    reason: entries.length ? null : "no-audit-entries",
  });
});

// ─── Смена статуса ───────────────────────────────────────────────────────────
// PATCH /api/error-issues/:id
exports.updateIssue = catchAsync(async (req, res, next) => {
  const q = issueQuery(req.params.id);
  if (!q) return next(new AppError("Некорректный идентификатор проблемы", 400));

  const { status, notes } = req.body || {};

  if (status === undefined && notes === undefined) {
    return next(new AppError("Нечего менять: ожидается status или notes", 400));
  }

  const issue = await ErrorIssue.findOne(q);
  if (!issue) return next(new AppError("Проблема не найдена", 404));

  const update = {};

  if (status !== undefined) {
    if (!STATUSES.includes(status)) {
      return next(
        new AppError(`Неизвестный статус «${status}». Допустимы: ${STATUSES.join(", ")}`, 400)
      );
    }
    // Молча применить недопустимый переход хуже, чем отказать: это тихо ломает
    // рабочий процесс и делает историю статусов недостоверной.
    if (status !== issue.status && !canTransition(issue.status, status)) {
      return next(
        new AppError(
          `Недопустимый переход «${issue.status}» → «${status}». ` +
            `Из «${issue.status}» можно: ${(ALLOWED_TRANSITIONS[issue.status] || []).join(", ") || "никуда"}`,
          400
        )
      );
    }

    update.status = status;
    update.resolvedAt = status === "resolved" ? new Date() : null;
    // Кто менял — для показа в списке. Полноценный след («когда, с какого IP,
    // каким запросом») пишет middleware аудит-лога, он висит на всём /api.
    update.statusChangedAt = new Date();
    update.statusChangedBy = req.user
      ? {
          id: String(req.user.id),
          name: [req.user.name, req.user.lastName].filter(Boolean).join(" ").trim() || null,
        }
      : null;
    // Снимаем троттлинг алертов: переоткрытая проблема должна снова сообщать
    // о себе, иначе кулдаун от прошлой жизни issue заглушит регресс.
    if (status === "new") update.lastAlertCount = 0;
  }

  if (notes !== undefined) update.notes = notes === null ? null : String(notes).slice(0, 2000);

  const updated = await ErrorIssue.findOneAndUpdate(q, { $set: update }, { new: true }).lean();
  res.json(updated);
});

module.exports.ALLOWED_TRANSITIONS = ALLOWED_TRANSITIONS;
module.exports.canTransition = canTransition;
