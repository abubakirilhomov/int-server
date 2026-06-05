const Setting = require("../models/settingModel");
const Branch = require("../models/branchModel");
const Mentor = require("../models/mentorModel");

const SPHERE_LABELS = {
  "backend-nodejs": "Backend Node",
  "backend-python": "Backend Python",
  "frontend-react": "Frontend React",
  "frontend-vue": "Frontend Vue",
  "mern-stack": "React + Python",
  "full-stack": "React + Node",
};

const SHIFT_LABELS = {
  morning: "1-smena (Ertalabki)",
  evening: "2-smena (Kechki)",
};

const escapeMarkdown = (s) =>
  String(s || "").replace(/([_*`\[\]()~>#+\-=|{}.!])/g, "\\$1");

async function resolveRecipients(application) {
  const recipients = new Set();
  let usedFallback = false;

  const routingDoc = await Setting.findOne({ key: "applicationRouting" }).lean();
  const routing = routingDoc?.value || {
    routes: [],
    fallbackChatIds: [],
    alwaysInclude: [],
  };

  let matched = false;
  for (const route of routing.routes || []) {
    if (Array.isArray(route.spheres) && route.spheres.includes(application.sphere)) {
      matched = true;
      for (const id of route.chatIds || []) recipients.add(String(id));
    }
  }

  if (!matched) {
    usedFallback = true;
    for (const id of routing.fallbackChatIds || []) recipients.add(String(id));
  }

  for (const id of routing.alwaysInclude || []) recipients.add(String(id));

  // Branch manager chat id
  const branch = await Branch.findById(application.branch).lean();
  if (branch?.branchManager) {
    const bm = await Mentor.findById(branch.branchManager)
      .select("+telegramChatId")
      .lean();
    if (bm?.telegramChatId) recipients.add(String(bm.telegramChatId));
  }

  return { chatIds: Array.from(recipients), usedFallback };
}

function formatMessage(application, mentorName, branchName, adminUrl) {
  const sphere = SPHERE_LABELS[application.sphere] || application.sphere;
  const shift = SHIFT_LABELS[application.shift] || application.shift;

  const lines = [
    "📥 *Yangi internlik arizasi❗️*",
    "",
    "━━━━━━━━━━━━━━",
    `👤 *Ism:* ${escapeMarkdown(application.firstName + " " + application.lastName)}`,
    `📞 *Telefon:* ${escapeMarkdown(application.phone)}`,
    `🆔 *Telegram:* @${escapeMarkdown(application.telegramUsername)}`,
    `🎂 *Yosh:* ${escapeMarkdown(application.age)}`,
    "",
    `📍 *Filial:* ${escapeMarkdown(branchName)}`,
    `👨‍🏫 *Mentor:* ${escapeMarkdown(mentorName)}`,
    `💻 *Yo'nalish:* ${escapeMarkdown(sphere)}`,
    `🕒 *Vaqt:* ${escapeMarkdown(shift)}`,
    "━━━━━━━━━━━━━━",
  ];

  if (adminUrl) {
    lines.push("", `🔗 ${adminUrl}`);
  }

  return lines.join("\n");
}

async function sendToChat(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "MarkdownV2",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Sends application notification to resolved chats and updates the
 * application doc with `telegramNotified`, `telegramError`, `notifiedChatIds`.
 * Never throws — failures are recorded on the application.
 */
async function notifyApplication(application, opts = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    application.telegramError = "TELEGRAM_BOT_TOKEN not configured";
    application.telegramNotified = false;
    await application.save();
    return { sent: 0, failed: 0, errors: ["TELEGRAM_BOT_TOKEN not configured"] };
  }

  let chatIds = [];
  try {
    ({ chatIds } = await resolveRecipients(application));
  } catch (err) {
    application.telegramError = `resolveRecipients: ${err.message}`;
    application.telegramNotified = false;
    await application.save();
    return { sent: 0, failed: 0, errors: [err.message] };
  }

  if (chatIds.length === 0) {
    application.telegramError = "no recipients resolved";
    application.telegramNotified = false;
    await application.save();
    return { sent: 0, failed: 0, errors: ["no recipients resolved"] };
  }

  const branch = await Branch.findById(application.branch).select("name").lean();
  const mentor = await Mentor.findById(application.mentor).select("name lastName").lean();
  const branchName = branch?.name || "—";
  const mentorName = mentor ? `${mentor.name || ""} ${mentor.lastName || ""}`.trim() : "—";

  const text = formatMessage(application, mentorName, branchName, opts.adminUrl);

  const results = await Promise.allSettled(
    chatIds.map((cid) => sendToChat(token, cid, text))
  );

  const succeeded = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") succeeded.push(chatIds[i]);
    else errors.push(`${chatIds[i]}: ${r.reason?.message || r.reason}`);
  });

  application.notifiedChatIds = succeeded;
  application.telegramNotified = succeeded.length > 0;
  application.telegramError = errors.length ? errors.join(" | ").slice(0, 500) : null;
  await application.save();

  return { sent: succeeded.length, failed: errors.length, errors };
}

/**
 * Отправляет произвольный текст в один или несколько чатов. По умолчанию текст
 * экранируется под MarkdownV2 (plain). Передай opts.raw=true, если текст уже в
 * валидном MarkdownV2. Никогда не бросает — возвращает { sent, failed, errors }.
 * Используется cron-напоминанием о собесах и письмами-результатами.
 */
async function sendMessage(chatIds, text, opts = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { sent: 0, failed: 0, errors: ["TELEGRAM_BOT_TOKEN not configured"] };
  }
  const ids = (Array.isArray(chatIds) ? chatIds : [chatIds]).map(String).filter(Boolean);
  if (ids.length === 0) return { sent: 0, failed: 0, errors: ["no chat ids"] };

  const payload = opts.raw ? text : escapeMarkdown(text);
  const results = await Promise.allSettled(ids.map((cid) => sendToChat(token, cid, payload)));

  const errors = [];
  let sent = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") sent += 1;
    else errors.push(`${ids[i]}: ${r.reason?.message || r.reason}`);
  });
  return { sent, failed: errors.length, errors };
}

module.exports = {
  notifyApplication,
  resolveRecipients,
  sendMessage,
  SPHERE_LABELS,
  SHIFT_LABELS,
};
