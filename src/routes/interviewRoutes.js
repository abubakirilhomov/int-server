const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");
const controller = require("../controllers/interviewController");

// Все эндпоинты интервью — только админ.
router.use(auth, isAdmin);

router.get("/", controller.list);
router.post("/schedule", controller.schedule);
router.get("/:id", controller.getOne);
router.patch("/:id/status", controller.updateStatus);
router.patch("/:id/reschedule", controller.reschedule);

module.exports = router;
