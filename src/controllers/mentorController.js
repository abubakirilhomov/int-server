const Mentor = require("../models/mentorModel");
const jwt = require("jsonwebtoken");

// Вход
exports.loginMentor = async (req, res) => {
  try {
    const { name, lastName, password } = req.body;

    // Ищем всех менторов по имени и фамилии
    const mentors = await Mentor.find({ name, lastName });

    if (!mentors || mentors.length === 0) {
      return res.status(401).json({ message: "Неверные имя или фамилия" });
    }

    // Находим конкретного ментора по паролю
    const mentor = mentors.find(m => m.password === password);

    if (!mentor) {
      return res.status(401).json({ message: "Неверный пароль" });
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

    // убираем пароль
    const { password: _, ...mentorData } = mentor.toObject();

    res.json({
      token,
      user: mentorData,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Ошибка при авторизации" });
  }
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
