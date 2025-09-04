const express = require("express");
const { createRule, getRules } = require("../controllers/rulesController");
const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");

const router = express.Router();
router.use(auth);

router.post("/", isAdmin, createRule);
router.get("/", getRules);

module.exports = router;