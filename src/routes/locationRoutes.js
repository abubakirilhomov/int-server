const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const ctrl = require("../controllers/locationController");
router.post("/update", auth, ctrl.updateLocation);
router.delete("/stop", auth, ctrl.stopSharing);
router.get("/my-interns", auth, ctrl.getMentorInternLocations);
module.exports = router;
