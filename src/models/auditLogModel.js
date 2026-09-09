const mongoose = require("mongoose");

/**
 * Журнал действий: кто, что, когда сделал через HTTP API.
 *
 * Пишется middleware'ом `middleware/auditLog.js` на каждый запрос к /api.
 * Источник истины для мониторинга и разборов инцидентов — до его появления
 * ответить на вопрос «кто удалил стажёра» было нечем (инцидент 2026-08).
 *
 * Коллекция растёт линейно по трафику, поэтому на `createdAt` висит TTL-индекс:
 * MongoDB сама удаляет записи старше AUDIT_RETENTION_DAYS (по умолчанию 180).
 *
 * ВАЖНО про TTL: mongoose создаёт индекс только если его ещё нет. Смена
 * AUDIT_RETENTION_DAYS на уже существующей коллекции НЕ переедет сама —
 * нужен `db.runCommand({ collMod: "auditlogs", index: { keyPattern: { createdAt: 1 },
 * expireAfterSeconds: <новое> } })`.
 */
const RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS) || 180;
const RETENTION_SECONDS = RETENTION_DAYS * 24 * 60 * 60;

const actorSchema = new mongoose.Schema(
  {
    // Строка, а не ObjectId+ref: актором может быть ментор ИЛИ стажёр
    // (разные коллекции), а у анонима id нет вовсе.
    id: { type: String, default: null },
    kind: {
      type: String,
      enum: ["mentor", "intern", "anonymous"],
      default: "anonymous",
    },
    role: { type: String, default: null },
    isAdmin: { type: Boolean, default: false },
    // У менторов имя есть в req.user; у стажёров auth.js его не грузит —
    // там остаётся null, а читающий API дорезолвит по actor.id.
    name: { type: String, default: null },
    // Чем представился аноним при неудачном логине (username / "Имя Фамилия").
    // Пароль сюда не попадает НИКОГДА.
    identifier: { type: String, default: null },
  },
  { _id: false }
);

const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: actorSchema, default: () => ({}) },

    method: { type: String, required: true },
    // Конкретный URL без query-строки: /api/interns/64b7...cde
    path: { type: String, required: true },
    // Шаблон роута: /api/interns/:id — по нему группируем в статистике.
    routePattern: { type: String, default: null },

    statusCode: { type: Number, required: true },
    durationMs: { type: Number, default: 0 },

    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },

    query: { type: mongoose.Schema.Types.Mixed, default: null },
    params: { type: mongoose.Schema.Types.Mixed, default: null },
    // Только для мутаций (POST/PUT/PATCH/DELETE), отредактированное и обрезанное.
    body: { type: mongoose.Schema.Types.Mixed, default: null },

    // Что за сущность затронута — заполняется из params, когда очевидно.
    resource: {
      type: { type: String, default: null },
      id: { type: String, default: null },
    },

    // Сообщение об ошибке для 4xx/5xx (снимается с тела ответа).
    error: { type: String, default: null },

    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

// ─── Индексы под запросы мониторинга ─────────────────────────────────────────
// Лента «последние события».
auditLogSchema.index({ createdAt: -1 });
// «Что делал вот этот человек».
auditLogSchema.index({ "actor.id": 1, createdAt: -1 });
// «Кто ходил в этот эндпоинт» + группировка в /stats.
auditLogSchema.index({ routePattern: 1, createdAt: -1 });
// «Покажи все ошибки» — самый ценный запрос для мониторинга.
auditLogSchema.index({ statusCode: 1, createdAt: -1 });
// TTL: отдельный ASC-индекс по тому же полю, живёт рядом с { createdAt: -1 }.
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });

module.exports = mongoose.model("AuditLog", auditLogSchema);
module.exports.RETENTION_DAYS = RETENTION_DAYS;
