const express = require('express');
const router = express.Router();
const internCtrl = require('../controllers/internController');
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');

router.get('/rating', auth, internCtrl.getInternsRating);
router.get('/client-rating', auth, internCtrl.getRatings)
router.get('/pending-interns', auth, internCtrl.getPendingInterns)
router.post('/', auth, isAdmin, internCtrl.createIntern);
router.post('/login', internCtrl.loginIntern);
router.post("/refresh-token", internCtrl.refreshToken);
router.get('/', auth, internCtrl.getInterns); // доступен и админу, и ментору
router.put('/:id', auth, isAdmin, internCtrl.updateIntern);
router.delete('/:id', auth, isAdmin, internCtrl.deleteIntern);
router.post('/:id/rate', auth, internCtrl.rateIntern); // ментор может оценивать
router.post('/:id/lessons', auth, internCtrl.addLessonVisit); // ментор может отмечать уроки
router.get('/:id', auth, internCtrl.getInternProfile); // ментор может отмечать уроки
router.patch("/:id/upgrade", auth, internCtrl.upgradeInternGrade);

module.exports = router;
