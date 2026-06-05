const cron = require("node-cron");
const webpush = require("web-push");
const Mentor = require("../models/mentorModel");
const Lesson = require("../models/lessonModel");
const Subscription = require("../models/subscriptionModel");
const Intern = require("../models/internModel");
const { resetStaleStreaks } = require("./streakService");
const { evaluateWeeklyPlans } = require("./weeklyPlanService");
const Interview = require("../models/interviewModel");
const Setting = require("../models/settingModel");
const { sendMessage } = require("./telegramService");

// Tashkent — стабильный UTC+5.
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const tashkentDayBounds = (now = new Date()) => {
    const t = new Date(now.getTime() + TASHKENT_OFFSET_MS);
    t.setUTCHours(0, 0, 0, 0);
    const start = new Date(t.getTime() - TASHKENT_OFFSET_MS);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
    return { start, end };
};

// Настройка web-push (ключи должны быть в .env)
const publicVapidKey = process.env.VAPID_PUBLIC_KEY;
const privateVapidKey = process.env.VAPID_PRIVATE_KEY;

if (publicVapidKey && privateVapidKey) {
    webpush.setVapidDetails(
        "mailto:test@test.com",
        publicVapidKey,
        privateVapidKey
    );
}

class CronService {
    init() {
        // Каждый день в 10:00 — напоминания
        cron.schedule("0 10 * * *", async () => {
            console.log("🔔 Running daily notification job...");
            try {
                await this.notifyMentorsWithDebt();
                await this.notifyInternsWithPendingLessons();
                const reset = await resetStaleStreaks();
                if (reset > 0) console.log(`🔥 Reset ${reset} stale streaks`);
            } catch (error) {
                console.error("❌ Error in daily cron job:", error);
            }
        });

        // 1-го числа каждого месяца в 00:05 — сброс истёкших ручных активаций
        cron.schedule("5 0 1 * *", async () => {
            console.log("🔄 Resetting expired manual activations...");
            try {
                await this.resetExpiredManualActivations();
            } catch (error) {
                console.error("❌ Error resetting manual activations:", error);
            }
        });

        // Каждый понедельник в 00:30 Asia/Tashkent — оценка прошлой недели по
        // weeklyPlan. Сейчас shadow-mode: пишет в БД, lessonController пока не
        // читает (enforcement в Phase 2). См.
        // vault/10-projects/interns-system/weekly-self-activation-plan.md.
        cron.schedule(
            "30 0 * * 1",
            async () => {
                console.log("📅 Weekly plan evaluation starting (shadow-mode)...");
                try {
                    const result = await evaluateWeeklyPlans();
                    console.log(
                        `✅ Weekly plan: ${result.okCount} ok, ${result.restrictedCount} restricted, ${result.adminBlockCount} admin_block (${result.skippedCount} skipped)`
                    );
                } catch (error) {
                    console.error("❌ Error in weekly plan evaluation:", error);
                }
            },
            { timezone: "Asia/Tashkent" }
        );

        // Каждый день в 08:00 Asia/Tashkent — напоминание о собеседованиях на сегодня.
        cron.schedule(
            "0 8 * * *",
            async () => {
                console.log("📋 Running interview reminder job...");
                try {
                    await this.notifyTodayInterviews();
                } catch (error) {
                    console.error("❌ Error in interview reminder job:", error);
                }
            },
            { timezone: "Asia/Tashkent" }
        );

        console.log("✅ Cron jobs initialized");
    }

    async notifyTodayInterviews() {
        const settingDoc = await Setting.findOne({ key: "interviewSettings" }).lean();
        const chatIds = settingDoc?.value?.reminderChatIds || [];
        if (!chatIds.length) {
            console.log("ℹ️ No interview reminderChatIds configured — skipping");
            return;
        }

        const { start, end } = tashkentDayBounds();
        const interviews = await Interview.find({
            status: "scheduled",
            scheduledAt: { $gte: start, $lte: end },
        })
            .sort({ scheduledAt: 1 })
            .populate("application", "firstName lastName phone telegramUsername")
            .lean();

        if (!interviews.length) {
            console.log("ℹ️ No interviews scheduled today — no reminder sent");
            return;
        }

        const fmtTime = (d) =>
            new Intl.DateTimeFormat("ru-RU", {
                timeZone: "Asia/Tashkent",
                hour: "2-digit",
                minute: "2-digit",
            }).format(new Date(d));

        const TRACK = { "frontend-react": "Frontend React", "backend-nodejs": "Backend Node" };
        const lines = [`📋 Собеседования сегодня (${interviews.length}):`, ""];
        for (const iv of interviews) {
            const a = iv.application || {};
            const name = `${a.firstName || ""} ${a.lastName || ""}`.trim() || "—";
            const tg = a.telegramUsername ? ` @${a.telegramUsername}` : "";
            lines.push(`• ${fmtTime(iv.scheduledAt)} — ${name} (${TRACK[iv.track] || iv.track})${tg}`);
        }

        const result = await sendMessage(chatIds, lines.join("\n"));
        console.log(`📋 Interview reminder: sent ${result.sent}, failed ${result.failed}`);
        if (result.errors?.length) console.warn("   errors:", result.errors.join(" | "));
    }

    async notifyMentorsWithDebt() {
        try {
            const activeInternIds = await Intern.find({ status: "active" }).distinct("_id");
            // Находим менторов, у которых есть неоценённые уроки активных стажёров.
            const pendingLessons = await Lesson.find({
                status: "pending",
                intern: { $in: activeInternIds },
            }).distinct("mentor");

            console.log(`📊 Found ${pendingLessons.length} mentors with pending lessons`);

            for (const mentorId of pendingLessons) {
                const debtCount = await Lesson.countDocuments({
                    mentor: mentorId,
                    status: "pending",
                    intern: { $in: activeInternIds },
                });

                if (debtCount === 0) continue;

                // Получаем подписки ментора
                const subscriptions = await Subscription.find({
                    userId: mentorId,
                    userType: { $in: ["mentor", "Mentor"] }
                });

                if (subscriptions.length === 0) {
                    console.log(`⚠️ Mentor ${mentorId} has ${debtCount} pending feedbacks but no push subscription`);
                    continue;
                }

                const payload = JSON.stringify({
                    title: "📚 Напоминание о фидбэках",
                    body: `У вас ${debtCount} неоценённых уроков. Пожалуйста, оставьте отзывы студентам.`
                });

                // Отправляем push каждой подписке ментора
                for (const sub of subscriptions) {
                    try {
                        const pushSubscription = {
                            endpoint: sub.endpoint,
                            keys: sub.keys
                        };

                        await webpush.sendNotification(pushSubscription, payload);
                        console.log(`✅ Push sent to mentor ${mentorId} (debt: ${debtCount})`);
                    } catch (err) {
                        // Удаляем устаревшие подписки
                        if (err.statusCode === 410 || err.statusCode === 404) {
                            console.warn(`⚠️ Removing expired subscription for mentor ${mentorId}`);
                            await Subscription.deleteOne({ _id: sub._id });
                        } else {
                            console.error(`❌ Failed to send push to mentor ${mentorId}:`, err.message);
                        }
                    }
                }
            }
        } catch (error) {
            console.error("❌ Error in notifyMentorsWithDebt:", error);
        }
    }

    async notifyInternsWithPendingLessons() {
        try {
            // Считаем дату 3 рабочих дня назад (воскресенье не считается)
            const cutoff = new Date();
            cutoff.setHours(0, 0, 0, 0);
            let workingDaysBack = 0;
            while (workingDaysBack < 3) {
                cutoff.setDate(cutoff.getDate() - 1);
                if (cutoff.getDay() !== 0) workingDaysBack++; // 0 = Sunday
            }

            // Интерны, у которых есть хотя бы один урок за последние 3 рабочих дня
            const activeInternIds = await Lesson.find({
                date: { $gte: cutoff },
            }).distinct("intern");

            // Замороженных и архивных не пинаем напоминаниями — их статус
            // явно говорит «не работает сейчас».
            const inactiveInternIds = await Intern.find({
                status: { $in: ["frozen", "archived"] },
            }).distinct("_id");

            // Все интерны с push-подписками, кроме активных
            const subscriptions = await Subscription.find({
                userType: { $in: ["intern", "Intern"] },
                userId: {
                    $nin: [...activeInternIds, ...inactiveInternIds],
                },
            });

            if (subscriptions.length === 0) {
                console.log("✅ All subscribed interns are active — no reminders needed");
                return;
            }

            // Группируем подписки по internId для одного лога на интерна
            const byIntern = {};
            for (const sub of subscriptions) {
                const id = sub.userId.toString();
                if (!byIntern[id]) byIntern[id] = [];
                byIntern[id].push(sub);
            }

            console.log(`📊 Found ${Object.keys(byIntern).length} inactive interns to notify`);

            const payload = JSON.stringify({
                title: "📅 Не забудь добавить урок",
                body: "Ты не добавлял уроки последние 3 рабочих дня. Не отставай от плана!",
            });

            for (const [internId, subs] of Object.entries(byIntern)) {
                for (const sub of subs) {
                    try {
                        await webpush.sendNotification(
                            { endpoint: sub.endpoint, keys: sub.keys },
                            payload
                        );
                        console.log(`✅ Reminder sent to intern ${internId}`);
                    } catch (err) {
                        if (err.statusCode === 410 || err.statusCode === 404) {
                            console.warn(`⚠️ Removing expired subscription for intern ${internId}`);
                            await Subscription.deleteOne({ _id: sub._id });
                        } else {
                            console.error(`❌ Failed to send push to intern ${internId}:`, err.message);
                        }
                    }
                }
            }
        } catch (error) {
            console.error("❌ Error in notifyInternsWithPendingLessons:", error);
        }
    }

    async resetExpiredManualActivations() {
        const now = new Date();
        // Найти интернов, у которых isEnabled=true, но enabledAt в прошлом месяце или раньше
        const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const result = await Intern.updateMany(
            {
                "manualActivation.isEnabled": true,
                "manualActivation.enabledAt": { $lt: startOfCurrentMonth },
            },
            {
                $set: {
                    "manualActivation.isEnabled": false,
                    "manualActivation.note": "",
                    "manualActivation.enabledAt": null,
                    "manualActivation.enabledBy": null,
                },
            }
        );

        console.log(`✅ Reset manual activation for ${result.modifiedCount} intern(s)`);
    }
}

module.exports = new CronService();
