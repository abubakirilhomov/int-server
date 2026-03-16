const express = require("express");
const auth = require("../middleware/auth");
const upload = require("../middleware/upload");
const { uploadImage } = require("../controllers/uploadController");

const router = express.Router();

router.use(auth);
router.post("/image", upload.single("file"), uploadImage);

module.exports = router;
