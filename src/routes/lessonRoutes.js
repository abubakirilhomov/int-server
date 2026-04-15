const express = require('express');
const router = express.Router();
const lessonCtrl = require("../controllers/lessonController.js");
const internCtrl = require("../controllers/internController.js");
const auth = require('../middleware/auth.js');
const isAdmin = require('../middleware/isAdmin.js');

router.use(auth);

router.post("/", lessonCtrl.createLesson);
router.get("/", lessonCtrl.getLessons);
router.get("/attendance-stats", lessonCtrl.getAttendanceStats);
router.get("/pending", lessonCtrl.getPendingLessons);
router.get("/pending-feedback", lessonCtrl.getPendingFeedback);
router.get("/stuck-feedbacks", isAdmin, lessonCtrl.getStuckFeedbacks);
router.patch("/rate", internCtrl.rateIntern);
router.patch("/:id/intern-feedback", lessonCtrl.submitInternFeedback);
router.post("/:id/force-feedback", isAdmin, lessonCtrl.forceCloseInternFeedback);
router.get("/:id", lessonCtrl.getLessonById);
router.put("/:id", isAdmin, lessonCtrl.updateLesson);
router.delete("/:id", isAdmin, lessonCtrl.deleteLesson);

module.exports = router;