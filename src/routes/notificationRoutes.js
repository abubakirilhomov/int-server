const express = require("express");
const router = express.Router();
const { subscribeUser } = require("../controllers/notificationController");

router.post("/subscribe", subscribeUser);

module.exports = router;
