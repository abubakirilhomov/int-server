const Intern = require('../models/internModel');

exports.createIntern = async (req, res) => {
  const intern = await Intern.create(req.body);
  res.json(intern);
};

exports.getInterns = async (req, res) => {
  const filter = req.query.branch ? { branch: req.query.branch } : {};
  const interns = await Intern.find(filter);
  res.json(interns);
};

exports.updateIntern = async (req, res) => {
  const intern = await Intern.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(intern);
};

exports.deleteIntern = async (req, res) => {
  await Intern.findByIdAndDelete(req.params.id);
  res.sendStatus(204);
};

exports.rateIntern = async (req, res) => {
  const { mentorId, stars, feedback } = req.body;
  const intern = await Intern.findById(req.params.id);
  const now = new Date();

  const lastFeedback = intern.feedbacks.find(fb =>
    fb.mentorId.toString() === mentorId &&
    new Date(fb.date).getMonth() === now.getMonth() &&
    new Date(fb.date).getFullYear() === now.getFullYear()
  );

  if (lastFeedback) {
    return res.status(400).json({ message: 'Можно оценить только раз в месяц' });
  }

  intern.feedbacks.push({ mentorId, stars, feedback, date: now });
  intern.score += stars;
  await intern.save();

  res.json(intern);
};

exports.addLessonVisit = async (req, res) => {
  const { month, count } = req.body; // month = "2025-08"
  const intern = await Intern.findById(req.params.id);

  intern.lessonsVisited.set(month, (intern.lessonsVisited.get(month) || 0) + count);
  await intern.save();

  res.json(intern);
};
