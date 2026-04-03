const express = require('express');
const router = express.Router();
const internCtrl = require('../controllers/internController');
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
const isHeadIntern = require('../middleware/isHeadIntern');
const validateRequest = require('../middleware/validateRequest');
const { createInternSchema } = require('../validations/internValidation');

router.get('/rating', auth, internCtrl.getInternsRating);
router.get('/client-rating', auth, internCtrl.getRatings)
router.get('/pending-interns', auth, internCtrl.getPendingInterns)
router.get('/branch-manager/interns', auth, internCtrl.getBranchManagerInterns);
router.post('/', auth, isAdmin, validateRequest(createInternSchema), internCtrl.createIntern);
router.post('/login', internCtrl.loginIntern);
router.post("/refresh-token", internCtrl.refreshToken);
router.patch("/me/profile", auth, internCtrl.updateOwnProfile);
router.patch("/me/password", auth, internCtrl.changePassword);
router.get('/', auth, internCtrl.getInterns); // доступен и админу, и ментору
router.put('/:id', auth, isAdmin, internCtrl.updateIntern);
router.delete('/:id', auth, isAdmin, internCtrl.deleteIntern);
router.post('/:id/rate', auth, internCtrl.rateIntern); // ментор может оценивать
router.post('/:id/lessons', auth, internCtrl.addLessonVisit); // ментор может отмечать уроки
router.get('/:id', auth, internCtrl.getInternProfile);
router.patch("/:id/upgrade", auth, isAdmin, internCtrl.upgradeInternGrade);
router.patch("/:id/bonus-lessons", auth, isAdmin, internCtrl.addBonusLessons);
router.patch("/:id/head-intern", auth, isAdmin, internCtrl.setHeadIntern);
router.patch("/:id/activation", auth, isAdmin, internCtrl.setInternActivation);
router.post("/:id/reset-password", auth, isAdmin, internCtrl.resetPassword);
router.post("/:id/warnings", auth, isHeadIntern, internCtrl.headInternWarning);
router.post("/:id/complaints", auth, internCtrl.addBranchManagerComplaint);

module.exports = router;
