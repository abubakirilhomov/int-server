/**
 * Weekly plan evaluation — заменяет ежедневную isPlanBlocked проверку.
 *
 * Cron в cronService.js запускается каждый понедельник 00:30 Asia/Tashkent
 * и зовёт evaluateWeeklyPlans(). Логика и state machine описаны в
 * vault/10-projects/interns-system/weekly-self-activation-plan.md (§4, §5).
 *
 * Фаза 1 (текущая): пишет результат в Intern.weeklyPlan, но enforcement в
 * lessonController не включён. Параллельно работает старая manualActivation.
 *
 * Фаза 2: lessonController.createLesson начнёт читать weeklyPlan.status,
 * добавится POST /api/interns/me/self-activate, manualActivation
 * задепрекейтится.
 */

const Intern = require("../models/internModel");
const Lesson = require("../models/lessonModel");
const Subscription = require("../models/subscriptionModel");
const webpush = require("web-push");

// Tashkent — стабильный UTC+5, без DST.
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * Возвращает UTC-Date, соответствующий "00:00 Asia/Tashkent" для дня, в
 * который попадает входной момент (по таштенскому времени).
 */
function startOfTashkentDay(d) {
  const t = new Date(d.getTime() + TASHKENT_OFFSET_MS);
  t.setUTCHours(0, 0, 0, 0);
  return new Date(t.getTime() - TASHKENT_OFFSET_MS);
}

/**
 * UTC-Date соответствующий 1-му числу текущего месяца 00:00 Asia/Tashkent.
 * Нужен для счётчика "self-activations за календарный месяц".
 */
function startOfTashkentMonth(d) {
  const t = new Date(d.getTime() + TASHKENT_OFFSET_MS);
  const utcMs = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1);
  return new Date(utcMs - TASHKENT_OFFSET_MS);
}

/**
 * Окно для оценки. При запуске понедельник 00:30 Tashkent:
 *   weekStart = прошлый понедельник 00:00 Tashkent
 *   weekEnd   = сегодняшний понедельник 00:00 Tashkent (exclusive)
 *   currentWeekStartAt = сегодняшний понедельник 00:00 Tashkent
 */
function getEvaluationWindow(now) {
  const todayStart = startOfTashkentDay(now);
  const weekStart = new Date(todayStart.getTime() - 7 * 86400000);
  return { weekStart, weekEnd: todayStart, currentWeekStartAt: todayStart };
}

/**
 * Основной evaluator. Параметры — для тестов: можно подменить "сейчас" и
 * dry-run чтобы не писать в БД.
 *
 * @param {object} opts
 * @param {Date}    opts.now      — момент, для которого считаем (default: new Date())
 * @param {boolean} opts.dryRun   — не сохраняем в БД (default: false)
 * @param {boolean} opts.verbose  — построчный лог по каждому интерну (default: true)
 * @returns {{ okCount, restrictedCount, adminBlockCount, skippedCount,
 *            details: Array<{internId, name, fromStatus, toStatus, reason}> }}
 */
async function evaluateWeeklyPlans({
  now = new Date(),
  dryRun = false,
  verbose = true,
} = {}) {
  const { weekStart, weekEnd, currentWeekStartAt } = getEvaluationWindow(now);
  const monthStart = startOfTashkentMonth(now);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000);

  // Активные интерны, прошедшие 14-дневный грейс с момента dateJoined.
  // Замороженных и архивных не трогаем — у них своя семантика.
  const interns = await Intern.find({
    status: "active",
    $or: [
      { dateJoined: { $lte: fourteenDaysAgo } },
      { dateJoined: { $exists: false } }, // legacy без поля — считаем "старым"
    ],
  });

  // Сразу посчитаем сколько новичков пропустили (для лога — диагностика)
  const skipped = await Intern.countDocuments({
    status: "active",
    dateJoined: { $gt: fourteenDaysAgo },
  });

  if (verbose) {
    console.log(
      `[weekly] window ${weekStart.toISOString()} .. ${weekEnd.toISOString()}, ${
        interns.length
      } intern(s) to evaluate, ${skipped} new skipped (<14d)`
    );
  }

  let okCount = 0;
  let restrictedCount = 0;
  let adminBlockCount = 0;
  const details = [];

  for (const intern of interns) {
    const target = Math.ceil((intern.lessonsPerMonth || 0) / 4);

    const confirmed = await Lesson.countDocuments({
      intern: intern._id,
      date: { $gte: weekStart, $lt: weekEnd },
      status: { $in: ["confirmed", "pending"] },
    });
    const bonusInWindow = (intern.bonusLessons || [])
      .filter((b) => {
        const d = b.date ? new Date(b.date) : null;
        return d && d >= weekStart && d < weekEnd;
      })
      .reduce((s, b) => s + (b.count || 0), 0);
    const total = confirmed + bonusInWindow;
    const deficit = Math.max(0, target - total);

    const wp = intern.weeklyPlan || {};
    const prevStatus = wp.status || "ok";
    const activationsThisMonth = (wp.selfActivations || []).filter((a) => {
      const d = a.activatedAt ? new Date(a.activatedAt) : null;
      return d && d >= monthStart;
    }).length;

    let newStatus;
    let reason;

    if (deficit === 0) {
      newStatus = "ok";
      wp.streakWeeks = (wp.streakWeeks || 0) + 1;
      wp.longestStreakWeeks = Math.max(
        wp.longestStreakWeeks || 0,
        wp.streakWeeks
      );
      reason = `pass (${total}/${target}, streak=${wp.streakWeeks})`;
      okCount++;
    } else {
      // Fail-week
      wp.streakWeeks = 0;
      if (prevStatus === "restricted") {
        newStatus = "admin_block";
        reason = `fail after restricted week (${total}/${target}, def=${deficit})`;
        adminBlockCount++;
      } else if (activationsThisMonth >= 2) {
        newStatus = "admin_block";
        reason = `fail, ${activationsThisMonth}/2 activations already used`;
        adminBlockCount++;
      } else {
        newStatus = "restricted";
        wp.restrictedSince = now;
        reason = `fail (${total}/${target}, def=${deficit}), ${activationsThisMonth}/2 used`;
        restrictedCount++;
      }
    }

    wp.status = newStatus;
    wp.lastEvaluatedAt = now;
    wp.currentWeekStartAt = currentWeekStartAt;
    wp.currentWeekTarget = target;
    wp.currentWeekConfirmed = 0; // новая неделя начинается с 0

    details.push({
      internId: intern._id,
      name: `${intern.name} ${intern.lastName || ""}`.trim(),
      fromStatus: prevStatus,
      toStatus: newStatus,
      reason,
    });

    if (verbose) {
      console.log(
        `[weekly] ${intern.name} ${intern.lastName || ""}: ${prevStatus} → ${newStatus} | ${reason}`
      );
    }

    if (!dryRun) {
      intern.weeklyPlan = wp;
      await intern.save();
      // Fire-and-forget push, only on status change. Failing pushes log
      // but don't break the cron loop.
      if (newStatus !== prevStatus) {
        notifyWeeklyTransition(intern, prevStatus, newStatus, target, total).catch(
          (e) => console.error(`[weekly] push failed for ${intern._id}:`, e.message)
        );
      }
    }
  }

  return {
    okCount,
    restrictedCount,
    adminBlockCount,
    skippedCount: skipped,
    details,
  };
}

/**
 * Web-push на переходы weekly-plan. Тексты — короткие, без preview-фрейминга
 * (Phase 2 уже enforcement). Шлёт всем подпискам интерна. 410/404 → чистим
 * мёртвые подписки. Telegram-копии пока не шлём — для этого нужна отдельная
 * инфраструктура для intern chatId (см. рекомендацию в шапке файла).
 */
async function notifyWeeklyTransition(intern, fromStatus, toStatus, target, total) {
  let payload = null;
  if (toStatus === "ok" && fromStatus !== "ok") {
    payload = {
      title: "🔥 Неделя пройдена!",
      body: `${total}/${target} уроков. Стрик: ${intern.weeklyPlan?.streakWeeks || 0} нед. подряд.`,
    };
  } else if (toStatus === "restricted") {
    payload = {
      title: "⛔ Аккаунт ограничен",
      body: `Прошлая неделя: ${total}/${target} уроков. Реактивируй в дашборде — без админа.`,
    };
  } else if (toStatus === "admin_block") {
    payload = {
      title: "🚫 Аккаунт заблокирован",
      body:
        "Лимит самоактиваций исчерпан или две недели подряд без плана. Обратись к менеджеру.",
    };
  }
  if (!payload) return;

  const subs = await Subscription.find({
    userId: intern._id,
    userType: { $in: ["intern", "Intern"] },
  });
  if (subs.length === 0) return;

  const body = JSON.stringify(payload);
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        body
      );
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await Subscription.deleteOne({ _id: sub._id });
      } else {
        console.error(`[weekly-push] ${intern._id}: ${err.message}`);
      }
    }
  }
}

/**
 * Возвращает JSON-ready view weeklyPlan для дашборда и /me/weekly-plan.
 * Считает текущий week-deficit на лету (cron обновляет только snapshot на
 * начало недели), вычисляет at_risk и activationsLeft.
 *
 * @param {object} intern — Mongoose-doc или lean-object с weeklyPlan, bonusLessons, lessonsPerMonth
 * @param {Date}   now    — момент расчёта (default: new Date())
 */
async function getWeeklyPlanView(intern, now = new Date()) {
  const wp = intern.weeklyPlan || {};
  const target = Math.ceil((intern.lessonsPerMonth || 0) / 4);
  const monthStart = startOfTashkentMonth(now);

  // Границы текущей недели (от понедельника 00:00 Tashkent текущей недели).
  const todayTashkent = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  const dayOfWeekTashkent = todayTashkent.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMon = dayOfWeekTashkent === 0 ? 6 : dayOfWeekTashkent - 1;
  const todayStart = startOfTashkentDay(now);
  const currentWeekStart = new Date(todayStart.getTime() - daysSinceMon * 86400000);
  const nextWeekStart = new Date(currentWeekStart.getTime() + 7 * 86400000);

  // Считаем подтверждённые + pending уроки за текущую неделю.
  const Lesson = require("../models/lessonModel");
  const confirmed = await Lesson.countDocuments({
    intern: intern._id,
    date: { $gte: currentWeekStart, $lt: nextWeekStart },
    status: { $in: ["confirmed", "pending"] },
  });
  const bonusInWeek = (intern.bonusLessons || [])
    .filter((b) => {
      const d = b.date ? new Date(b.date) : null;
      return d && d >= currentWeekStart && d < nextWeekStart;
    })
    .reduce((s, b) => s + (b.count || 0), 0);
  const currentWeekConfirmed = confirmed + bonusInWeek;
  const currentWeekDeficit = Math.max(0, target - currentWeekConfirmed);

  // at_risk = ok + deficit + elapsed >= 4 days (четверг). Не пишется в БД,
  // только для UI-предупреждения "⏳ осталось N уроков и M дней".
  const elapsedDaysThisWeek = daysSinceMon + 1; // 1..7 (Mon=1, Sun=7)
  const isAtRisk =
    (wp.status || "ok") === "ok" &&
    currentWeekDeficit > 0 &&
    elapsedDaysThisWeek >= 4;

  // Сколько self-activations осталось в этом календарном месяце.
  const activationsUsedThisMonth = (wp.selfActivations || []).filter((a) => {
    const d = a.activatedAt ? new Date(a.activatedAt) : null;
    return d && d >= monthStart;
  }).length;
  const activationsLeft = Math.max(0, 2 - activationsUsedThisMonth);

  return {
    status: wp.status || "ok",
    streakWeeks: wp.streakWeeks || 0,
    longestStreakWeeks: wp.longestStreakWeeks || 0,
    lastEvaluatedAt: wp.lastEvaluatedAt || null,
    restrictedSince: wp.restrictedSince || null,

    // Текущая неделя — для индикатора и at_risk.
    currentWeekStartAt: currentWeekStart,
    currentWeekTarget: target,
    currentWeekConfirmed,
    currentWeekDeficit,
    daysLeftInWeek: Math.max(0, 7 - elapsedDaysThisWeek),
    isAtRisk,

    // Self-activations.
    activationsLeft,
    activationsUsedThisMonth,
    selfActivations: wp.selfActivations || [],
  };
}

module.exports = {
  evaluateWeeklyPlans,
  getWeeklyPlanView,
  // exported for tests
  _internals: {
    startOfTashkentDay,
    startOfTashkentMonth,
    getEvaluationWindow,
  },
};
