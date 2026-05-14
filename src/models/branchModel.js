const mongoose = require('mongoose');

const branchSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  city: { type: String },
  address: { type: String },
  location: {
    lat: { type: Number, min: -90, max: 90 },
    lng: { type: Number, min: -180, max: 180 },
  },
  telegramLink: { type: String },
  branchManager: { type: mongoose.Schema.Types.ObjectId, ref: 'Mentor', default: null },
  interviews: {}
}, { timestamps: true });

module.exports = mongoose.model('Branch', branchSchema);
