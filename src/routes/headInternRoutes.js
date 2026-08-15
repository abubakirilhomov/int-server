const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const isHeadIntern = require("../middleware/isHeadIntern");
const controller = require("../controllers/headInternController");

// Head intern endpointlari — faqat head intern
router.get("/interns/activity", auth, isHeadIntern, controller.getInternsActivity);
router.get("/interns", auth, isHeadIntern, controller.getBranchInterns);

module.exports = router;