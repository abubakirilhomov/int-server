const multer = require("multer");
const AppError = require("../utils/AppError");

const storage = multer.memoryStorage();

const imageFileFilter = (req, file, cb) => {
  if (file.mimetype && file.mimetype.startsWith("image/")) {
    return cb(null, true);
  }
  // Operational error so the message reaches the client (not a generic 500).
  cb(new AppError("Разрешены только изображения", 400));
};

const upload = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

module.exports = upload;
