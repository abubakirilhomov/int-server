const mongoose = require("mongoose");

/**
 * Сгруппированная проблема: один fingerprint = одна строка, сколько бы раз
 * ошибка ни повторилась. TTL здесь НЕТ намеренно — сырьё (ErrorEvent) через
 * 30 дней исчезает, а счётчик и история проблемы должны пережить это.
 *
 * `status` — интерфейс между хранилищем и агентом Hermes (фаза 3):
 *   new → triaged → fix-proposed → resolved | ignored
 * Hermes забирает `new`, ставит `triaged`, по итогу — `fix-proposed` со ссылкой
 * на PR. `ignored` ставит человек, и такие Hermes'у больше не отдаются.
 */
const STATUSES = ["new", "triaged", "fix-proposed", "resolved", "ignored"];

const errorIssueSchema = new mongoose.Schema(
  {
    fingerprint: { type: String, required: true, unique: true },

    app: { type: String, required: true },
    kind: { type: String, required: true },
    // Образец «человеческого» сообщения — сырое, для показа.
    sampleMessage: { type: String, default: "" },
    // То, по чему группировали.
    normalizedMessage: { type: String, default: "" },
    topFrames: { type: [String], default: [] },

    firstSeen: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
    count: { type: Number, default: 0 },

    // Кого задело — ОГРАНИЧЕННАЯ выборка id (см. AFFECTED_CAP в сервисе), а не
    // полный список: у массового бага их могут быть тысячи. Точное число
    // различных пользователей считается на чтении агрегатом по ErrorEvent —
    // держать здесь «счётчик», который на деле длина выборки, значит врать.
    affectedUsers: { type: [String], default: [] },

    // Релизы, в которых проблема наблюдалась.
    releases: { type: [String], default: [] },

    status: { type: String, enum: STATUSES, default: "new", index: true },
    // Заполняется Hermes'ом в фазе 3.
    hermes: {
      branch: { type: String, default: null },
      prUrl: { type: String, default: null },
      note: { type: String, default: null },
      attempts: { type: Number, default: 0 },
      lastRunAt: { type: Date, default: null },
    },

    // Когда по проблеме последний раз уходило уведомление — троттлинг алертов.
    lastAlertAt: { type: Date, default: null },
    // На каком значении count был последний алерт-порог.
    lastAlertCount: { type: Number, default: 0 },

    resolvedAt: { type: Date, default: null },
    notes: { type: String, default: null },

    // Кто и когда последним менял статус — чтобы список отвечал на «кто это
    // разобрал» без похода в аудит-лог. Полный след (когда, с какого IP, каким
    // запросом) остаётся за аудит-логом: он висит на всём /api и пишет PATCH
    // сюда автоматически.
    statusChangedAt: { type: Date, default: null },
    statusChangedBy: {
      id: { type: String, default: null },
      name: { type: String, default: null },
    },
    // Когда закрытая проблема вернулась. Обновляется трекером, не человеком.
    regressedAt: { type: Date, default: null },
  },
  { versionKey: false, timestamps: true }
);

// Основная сортировка списка разбора: свежие и частые сверху.
errorIssueSchema.index({ status: 1, lastSeen: -1 });
errorIssueSchema.index({ app: 1, status: 1, lastSeen: -1 });
errorIssueSchema.index({ count: -1 });

module.exports = mongoose.model("ErrorIssue", errorIssueSchema);
module.exports.STATUSES = STATUSES;
