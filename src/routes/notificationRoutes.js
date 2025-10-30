const express = require("express");
const router = express.Router();
const {
  subscribeUser,
  testNotification,
  clearAllSubscriptions,
} = require("../controllers/notificationController");

// 📩 Получение подписки от клиента
router.post("/subscribe", subscribeUser);

// 🧪 Тестовая отправка уведомления
router.post("/test", testNotification);

// 🧹 Очистка подписок
router.delete("/clear", clearAllSubscriptions);

module.exports = router;
