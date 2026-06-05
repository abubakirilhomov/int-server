const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");
const ctrl = require("../controllers/interviewTopicController");

// Банк тем — внутренний инструмент, только админ.
router.use(auth, isAdmin);

router.get("/", ctrl.list);
router.post("/", ctrl.create);
router.patch("/:id", ctrl.update);
router.delete("/:id", ctrl.remove);

module.exports = router;
