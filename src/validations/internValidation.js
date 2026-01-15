const Joi = require("joi");

const createInternSchema = Joi.object({
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
    password: Joi.string().min(8).required().messages({
        "any.required": "Пароль обязателен",
        "string.min": "Пароль должен содержать минимум 8 символов",
    }),
    branch: Joi.string().required().messages({
        "any.required": "ID филиала обязателен",
    }),
    mentor: Joi.string().required().messages({
        "any.required": "ID ментора обязателен",
    }),
    grade: Joi.string()
        .valid("junior", "strongJunior", "middle", "strongMiddle", "senior")
        .default("junior"),
    dateJoined: Joi.date(),
    lessonsVisitedFake: Joi.number().integer().min(0),
});

module.exports = {
    createInternSchema,
};
