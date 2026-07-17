const express = require("express");
const router = express.Router();
const badgeCtrl = require("../controllers/badgeController");
const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");
const isReception = require("../middleware/isReception");
const validateRequest = require("../middleware/validateRequest");
const {
  toggleBadgeSchema,
  closeDaySchema,
  setStockSchema,
} = require("../validations/badgeValidation");

// Ресепшен (administrator своего филиала) или админ.
router.get("/board", auth, isReception, badgeCtrl.board);
router.post("/close", auth, isReception, validateRequest(closeDaySchema), badgeCtrl.closeDay);
router.get("/interns/:internId/history", auth, isReception, badgeCtrl.internHistory);
router.patch(
  "/interns/:internId",
  auth,
  isReception,
  validateRequest(toggleBadgeSchema),
  badgeCtrl.toggleBadge
);

// Только админ.
router.get("/report", auth, isAdmin, badgeCtrl.report);
router.patch("/stock", auth, isAdmin, validateRequest(setStockSchema), badgeCtrl.setStock);

module.exports = router;
