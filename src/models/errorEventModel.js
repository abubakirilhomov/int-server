const mongoose = require("mongoose");

/**
 * Одно вхождение ошибки. Сырьё: много, дёшево, живёт недолго.
 *
 * Пара к ErrorIssue: события отвечают на «покажи последние 20 случаев с
 * контекстом», issue — на «что вообще сломано и насколько часто». Хранить
 * только сгруппированное нельзя (пропадает контекст конкретного падения),
 * только сырое — тоже (нечего показывать в списке и нечего отдавать Hermes).
 *
 * TTL на createdAt: ERROR_RETENTION_DAYS, по умолчанию 30 дней. Issue при этом
 * живёт вечно — счётчик и история проблемы не должны исчезать вместе с сырьём.
 *
 * ВАЖНО: смена ERROR_RETENTION_DAYS на существующей коллекции сама не переедет,
 * нужен `db.runCommand({ collMod: "errorevents", index: { keyPattern:
 * { createdAt: 1 }, expireAfterSeconds: <новое> } })`.
 */
const RETENTION_DAYS = Number(process.env.ERROR_RETENTION_DAYS) || 30;

const { APPS, KINDS } = require("../utils/errorKinds");

// Та же форма, что в auditLogModel: `name` — подтверждённая личность,
// `identifier` — непроверенная строка. На неавторизованном ingest различие
// критично: клиент может назваться кем угодно, подписи токена там может не быть.
const actorSchema = new mongoose.Schema(
  {
    id: { type: String, default: null },
    kind: { type: String, enum: ["mentor", "intern", "anonymous"], default: "anonymous" },
    role: { type: String, default: null },
    isAdmin: { type: Boolean, default: false },
    name: { type: String, default: null },
    identifier: { type: String, default: null },
  },
  { _id: false }
);

const errorEventSchema = new mongoose.Schema(
  {
    // Ключ группировки. Считается в utils/fingerprint.js.
    fingerprint: { type: String, required: true },

    app: { type: String, enum: APPS, required: true },
    kind: { type: String, enum: KINDS, required: true },

    message: { type: String, default: "" },
    // Нормализованное сообщение — то, по чему группировали. Хранится, чтобы
    // разбор группировки не требовал пересчёта.
    normalizedMessage: { type: String, default: "" },
    stack: { type: String, default: null },
    // Верхние кадры нашего кода, уже нормализованные.
    topFrames: { type: [String], default: [] },
    // React отдаёт дерево компонентов отдельно от stack — оно часто полезнее.
    componentStack: { type: String, default: null },

    // Версия сборки (git sha). Без неё нельзя сказать «починили или нет».
    release: { type: String, default: null },
    url: { type: String, default: null },
    userAgent: { type: String, default: null },

    actor: { type: actorSchema, default: () => ({}) },

    // Последние действия перед падением.
    breadcrumbs: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // Произвольный контекст (пропсы, состояние) — отредактированный и обрезанный.
    context: { type: mongoose.Schema.Types.Mixed, default: null },

    // Для серверных событий: что за запрос/задача это была.
    routePattern: { type: String, default: null },
    ip: { type: String, default: null },

    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

// Лента событий одной проблемы — основной запрос из UI разбора.
errorEventSchema.index({ fingerprint: 1, createdAt: -1 });
// «Что вообще падало за период».
errorEventSchema.index({ createdAt: -1 });
// Срез по приложению.
errorEventSchema.index({ app: 1, createdAt: -1 });
// TTL.
errorEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 }
);

module.exports = mongoose.model("ErrorEvent", errorEventSchema);
module.exports.APPS = APPS;
module.exports.KINDS = KINDS;
module.exports.RETENTION_DAYS = RETENTION_DAYS;
