const express = require("express");
const { registerStepTwo, registerStepOne, getAllBookingInterns, getBookingInternsId, loginUser, updateInternStatus, addProjectLink } = require("../controllers/BookingController");


const router = express.Router();

router.post("/stepOne", registerStepOne);
router.post("/stepTwo", registerStepTwo);
router.post("/login", loginUser);
router.put("/update-status/:id", updateInternStatus);
router.post("/add-link/:bookingID", addProjectLink);
router.get("/:id", getBookingInternsId);
router.get("/", getAllBookingInterns);


module.exports = router;
