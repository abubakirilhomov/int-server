const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");
const isHeadIntern = require("../middleware/isHeadIntern");
const resolveActiveBranch = require("../middleware/resolveActiveBranch");
const validateRequest = require("../middleware/validateRequest");

const {
  submitSchema,
  approveSchema,
} = require("../validations/internRequestValidation");
const ctrl = require("../controllers/internRequestController");

// Head intern submits / lists own requests
router.post(
  "/",
  auth,
  resolveActiveBranch,
  isHeadIntern,
  validateRequest(submitSchema),
  ctrl.submit
);
router.get("/mine", auth, resolveActiveBranch, isHeadIntern, ctrl.listMine);

// Admin review queue
router.get("/", auth, isAdmin, ctrl.listForAdmin);
router.patch(
  "/:id/approve",
  auth,
  isAdmin,
  validateRequest(approveSchema),
  ctrl.approve
);
router.patch("/:id/reject", auth, isAdmin, ctrl.reject);

module.exports = router;
