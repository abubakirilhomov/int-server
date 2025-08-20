const express = require('express');
const router = express.Router();
const controller = require('../controllers/mentorController');
// const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
// router.use(auth)
router.post('/', controller.createMentor);
router.get('/', controller.getMentors);
router.delete('/:id', isAdmin, controller.deleteMentor);
router.post('/login', controller.loginMentor);


module.exports = router;
