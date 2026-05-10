const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
const controller = require('../controllers/branchController');

router.get('/', auth, controller.getBranches);
router.post('/', auth, isAdmin, controller.createBranch);
router.put('/:id', auth, isAdmin, controller.updateBranch);
router.delete('/:id', auth, isAdmin, controller.deleteBranch);

module.exports = router;
