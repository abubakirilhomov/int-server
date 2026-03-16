const mongoose = require('mongoose');

const mentorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  lastName: { type: String, required: false },
  profilePhoto: { type: String, trim: true, default: "" },
  password: { type: String, required: true, select: false },
  branches: [{ type: mongoose.Schema.Types.ObjectId, ref: "Branch" }],
  role: {
    type: String,
    enum: ['mentor', 'admin', 'branchManager'],
    default: 'mentor'
  },
  createdAt: { type: Date, default: Date.now }
});

// Virtual for backward compatibility
mentorSchema.virtual("branch").get(function () {
  return this.branches?.[0] || null;
});

module.exports = mongoose.model('Mentor', mentorSchema);
