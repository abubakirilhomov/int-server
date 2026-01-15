const cron = require("node-cron");
const webpush = require("web-push");
const Mentor = require("../models/mentorModel");
const Lesson = require("../models/lessonModel");
const Subscription = require("../models/subscriptionModel");

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
        // Запуск каждый день в 10:00 утра
        cron.schedule("0 10 * * *", async () => {
            console.log("🔔 Running daily notification job...");
            try {
                await this.notifyMentorsWithDebt();
                await this.notifyInternsWithPendingLessons();
            } catch (error) {
                console.error("❌ Error in daily cron job:", error);
            }
        });

        console.log("✅ Cron jobs initialized (daily at 10:00 AM)");
    }

    async notifyMentorsWithDebt() {
        try {
            // Находим менторов, у которых есть неоценённые уроки (статус pending)
            const pendingLessons = await Lesson.find({ status: "pending" }).distinct("mentor");

            console.log(`📊 Found ${pendingLessons.length} mentors with pending lessons`);

            for (const mentorId of pendingLessons) {
                const debtCount = await Lesson.countDocuments({
                    mentor: mentorId,
                    status: "pending"
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
        // Логика напоминания интернам (если нужно в будущем)
        console.log("💡 Notifying interns about pending lessons (placeholder)");
    }
}

module.exports = new CronService();
