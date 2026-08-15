const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const isHeadIntern = require("../middleware/isHeadIntern");
const controller = require("../controllers/monthlyInterviewController");

// Head intern endpointlari
router.get("/", auth, isHeadIntern, controller.list);
router.get("/status", auth, isHeadIntern, controller.status);
router.post("/conduct", auth, isHeadIntern, controller.conduct);
router.get("/:id", auth, isHeadIntern, controller.getOne);

// Intern o'z natijalarini ko'radi
router.get("/me", auth, controller.myInterviews);

module.exports = router;