const express = require("express");
const router = express.Router();

const complaintCtrl = require("../controllers/complaintController");
const auth = require("../middleware/auth");
const isAdmin = require("../middleware/isAdmin");

// Жалобы пишут branch manager'ы и админы (POST /api/interns/:id/complaints),
// а разбирает их админ — поэтому весь роутер под isAdmin, как violationRoutes.
router.use(auth);
router.use(isAdmin);

router.get("/", complaintCtrl.getComplaints);
router.patch("/:internId/:complaintId/status", complaintCtrl.setComplaintStatus);

module.exports = router;
