const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");
const {
  subscribeUser,
  testNotification,
  clearAllSubscriptions,
} = require("../controllers/notificationController");

// 📩 Получение подписки от клиента (для себя — userId берётся из токена)
router.post("/subscribe", auth, subscribeUser);

// 🧪 Тестовая отправка уведомления — только админ
router.post("/test", auth, isAdmin, testNotification);

// 🧹 Очистка подписок — только админ
router.delete("/clear", auth, isAdmin, clearAllSubscriptions);

module.exports = router;
