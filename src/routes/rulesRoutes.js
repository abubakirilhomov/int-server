const express = require("express");
const { createRule, getRules, deleteRule } = require("../controllers/rulesController");
const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");

const router = express.Router();
router.use(auth);

router.post("/", isAdmin, createRule);
router.get("/", getRules);
router.delete("/:id", isAdmin, deleteRule);

module.exports = router;