const mongoose = require("mongoose");
const locationSchema = new mongoose.Schema({
  intern: { type: mongoose.Schema.Types.ObjectId, ref: "Intern", required: true, unique: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  updatedAt: { type: Date, default: Date.now },
});
locationSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 1200 }); // TTL 20 min
module.exports = mongoose.model("Location", locationSchema);
