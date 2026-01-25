const express = require('express');
const router = express.Router();
const violationCtrl = require('../controllers/violationController');
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');

router.use(auth);
router.use(isAdmin); // Только админы могут видеть общую статистику нарушений

router.get('/', violationCtrl.getViolations);

module.exports = router;
