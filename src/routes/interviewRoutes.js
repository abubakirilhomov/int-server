const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");
const controller = require("../controllers/interviewController");
const live = require("../controllers/liveInterviewController");

// Все эндпоинты интервью — только админ.
router.use(auth, isAdmin);

router.get("/", controller.list);
router.post("/schedule", controller.schedule);

// Живые собеседования по банку (этап 2). Статичные пути — до /:id.
router.get("/live/sets", live.listSets);
router.post("/live/sets/preview", live.previewSet);
router.get("/live/sets/overview", live.setsOverview);
router.get("/live/history", live.setHistory);
router.post("/:id/live", live.start);
router.get("/:id/live", live.getLive);
router.post("/:id/live/questions/:code/:action", live.questionAction);
router.patch("/:id/live/questions/:code", live.rateQuestion);
router.post("/:id/live/access/:action", live.accessAction);
router.post("/:id/live/finish", live.finish);

router.get("/:id", controller.getOne);
router.patch("/:id/status", controller.updateStatus);
router.patch("/:id/reschedule", controller.reschedule);
router.patch("/:id/score", controller.score);
router.get("/:id/letter", controller.letter);

module.exports = router;
