const jwt = require("jsonwebtoken");
const RevokedToken = require("../models/revokedTokenModel");

const auth = async (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Нет токена" });
  }

  const token = header.split(" ")[1];

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ message: "Неверный токен" });
  }

  if (decoded.jti) {
    const revoked = await RevokedToken.exists({ jti: decoded.jti });
    if (revoked) {
      return res.status(401).json({ message: "Токен отозван" });
    }
  }

  req.user = decoded;
  next();
};

module.exports = auth;
