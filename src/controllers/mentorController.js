const Mentor = require("../models/mentorModel");
const jwt = require("jsonwebtoken");

// Вход
exports.loginMentor = async (req, res) => {
  const { name, password } = req.body;
  const mentor = await Mentor.findOne({ name });

  if (!mentor || mentor.password !== password) {
    return res.status(401).json({ message: "Неверные имя или пароль" });
  }

  const token = jwt.sign(
    {
      mentorId: mentor._id,
      branchId: mentor.branch,
      role: mentor.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  // удаляем пароль перед отправкой
  const { password: _, ...mentorData } = mentor.toObject();

  res.json({
    token,
    user: mentorData, // теперь клиент получит и токен, и данные ментора
  });
};

// Остальные — без изменений
exports.createMentor = async (req, res) => {
  const mentor = await Mentor.create(req.body);
  res.json(mentor);
};

exports.getMentors = async (req, res) => {
  const mentors = await Mentor.find().populate("branch", "name");
  res.json(mentors);
};

exports.deleteMentor = async (req, res) => {
  await Mentor.findByIdAndDelete(req.params.id);
  res.sendStatus(204);
};
