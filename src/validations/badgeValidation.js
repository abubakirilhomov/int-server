const Joi = require("joi");

// Выдать / принять / списать бейджик у интерна.
const toggleBadgeSchema = Joi.object({
  action: Joi.string().valid("give", "return", "lost").required().messages({
    "any.required": "action обязателен",
    "any.only": "action должен быть give, return или lost",
  }),
  // Филиал ресепшена. Для administrator — необязателен (берётся его филиал);
  // для админа на мульти-филиальном интерне — указать явно.
  branch: Joi.string().optional(),
  note: Joi.string().allow("").max(300).optional(),
});

// Закрытие дня — сверка ящика ресепшена.
const closeDaySchema = Joi.object({
  branch: Joi.string().optional(),
  countedInDrawer: Joi.number().integer().min(0).required().messages({
    "any.required": "countedInDrawer обязателен",
    "number.min": "countedInDrawer не может быть отрицательным",
  }),
  note: Joi.string().allow("").max(300).optional(),
});

// Инвентаризация — задать общий запас бейджиков филиала.
const setStockSchema = Joi.object({
  branch: Joi.string().required().messages({ "any.required": "branch обязателен" }),
  badgeStock: Joi.number().integer().min(0).required().messages({
    "any.required": "badgeStock обязателен",
    "number.min": "badgeStock не может быть отрицательным",
  }),
});

module.exports = { toggleBadgeSchema, closeDaySchema, setStockSchema };
