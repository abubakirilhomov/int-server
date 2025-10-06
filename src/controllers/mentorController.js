const Mentor = require("../models/mentorModel");
const jwt = require("jsonwebtoken");

// Вход
exports.loginMentor = async (req, res) => {
  try {
    const { name, lastName, password } = req.body;

    let mentor;

    if (lastName && lastName.trim() !== "") {
      // Если указана фамилия → ищем по имени и фамилии
      mentor = await Mentor.findOne({ name, lastName });
    } else {
      // Если фамилия не указана → ищем по имени, но только среди тех, у кого фамилии нет
      mentor = await Mentor.findOne({ name, $or: [{ lastName: "" }, { lastName: { $exists: false } }] });
    }

    if (!mentor || mentor.password !== password) {
      return res.status(401).json({ message: "Неверные имя, фамилия или пароль" });
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
