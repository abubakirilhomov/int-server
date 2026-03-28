const express = require("express");
const router = express.Router();
const criteriaCtrl = require("../controllers/lessonCriteriaController");
const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");

// Public — interns also need to fetch criteria
router.get("/", criteriaCtrl.getCriteria);

// Admin only
router.post("/", auth, isAdmin, criteriaCtrl.createCriteria);
router.patch("/:id", auth, isAdmin, criteriaCtrl.updateCriteria);
router.delete("/:id", auth, isAdmin, criteriaCtrl.deleteCriteria);

module.exports = router;
