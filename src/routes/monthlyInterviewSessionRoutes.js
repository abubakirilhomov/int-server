const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const isHeadIntern = require("../middleware/isHeadIntern");
const controller = require("../controllers/monthlyInterviewSessionController");

// Head intern endpointlari
router.post("/", auth, isHeadIntern, controller.create);
router.get("/current", auth, isHeadIntern, controller.getCurrent);
router.post("/:id/finalize", auth, isHeadIntern, controller.finalizeNow);

// Intern endpointlari — token orqali, isHeadIntern shart emas
router.get("/token/:token", auth, controller.getByToken);
router.post("/token/:token/join", auth, controller.join);
router.post("/token/:token/excuse", auth, controller.excuse);
router.post("/token/:token/heartbeat", auth, controller.heartbeat);
router.post("/token/:token/leave", auth, controller.leave);

module.exports = router;
