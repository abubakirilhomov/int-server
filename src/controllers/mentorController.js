const Mentor = require("../models/mentorModel");
const jwt = require("jsonwebtoken");

exports.loginMentor = async (req, res) => {
  try {
    const { name, lastName, password } = req.body;

    const mentors = await Mentor.find({ name, lastName });

    if (!mentors || mentors.length === 0) {
      return res.status(401).json({ message: "Неверные имя или фамилия" });
    }

    const mentor = mentors.find((m) => m.password === password);

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

    const refreshToken = jwt.sign(
      { mentorId: mentor._id },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    const { password: _, ...mentorData } = mentor.toObject();

    res.json({
      token,
      refreshToken,
      user: mentorData,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Ошибка при авторизации" });
  }
};

exports.refreshMentorToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({ error: "Refresh token обязателен" });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    const newToken = jwt.sign(
      {
        mentorId: decoded.mentorId,
        role: "mentor",
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token: newToken });
  } catch (err) {
    console.error("Ошибка refresh:", err);
    res.status(401).json({ error: "Недействительный refresh token" });
  }
};

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
