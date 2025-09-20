const express = require('express');
const bookingCtrl = require("../controllers/bookingController")
const router = express.Router();

router.post("/register", bookingCtrl.registerInterview);
router.get("/", bookingCtrl.getAllInterviews);
router.get("/skills", bookingCtrl.getSkillsByDirection);   // ?direction=Frontend|Backend|Fullstack
router.post("/difficulty", bookingCtrl.getDifficulty);
// принимает { skills: [] }
module.exports = router;
