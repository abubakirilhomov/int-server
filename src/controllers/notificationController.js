const webpush = require("web-push");
const Subscription = require("../models/subscriptionModel");

// ✅ Настройка Web Push с доменом твоего фронтенда
webpush.setVapidDetails(
  "mailto:test@example.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/**
 * 📩 Сохранение или обновление подписки пользователя
 * Вызывается с фронтенда после логина
 */
const subscribeUser = async (req, res) => {
  try {
    const { subscription, userId, userType } = req.body;

    if (!subscription || !userId || !userType) {
      return res
        .status(400)
        .json({ success: false, message: "Некорректные данные подписки" });
    }

    // 🔹 Сохраняем или обновляем подписку (по endpoint для уникальности)
    const updatedSub = await Subscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        userId,
        userType,
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      { upsert: true, new: true }
    );

    console.log(`✅ Подписка сохранена для ${userType}: ${userId}`);
    res.status(201).json({ success: true, data: updatedSub });
  } catch (err) {
    console.error("❌ Ошибка при сохранении подписки:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * 🚀 Отправка уведомления конкретному пользователю
 * Используется, например, когда интерн добавляет урок → уведомить ментора
 */
const sendNotificationToUser = async (userId, userType, title, body) => {
  try {
    const subscription = await Subscription.findOne({ userId, userType });

    if (!subscription) {
      console.log(`❌ Нет активной подписки для ${userType} ${userId}`);
      return;
    }

    const payload = JSON.stringify({ title, body });

    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: subscription.keys
    };

    await webpush.sendNotification(pushSubscription, payload);
    console.log(`📨 Уведомление отправлено пользователю ${userId}`);
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      console.warn(`⚠️ Подписка устарела, удаляю ${userType} ${userId}`);
      await Subscription.deleteOne({ userId, userType });
    } else {
      console.error("Ошибка при отправке уведомления:", err.message);
    }
  }
};

/**
 * 🧪 Тестовая отправка уведомления (через Postman или панель админа)
 * POST /api/notifications/test
 * body: { userId, userType, title, body }
 */
const testNotification = async (req, res) => {
  try {
    const { userId, userType, title, body } = req.body;

    if (!userId || !userType || !title || !body) {
      return res.status(400).json({ message: "Не хватает параметров" });
    }

    await sendNotificationToUser(userId, userType, title, body);
    res.json({ success: true, message: "Уведомление отправлено" });
  } catch (err) {
    console.error("Ошибка при тестовой отправке:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * 🚮 Очистка всех подписок (например, для админки)
 * DELETE /api/notifications/clear
 */
const clearAllSubscriptions = async (req, res) => {
  try {
    await Subscription.deleteMany({});
    console.log("🧹 Все подписки удалены");
    res.json({ success: true, message: "Все подписки очищены" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  subscribeUser,
  sendNotificationToUser,
  testNotification,
  clearAllSubscriptions,
};
