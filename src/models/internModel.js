const mongoose = require('mongoose');

const internSchema = new mongoose.Schema({
  name: { type: String, required: true },
  lastName: { type: String, required: true },
  branch: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Branch', 
    required: true 
  },
  score: { 
    type: Number, 
    default: 0 
  },
  mentorsEvaluated: {
    type: Map,
    of: Boolean, // Key = mentorId, value = true (indicates mentor has evaluated)
    default: {}
  },
  feedbacks: [
    {
      mentorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Mentor' },
      feedback: String,
      stars: { type: Number, min: 1, max: 5 },
      date: { type: Date, default: Date.now }
    }
  ],
  lessonsVisited: {
    type: Map,
    of: Number,
    default: {}
  },
  grade: {
    type: String,
    enum: ['junior', 'middle', 'senior'],
    default: 'junior'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Intern', internSchema);