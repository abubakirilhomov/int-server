const express = require('express');
const router = express.Router();
const internCtrl = require('../controllers/internController');
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
router.use(auth)

router.post('/', auth, isAdmin, internCtrl.createIntern);
router.get('/', auth, internCtrl.getInterns); // доступен и админу, и ментору
router.put('/:id', auth, isAdmin, internCtrl.updateIntern);
router.delete('/:id', auth, isAdmin, internCtrl.deleteIntern);
router.post('/:id/rate', auth, internCtrl.rateIntern); // ментор может оценивать
router.post('/:id/lessons', auth, internCtrl.addLessonVisit); // ментор может отмечать уроки

module.exports = router;
