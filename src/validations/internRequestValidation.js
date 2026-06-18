const Joi = require("joi");

const SPHERES = [
  "backend-nodejs",
  "backend-python",
  "frontend-react",
  "frontend-vue",
  "mern-stack",
  "full-stack",
];

// Хед-интерн заполняет заявку. branch НЕ принимается (сервер форсит активный
// филиал хеда), grade и password тоже не принимаются (grade=junior, пароль
// генерируется при аппруве).
const submitSchema = Joi.object({
  name: Joi.string().required().messages({
    "any.required": "Имя обязательно",
    "string.empty": "Имя не может быть пустым",
  }),
  lastName: Joi.string().required().messages({
    "any.required": "Фамилия обязательна",
  }),
  username: Joi.string().required().messages({
    "any.required": "Имя пользователя обязательно",
  }),
  mentor: Joi.string().required().messages({
    "any.required": "Ментор обязателен",
  }),
  sphere: Joi.string().valid(...SPHERES).default("backend-nodejs"),
  phoneNumber: Joi.string().allow("").optional(),
  telegram: Joi.string().allow("").optional(),
  profilePhoto: Joi.string().uri().allow("").optional(),
  dateJoined: Joi.date().optional(),
});

// Админ может отредактировать поля перед аппрувом. Все поля опциональны —
// сервер берёт значение из заявки, если админ его не переопределил.
const approveSchema = Joi.object({
  name: Joi.string().optional(),
  lastName: Joi.string().optional(),
  username: Joi.string().optional(),
  mentor: Joi.string().optional(),
  sphere: Joi.string().valid(...SPHERES).optional(),
  phoneNumber: Joi.string().allow("").optional(),
  telegram: Joi.string().allow("").optional(),
  profilePhoto: Joi.string().uri().allow("").optional(),
  dateJoined: Joi.date().optional(),
});

module.exports = {
  submitSchema,
  approveSchema,
};
