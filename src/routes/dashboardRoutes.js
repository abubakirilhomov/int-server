const router = require("express").Router();
const { getDashboardStats } = require("../controllers/dashboardController");
const authMiddleware = require("../middleware/auth");

router.get("/stats", authMiddleware, getDashboardStats);

module.exports = router;
