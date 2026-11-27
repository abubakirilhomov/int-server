const express = require("express");
const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");
const ctrl = require("../controllers/questionBankController");

const router = express.Router();
router.use(auth, isAdmin);
router.get("/stats", ctrl.stats);
router.get("/questions", ctrl.listQuestions);
router.get("/sets", ctrl.listSets);

module.exports = router;
