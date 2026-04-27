const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/marsIdAuthController");
const authMiddleware = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");

router.get("/status", ctrl.status);
router.get("/start", ctrl.start);
router.get("/callback", ctrl.callback);
router.post("/link", ctrl.link);
router.post("/unlink", authMiddleware, isAdmin, ctrl.unlink);

module.exports = router;
