const express = require('express');
const router = express.Router();
const controller = require('../controllers/mentorController');
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');

router.post('/', auth, controller.createMentor);
router.get('/', auth, isAdmin, controller.getMentors);
router.delete('/:id', auth, isAdmin, controller.deleteMentor);
router.post('/login', controller.loginMentor);
router.post("/refresh-token", controller.refreshMentorToken);


module.exports = router;
