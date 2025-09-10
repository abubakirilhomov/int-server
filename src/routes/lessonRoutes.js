const express = require('express');
const router = express.Router();
const lessonCtrl = require("../controllers/lessonController.js");
const auth = require('../middleware/auth.js');
const isAdmin = require('../middleware/isAdmin.js');

router.use(auth);

router.post("/", lessonCtrl.createLesson);
router.get("/", lessonCtrl.getLessons);
router.get("/attendance-stats", lessonCtrl.getAttendanceStats);
router.get("/:id", lessonCtrl.getLessonById);
router.put("/:id", isAdmin, lessonCtrl.updateLesson);
router.delete("/:id", isAdmin, lessonCtrl.deleteLesson);

module.exports = router;