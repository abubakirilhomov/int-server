const Joi = require("joi");

const submitInternshipSurveySchema = Joi.object({
  marsStudyStartedAt: Joi.date()
    .iso()
    .max("now")
    .required()
    .messages({
      "any.required": "Укажи дату начала обучения",
      "date.max": "Дата не может быть в будущем",
    }),
  becameInternAt: Joi.date()
    .iso()
    .max("now")
    .min(Joi.ref("marsStudyStartedAt"))
    .required()
    .messages({
      "any.required": "Укажи дату начала интернства",
      "date.max": "Дата не может быть в будущем",
      "date.min": "Дата начала интернства не может быть раньше начала обучения",
    }),
  studyStatus: Joi.string()
    .valid("currently_studying", "graduated")
    .required()
    .messages({
      "any.required": "Выбери, продолжаешь ли ты учиться",
      "any.only": "Некорректный статус обучения",
    }),
  // Pro-course is asked only for graduates. For currently_studying it must be
  // omitted; for graduated it's required.
  proCourseCompleted: Joi.boolean().when("studyStatus", {
    is: "graduated",
    then: Joi.required().messages({
      "any.required": "Ответь, закончил ли ты Pro-курс",
    }),
    otherwise: Joi.forbidden(),
  }),
});

module.exports = {
  submitInternshipSurveySchema,
};
