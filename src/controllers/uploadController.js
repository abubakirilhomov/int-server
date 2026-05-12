const streamifier = require("streamifier");
const cloudinary = require("../config/cloudinary");

const allowedFolders = new Set([
  "interns",
  "mentors",
  "profiles",
  "branch-managers",
]);

const uploadImage = async (req, res) => {
  try {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return res.status(500).json({
        success: false,
        message: "Cloudinary не настроен. Добавьте CLOUDINARY_* переменные в .env",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Файл обязателен",
      });
    }

    const requestedFolder = String(req.body?.folder || "profiles").trim();
    const folder = allowedFolders.has(requestedFolder) ? requestedFolder : "profiles";

    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `intern-system/${folder}`,
          resource_type: "image",
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        }
      );

      streamifier.createReadStream(req.file.buffer).pipe(stream);
    });

    return res.status(201).json({
      success: true,
      message: "Файл успешно загружен",
      data: {
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        width: uploadResult.width,
        height: uploadResult.height,
        format: uploadResult.format,
      },
    });
  } catch (error) {
    console.error("Upload error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка загрузки файла",
    });
  }
};

module.exports = {
  uploadImage,
};
