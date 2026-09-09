const { sendMessage } = require("./telegramService");

/**
 * Уведомления об ошибках в Telegram.
 *
 * Хранилище без уведомления бесполезно: о проблеме узнают, только когда
 * кто-нибудь откроет страницу разбора. Поэтому новый issue и рост частоты
 * уходят в чат.
 *
 * Два уровня троттлинга, оба обязательны:
 *   1. Кулдаун на issue — один шумный баг не заливает чат сотней сообщений.
 *   2. Глобальный потолок в час — веерное падение (упала Mongo, посыпалось
 *      всё сразу) не превращается в сотни сообщений от десятков issue.
 *
 * Ничего не бросает: сбой отправки не должен влиять ни на запись ошибки,
 * ни тем более на обслуживаемый запрос.
 */

// `Number(x) || def` здесь нельзя: 0 — законное значение («без кулдауна»,
// «не слать вовсе»), а falsy-фолбэк молча подменял бы его дефолтом.
const numEnv = (name, def) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : def;
};

const isEnabled = () => process.env.ERROR_ALERTS_ENABLED !== "false";
const cooldownMs = () => numEnv("ERROR_ALERT_COOLDOWN_MIN", 30) * 60 * 1000;
const maxPerHour = () => numEnv("ERROR_ALERT_MAX_PER_HOUR", 20);

const chatIds = () =>
  String(process.env.ERROR_ALERT_CHAT_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// Пороги эскалации: сообщаем не на каждое повторение, а когда проблема
// перешла в другой порядок величины.
const MILESTONES = [10, 50, 100, 500, 1000, 5000, 10000];

const crossedMilestone = (before, after) =>
  MILESTONES.find((m) => before < m && after >= m) || null;

// Глобальный потолок — скользящее окно в памяти.
let sentTimestamps = [];
const globalBudgetLeft = () => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  sentTimestamps = sentTimestamps.filter((t) => t > cutoff);
  return maxPerHour() - sentTimestamps.length;
};

const APP_LABELS = {
  interns: "interns",
  mentors: "mentors",
  admin: "admin",
  server: "int-server",
};

const buildText = (issue, isNew, milestone) => {
  const head = isNew
    ? `🔴 Новая ошибка — ${APP_LABELS[issue.app] || issue.app}`
    : `📈 Ошибка участилась (${milestone}+) — ${APP_LABELS[issue.app] || issue.app}`;

  const frame = (issue.topFrames && issue.topFrames[0]) || "—";
  const lines = [
    head,
    "",
    (issue.sampleMessage || issue.normalizedMessage || "").slice(0, 300),
    "",
    `${issue.kind} · ${frame}`,
    `Случаев: ${issue.count} · задето: ${(issue.affectedUsers || []).length}`,
    `fp: ${String(issue.fingerprint).slice(0, 12)}`,
  ];
  return lines.join("\n");
};

/**
 * Решает, слать ли уведомление, и шлёт. Обновляет поля троттлинга на issue.
 * Никогда не бросает.
 *
 * @param issue  свежий документ ErrorIssue (после инкремента)
 * @param isNew  issue только что создан
 */
const maybeAlert = async (issue, isNew) => {
  try {
    if (!isEnabled()) return { sent: false, reason: "disabled" };
    if (!process.env.TELEGRAM_BOT_TOKEN) return { sent: false, reason: "no-token" };

    const ids = chatIds();
    if (ids.length === 0) return { sent: false, reason: "no-recipients" };

    // Разобранное и заигноренное не тревожит: если человек закрыл issue,
    // а ошибка повторилась — это увидят в UI, будить чат незачем.
    if (issue.status === "ignored" || issue.status === "resolved") {
      return { sent: false, reason: "status-silenced" };
    }

    const before = issue.lastAlertCount || 0;
    const milestone = crossedMilestone(before, issue.count);

    if (!isNew && !milestone) return { sent: false, reason: "no-trigger" };

    if (!isNew && issue.lastAlertAt && Date.now() - issue.lastAlertAt.getTime() < cooldownMs()) {
      return { sent: false, reason: "cooldown" };
    }

    if (globalBudgetLeft() <= 0) return { sent: false, reason: "hourly-cap" };

    const result = await sendMessage(ids, buildText(issue, isNew, milestone));
    sentTimestamps.push(Date.now());

    // Отмечаем факт попытки независимо от исхода: иначе при недоступном
    // Telegram кулдаун не встанет и мы будем долбиться в него каждым событием.
    await issue.constructor.updateOne(
      { _id: issue._id },
      { $set: { lastAlertAt: new Date(), lastAlertCount: issue.count } }
    );

    return { sent: result.sent > 0, reason: null, telegram: result };
  } catch (err) {
    console.error("[errors] alert failed:", err.message);
    return { sent: false, reason: "error" };
  }
};

module.exports = {
  maybeAlert,
  buildText,
  crossedMilestone,
  MILESTONES,
  _resetBudget: () => { sentTimestamps = []; },
};
