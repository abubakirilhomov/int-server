const mongoose = require('mongoose');

const mentorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  lastName: { type: String, required: false },
  profilePhoto: { type: String, trim: true, default: "" },
  password: { type: String, required: true, select: false },
  branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
  role: {
    type: String,
    enum: ['mentor', 'admin', 'branchManager'],
    default: 'mentor'
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Mentor', mentorSchema);
