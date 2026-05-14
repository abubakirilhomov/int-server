const Joi = require("joi");
const Application = require("../models/applicationModel");

const objectId = Joi.string()
  .pattern(/^[0-9a-fA-F]{24}$/)
  .messages({
    "string.pattern.base": "Некорректный ID",
    "any.required": "ID обязателен",
  });

const submitApplicationSchema = Joi.object({
  fullName: Joi.string()
    .trim()
    .min(4)
    .max(100)
    .pattern(/^\S+\s+\S+/)
    .required()
    .messages({
      "string.pattern.base": "Iltimos, ism va familiyangizni to'liq kiriting",
      "any.required": "ФИО обязательно",
    }),
  phone: Joi.string()
    .trim()
    .required()
    .messages({ "any.required": "Telefon raqami majburiy" }),
  telegramUsername: Joi.string()
    .trim()
    .required()
    .messages({ "any.required": "Telegram username majburiy" }),
  age: Joi.number().integer().min(14).max(60).required().messages({
    "number.min": "Возраст должен быть не меньше 14",
    "number.max": "Возраст должен быть не больше 60",
    "any.required": "Возраст обязателен",
  }),
  branchId: objectId.required(),
  mentorId: objectId.required(),
  sphere: Joi.string()
    .valid(...Application.SPHERES)
    .required(),
  shift: Joi.string()
    .valid(...Application.SHIFTS)
    .required(),
});

const updateStatusSchema = Joi.object({
  status: Joi.string()
    .valid(...Application.STATUSES)
    .required(),
  notes: Joi.string().allow("").max(2000).optional(),
  rejectionReason: Joi.string().allow("").max(500).optional(),
  interviewDate: Joi.date().iso().allow(null).optional(),
});

module.exports = {
  submitApplicationSchema,
  updateStatusSchema,
};
