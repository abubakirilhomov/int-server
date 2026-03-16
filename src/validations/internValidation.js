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
    phoneNumber: Joi.string().allow("").optional(),
    telegram: Joi.string().allow("").optional(),
    sphere: Joi.string()
        .valid(
            "backend-nodejs",
            "backend-python",
            "frontend-react",
            "frontend-vue",
            "mern-stack",
            "full-stack"
        )
        .default("backend-nodejs"),
    profilePhoto: Joi.string().uri().allow("").optional(),
    // Legacy single-branch format
    branch: Joi.string().optional(),
    mentor: Joi.string().optional(),
    // New multi-branch format
    branches: Joi.array().items(
        Joi.object({
            branch: Joi.string().required(),
            mentor: Joi.string().required(),
            isHeadIntern: Joi.boolean().default(false),
        })
    ).optional(),
    grade: Joi.string()
        .valid("junior", "strongJunior", "middle", "strongMiddle", "senior")
        .default("junior"),
    dateJoined: Joi.date(),
    lessonsVisitedFake: Joi.number().integer().min(0),
});

module.exports = {
    createInternSchema,
};
