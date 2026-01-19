const InternUser = require("../models/bookingModel");
const Mentor = require("../models/mentorModel");
const Branch = require("../models/branchModel");
const mongoose = require("mongoose");

// -----------------------------
//  STEP 1 — ОСНОВНАЯ ИНФОРМАЦИЯ
// -----------------------------
exports.registerStepOne = async (req, res) => {
  try {
    const {
      name,
      surname,
      mentor,
      branch,
      grade,
      yearsOfStudy,
      direction,
      tellegrammUsername,
      phone,
      date,
    } = req.body;

    // ---- ВАЛИДАЦИЯ ПУСТЫХ ПОЛЕЙ ----
    const requiredFields = {
      name,
      surname,
      mentor,
      branch,
      grade,
      yearsOfStudy,
      direction,
      phone,
      tellegrammUsername,
      date,
    };

    const emptyFields = Object.keys(requiredFields).filter(
      (key) => !requiredFields[key]
    );

    if (emptyFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Заполните все обязательные поля",
        emptyFields,
      });
    }

    // ---- ПРОВЕРКА direction ----
    if (!["backend", "frontend", "fullstack"].includes(direction)) {
      return res.status(400).json({
        success: false,
        message:
          "Неверное направление. Доступные: backend, frontend, fullstack",
      });
    }

    // ---- ПРОВЕРКА yearsOfStudy ----
    if (isNaN(yearsOfStudy) || Number(yearsOfStudy) <= 0) {
      return res.status(400).json({
        success: false,
        message: "yearsOfStudy должно быть числом больше нуля",
      });
    }

    // ---- ПРОВЕРКА phone ----
    if (!/^\+?\d{9,15}$/.test(phone)) {
      return res.status(400).json({
        success: false,
        message: "Некорректный номер телефона",
      });
    }

    // ---- ПРОВЕРКА date ----
    if (isNaN(Date.parse(date))) {
      return res.status(400).json({
        success: false,
        message: "Некорректная дата",
      });
    }

    // ---- ПРОВЕРКА ObjectId ----
    if (!mongoose.Types.ObjectId.isValid(mentor)) {
      return res.status(400).json({
        success: false,
        message: "Некорректный mentor ID",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(branch)) {
      return res.status(400).json({
        success: false,
        message: "Некорректный branch ID",
      });
    }

    // ---- ПРОВЕРКА mentor ----
    const mentorExists = await Mentor.findById(mentor);
    if (!mentorExists) {
      return res.status(400).json({
        success: false,
        message: "Указанный mentor не найден",
      });
    }

    // ---- ПРОВЕРКА branch ----
    const branchExists = await Branch.findById(branch);
    if (!branchExists) {
      return res.status(400).json({
        success: false,
        message: "Указанный branch не найден",
      });
    }

    // ---- СОЗДАНИЕ ----
    const newUser = await InternUser.create({
      name,
      surname,
      mentor,
      branch,
      grade,
      yearsOfStudy,
      direction,
      tellegrammUsername,
      phone,
      date,
      status: "pending",
    });

    return res.status(201).json({
      success: true,
      message: "Шаг 1 успешно заполнен. Перейдите ко второму шагу.",
      userId: newUser._id,
    });
  } catch (error) {
    console.error("Ошибка step1:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера",
    });
  }
};

// -----------------------------
//  STEP 2 — ДОПОЛНИТЕЛЬНАЯ ИНФА
// -----------------------------
exports.registerStepTwo = async (req, res) => {
  try {
    const { userId, aboutYourself, whatYouKnow } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Некорректный userId",
      });
    }

    if (!aboutYourself || aboutYourself.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: "Поле 'о себе' минимум 10 символов",
      });
    }

    if (!whatYouKnow || whatYouKnow.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: "Поле 'что ты знаешь' минимум 10 символов",
      });
    }

    const user = await InternUser.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Пользователь не найден",
      });
    }

    user.aboutYourself = aboutYourself;
    user.whatYouKnow = whatYouKnow;

    await user.save();

    return res.json({
      success: true,
      message: "Заявка полностью заполнена!",
      user,
    });
  } catch (error) {
    console.error("Ошибка step2:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера",
    });
  }
};

// -----------------------------
//  LOGIN
// -----------------------------
exports.loginUser = async (req, res) => {
  try {
    const { name, surname, tellegrammUsername, phone } = req.body;

    if (!name || !surname || !tellegrammUsername || !phone) {
      return res.status(400).json({ message: "Заполните все поля!" });
    }

    const user = await InternUser.findOne({
      tellegrammUsername,
      phone,
    });

    if (!user) {
      return res.status(400).json({ message: "Неверные данные" });
    }

    return res.json({
      message: "Успешный вход!",
      user,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// -----------------------------
//  GET ALL
// -----------------------------
exports.getAllBookingInterns = async (req, res) => {
  try {
    const users = await InternUser.find()
      .populate("mentor")
      .populate("branch");

    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({
      message: "Ошибка при получении пользователей",
      error: error.message,
    });
  }
};

// -----------------------------
//  GET BY ID
// -----------------------------
exports.getBookingInternsId = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Некорректный ID" });
    }

    const user = await InternUser.findById(id)
      .populate("mentor")
      .populate("branch");

    if (!user) {
      return res.status(404).json({ message: "Пользователь не найден" });
    }

    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({
      message: "Ошибка при получении пользователя",
      error: error.message,
    });
  }
};

// -----------------------------
//  UPDATE STATUS
// -----------------------------
exports.updateInternStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Некорректный ID" });
    }

    if (!["approved", "pending", "canceled"].includes(status)) {
      return res.status(400).json({ message: "Некорректный статус" });
    }

    const user = await InternUser.findById(id);
    if (!user) {
      return res.status(404).json({ message: "Пользователь не найден" });
    }

    user.status = status;
    await user.save();

    let userMessage = "";
    if (status === "approved") userMessage = "Ваша заявка одобрена.";
    if (status === "pending") userMessage = "Заявка на рассмотрении.";
    if (status === "canceled") userMessage = "Заявка отклонена.";

    res.status(200).json({
      success: true,
      message: "Статус обновлён",
      user,
      userMessage,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

exports.addProjectLink = async (req, res) => {
  try {
    const { bookingID } = req.params;
    const { projectLink } = req.body;

    // Проверка ID
    if (!mongoose.Types.ObjectId.isValid(bookingID)) {
      return res.status(400).json({ message: "Некорректный ID пользователя" });
    }

    // projectLink обязателен ТОЛЬКО ЗДЕСЬ
    if (!projectLink || projectLink.trim().length === 0) {
      return res.status(400).json({
        message: "Введите ссылку на проект",
      });
    }

    const user = await InternUser.findById(bookingID);

    if (!user) {
      return res.status(404).json({ message: "Пользователь не найден" });
    }

    // Можно перезаписывать или нет — на твой выбор
    user.projectLink = projectLink;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Ссылка на проект добавлена",
      user,
    });
  } catch (error) {
    console.error("addProjectLink error:", error);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};

