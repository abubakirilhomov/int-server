const express = require('express');
const router = express.Router();
const lessonCtrl = require("../controllers/lessonController.js")
const auth = require('../middleware/auth.js');
const isAdmin = require('../middleware/isAdmin.js');
router.use(auth)

router.post("/", auth, lessonCtrl.createLesson);
router.get("/", auth, lessonCtrl.getLessons);
router.get("/:id", auth, lessonCtrl.getLessonById);
router.put("/:id", auth, isAdmin, lessonCtrl.updateLesson);
router.delete("/:id", auth, isAdmin, lessonCtrl.deleteLesson);

module.exports = router;
