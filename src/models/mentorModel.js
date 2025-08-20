const mongoose = require('mongoose');

const mentorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  password: { type: String, required: true },
  branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
  role: {
    type: String,
    enum: ['mentor', 'admin'],
    default: 'mentor'
  }
});

module.exports = mongoose.model('Mentor', mentorSchema);
