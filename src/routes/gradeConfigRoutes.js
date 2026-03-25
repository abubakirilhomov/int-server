const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");
const ctrl = require("../controllers/gradeConfigController");
router.get("/", auth, ctrl.getAll);
router.put("/:grade", auth, isAdmin, ctrl.update);
module.exports = router;
