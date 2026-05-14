const express = require("express");
const rateLimit = require("express-rate-limit");

const router = express.Router();

const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");
const validateRequest = require("../middleware/validateRequest");
const {
  submitApplicationSchema,
  updateStatusSchema,
} = require("../validations/applicationValidation");
const controller = require("../controllers/applicationController");

// Stricter rate-limit for the public submit endpoint (5/h per IP).
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Слишком много заявок с этого IP. Попробуйте через час.",
  },
});

// Public form data (branches/mentors/spheres/shifts) — slightly looser limit.
const formDataLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много запросов. Попробуйте через минуту." },
});

// ─── PUBLIC ───────────────────────────────────────────────────────────────────
router.get("/form-data", formDataLimiter, controller.getFormData);
router.post(
  "/",
  submitLimiter,
  validateRequest(submitApplicationSchema),
  controller.submit
);

// ─── ADMIN ────────────────────────────────────────────────────────────────────
router.get("/", auth, isAdmin, controller.list);
router.get("/:id", auth, isAdmin, controller.getOne);
router.patch(
  "/:id/status",
  auth,
  isAdmin,
  validateRequest(updateStatusSchema),
  controller.updateStatus
);
router.post("/:id/convert", auth, isAdmin, controller.convert);
router.post("/:id/retry-notify", auth, isAdmin, controller.retryNotify);

module.exports = router;
