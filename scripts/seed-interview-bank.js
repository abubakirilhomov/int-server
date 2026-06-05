/**
 * Seed банка тем собеседования (track: frontend-react).
 * Идемпотентный: пропускает уже существующие (по label+track).
 *
 * Usage:
 *   cd int-server
 *   node scripts/seed-interview-bank.js          # dry-run (показать, что добавит)
 *   node scripts/seed-interview-bank.js --apply  # записать
 */

require("dotenv").config();
const mongoose = require("mongoose");
const InterviewTopic = require("../src/models/interviewTopicModel");

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGO_URI not set in .env");
  process.exit(1);
}
const APPLY = process.argv.includes("--apply");
const TRACK = "frontend-react";

// [label(UZ), labelRu]
const BANK = {
  "html-css": [
    ["SVG teglar rangini o'zgartiradigan atribut (fill)", "Атрибут цвета SVG (fill)"],
    ["SEO nima", "Что такое SEO"],
    ["SEO uchun kerak bo'ladigan meta teglar", "meta-теги для SEO"],
    ["Semantika va semantik teglar", "Семантика и семантические теги"],
    ["Google accessibility nima", "Google accessibility"],
    ["label nima uchun kerak va input bilan ishlashi", "label и его связь с input"],
    ["meta teglar nima uchun kerak", "Для чего нужны meta-теги"],
    ["img tegida alt atributi", "Атрибут alt у img"],
    ["ul vs ol vs dl", "Разница ul / ol / dl"],
    ["id vs class", "id vs class"],
    ["target=\"_blank\"", "target=\"_blank\""],
    ["inline vs block elementlar", "inline vs block элементы"],
    ["display holatlari", "Значения display"],
    ["position holatlari", "Позиционирование (position)"],
    ["pseudo-class vs pseudo-element", "Псевдокласс vs псевдоэлемент"],
    ["z-index", "z-index"],
    ["CSS animation (keyframes va sintaksis)", "CSS-анимация (keyframes)"],
    ["responsive vs adaptive", "responsive vs adaptive"],
  ],
  javascript: [
    ["Variables (var/let/const) va hoisting", "Переменные и hoisting"],
    ["Data types (turlari va soni)", "Типы данных"],
    ["Functions turlari, farqi va hoisting", "Типы функций и hoisting"],
    ["Array methods (map/forEach/filter/find/reduce/slice/splice/concat/indexOf/includes/length)", "Методы массива"],
    ["Object methods", "Методы объекта"],
    ["async/await va defer", "async/await и defer"],
    ["Promises", "Промисы"],
    ["setTimeout vs setInterval", "setTimeout vs setInterval"],
    ["Browser storage (localStorage/sessionStorage/cookie)", "Хранилища браузера"],
    ["this context", "this (контекст)"],
    ["forEach vs map, filter vs find, reduce", "forEach vs map, filter vs find, reduce"],
    ["null vs undefined", "null vs undefined"],
    ["== vs ===", "== vs ==="],
    ["switch case vs if/else", "switch vs if/else"],
    ["closures", "Замыкания"],
    ["Event Loop", "Event Loop"],
    ["Event Delegation", "Делегирование событий"],
    ["Event Bubbling", "Всплытие событий"],
    ["Throttling vs Debouncing", "Throttling vs Debouncing"],
    ["Type conversion", "Приведение типов"],
  ],
  react: [
    ["React nima va ustunliklari", "React и его преимущества"],
    ["React hooks", "Хуки React"],
    ["Global state vs local state", "Глобальное vs локальное состояние"],
    ["ReactDOM vs DOM", "ReactDOM vs DOM"],
    ["useState vs useReducer", "useState vs useReducer"],
    ["useSelector", "useSelector"],
    ["Link vs a", "Link vs a"],
    ["useEffect dependency array", "Массив зависимостей useEffect"],
    ["JSX", "JSX"],
    ["lifeCycle", "Жизненный цикл"],
    ["Redux Toolkit vs persist", "Redux Toolkit vs persist"],
    ["useParams", "useParams"],
    ["key nima uchun ishlatiladi", "Для чего нужен key"],
    ["Context API", "Context API"],
    ["props", "props"],
    ["react-router-dom (ko'p sahifa)", "react-router-dom (многостраничность)"],
    ["nega aynan react", "Почему именно React"],
  ],
  practical: [
    ["Object ichida funksiya yaratib, tashqarida ishlatish", "Объект с функцией, использовать снаружи"],
    ["console.log(typeof function(){})", "console.log(typeof function(){})"],
    ["2 + \"2\" natijasi", "Результат 2 + \"2\""],
    ["let a; console.log(a)", "let a; console.log(a)"],
    ["async fetch yozib berish", "Написать async fetch"],
    ["useState bilan inputdan ma'lumot olish", "Получить данные из input через useState"],
    ["localStorage'ga saqlab, qaytarib olish", "Сохранить и получить из localStorage"],
    ["props'ni ishlatib berish", "Использовать props"],
  ],
};

(async () => {
  await mongoose.connect(MONGODB_URI);
  console.log(`Connected. Track: ${TRACK}  (${APPLY ? "APPLY" : "dry-run"})\n`);

  let created = 0;
  let skipped = 0;

  for (const [category, topics] of Object.entries(BANK)) {
    let order = 0;
    for (const [label, labelRu] of topics) {
      order += 1;
      const exists = await InterviewTopic.findOne({ label, track: TRACK }).lean();
      if (exists) {
        skipped += 1;
        continue;
      }
      console.log(`  [${category}] ${label}`);
      if (APPLY) {
        await InterviewTopic.create({ label, labelRu, category, track: TRACK, weight: 1, order });
      }
      created += 1;
    }
  }

  console.log(`\n${APPLY ? "Создано" : "Будет создано"}: ${created}  |  Пропущено (есть): ${skipped}`);
  if (!APPLY) console.log("Это dry-run. Запусти с --apply, чтобы записать.");
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error("Seed failed:", err.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
