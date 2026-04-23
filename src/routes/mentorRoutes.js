const express = require("express");
const router = express.Router();
const mentorController = require("../controllers/mentorController");
const authMiddleware = require("../middleware/auth");
const isAdmin = require('../middleware/isAdmin');

router.post('/', authMiddleware, isAdmin, mentorController.createMentor);
router.get('/', authMiddleware, mentorController.getMentors);
router.put('/:id', authMiddleware, isAdmin, mentorController.updateMentor);
router.delete('/:id', authMiddleware, isAdmin, mentorController.deleteMentor);
router.post('/:id/reset-password', authMiddleware, isAdmin, mentorController.resetPassword);
router.post('/login', mentorController.loginMentor);
router.post("/refresh-token", mentorController.refreshMentorToken);
router.patch("/me/password", authMiddleware, mentorController.changePassword);

router.get("/:id/stats", authMiddleware, mentorController.getMentorStats);

// Admin-only routes for debt tracking
router.get("/debt/all", authMiddleware, isAdmin, mentorController.getAllMentorsDebt);
router.get("/:id/debt-details", authMiddleware, isAdmin, mentorController.getMentorDebtDetails);

// Admin-only routes for mentor/intern activity overview
router.get("/with-activity", authMiddleware, isAdmin, mentorController.getMentorsActivity);
router.get("/:id/interns-activity", authMiddleware, isAdmin, mentorController.getInternsActivity);

module.exports = router;
