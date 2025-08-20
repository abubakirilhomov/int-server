const express = require('express');
const router = express.Router();
const controller = require('../controllers/branchController');

router.post('/', controller.createBranch);
router.get('/', controller.getBranches);
router.delete('/:id', controller.deleteBranch);

module.exports = router;
