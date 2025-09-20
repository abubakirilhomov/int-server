const bookingCtrl = require("../controllers/questionController.js");
const express = require('express');


const router = express.Router();

router.post("/register", bookingCtrl.addQuestion);         // добавить вопрос
router.get("/", bookingCtrl.getQuestions);         // получить вопросы
router.put("/:id", bookingCtrl.updateQuestion);    // обновить вопрос
router.delete("/:id", bookingCtrl.deleteQuestion);
 // удалить вопрос
module.exports = router;
