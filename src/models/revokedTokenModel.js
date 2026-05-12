const mongoose = require("mongoose");

const revokedTokenSchema = new mongoose.Schema(
  {
    jti: { type: String, required: true, unique: true, index: true },
    // TTL: MongoDB drops the document at the moment stored in `exp`.
    exp: { type: Date, required: true, index: { expires: 0 } },
    userId: { type: String, default: null },
    userType: { type: String, enum: ["intern", "mentor", "admin"], default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("RevokedToken", revokedTokenSchema);
