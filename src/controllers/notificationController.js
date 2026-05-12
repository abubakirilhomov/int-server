const webpush = require("web-push");
const Subscription = require("../models/subscriptionModel");
const catchAsync = require("../utils/catchAsync");

webpush.setVapidDetails(
  "mailto:test@example.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const subscribeUser = catchAsync(async (req, res) => {
  const { subscription, userId, userType } = req.body;

  if (!subscription || !userId || !userType) {
    return res
      .status(400)
      .json({ success: false, message: "Некорректные данные подписки" });
  }

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

  res.status(201).json({ success: true, data: updatedSub });
});

const sendNotificationToUser = async (userId, userType, title, body) => {
  try {
    const subscription = await Subscription.findOne({ userId, userType });
    if (!subscription) return;

    const payload = JSON.stringify({ title, body });
    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
    };

    await webpush.sendNotification(pushSubscription, payload);
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      await Subscription.deleteOne({ userId, userType });
    } else {
      console.error("Ошибка при отправке уведомления:", err.message);
    }
  }
};

const testNotification = catchAsync(async (req, res) => {
  const { userId, userType, title, body } = req.body;

  if (!userId || !userType || !title || !body) {
    return res.status(400).json({ message: "Не хватает параметров" });
  }

  await sendNotificationToUser(userId, userType, title, body);
  res.json({ success: true, message: "Уведомление отправлено" });
});

const clearAllSubscriptions = catchAsync(async (req, res) => {
  await Subscription.deleteMany({});
  res.json({ success: true, message: "Все подписки очищены" });
});

module.exports = {
  subscribeUser,
  sendNotificationToUser,
  testNotification,
  clearAllSubscriptions,
};
