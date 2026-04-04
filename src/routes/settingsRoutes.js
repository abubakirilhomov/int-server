const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");
const ctrl = require("../controllers/settingsController");

router.get("/", ctrl.getSettings);
router.put("/", auth, isAdmin, ctrl.updateSettings);

module.exports = router;
