const webpush = require("web-push");
const NotificationSubscription = require("../models/notificationModel");

webpush.setVapidDetails(
  "mailto:test@example.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
  "https://mentors-mars.uz"
);

// 📩 Сохранение подписки от клиента
const subscribeUser = async (req, res) => {
  try {
    const { subscription, userId, userType } = req.body;

    await NotificationSubscription.findOneAndUpdate(
      { userId, userType },
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      { upsert: true, new: true }
    );

    res.status(201).json({ success: true });
  } catch (err) {
    console.error("Ошибка при сохранении подписки:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// 🚀 Отправка уведомления конкретному пользователю
const sendNotificationToUser = async (userId, userType, title, body) => {
  try {
    const subscription = await NotificationSubscription.findOne({ userId, userType });
    if (!subscription) {
      console.log(`❌ Нет подписки для ${userType} ${userId}`);
      return;
    }

    const payload = JSON.stringify({ title, body });

    await webpush.sendNotification(subscription, payload);
    console.log(`📨 Уведомление отправлено пользователю ${userId}`);
  } catch (err) {
    console.error("Ошибка при отправке уведомления:", err.message);
  }
};

module.exports = {
  subscribeUser,
  sendNotificationToUser,
};
