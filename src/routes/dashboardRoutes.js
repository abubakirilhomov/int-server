const router = require("express").Router();
const { getDashboardStats } = require("../controllers/dashboardController");
const { getAnalytics } = require("../controllers/adminAnalyticsController");
const authMiddleware = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");

router.get("/stats", authMiddleware, getDashboardStats);
router.get("/analytics", authMiddleware, isAdmin, getAnalytics);

module.exports = router;
