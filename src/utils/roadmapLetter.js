// Генератор письма-результата (RU + UZ). Возвращает { ru, uz } — админ
// выбирает язык и копирует/отправляет. Текст нейтральный, без MARS-внутрянки.

const fmtDate = (d) =>
  d
    ? new Intl.DateTimeFormat("ru-RU", {
        timeZone: "Asia/Tashkent",
        dateStyle: "long",
      }).format(new Date(d))
    : "";

function buildLetters({
  candidateName = "",
  earned,
  total,
  percentage,
  passed,
  roadmap = [],
  cooldownUntil,
  threshold = 80,
}) {
  const score = `${earned}/${total} (${percentage}%)`;
  const topicsList = roadmap.length
    ? roadmap.map((t, i) => `${i + 1}. ${t}`).join("\n")
    : "—";
  const cd = fmtDate(cooldownUntil);
  const nameRu = candidateName ? `${candidateName}, ` : "";

  const ru = passed
    ? `Здравствуйте!\n\n${nameRu}поздравляем — собеседование на интернатуру пройдено успешно.\nРезультат: ${score}.\nВ ближайшее время с Вами свяжутся по поводу старта и доступа к аккаунту.\n\nДобро пожаловать!`
    : `Здравствуйте!\n\nСпасибо за собеседование на интернатуру.\nРезультат: ${score}. Для прохождения нужно набрать не менее ${threshold}%.\n\nЧтобы подготовиться, повторите, пожалуйста, эти темы:\n${topicsList}\n\n${cd ? `Повторное собеседование будет доступно после ${cd}.` : "О дате пересдачи сообщим дополнительно."}\nЖелаем успехов в подготовке!`;

  const nameUz = candidateName ? `${candidateName}, ` : "";
  const uz = passed
    ? `Assalomu alaykum!\n\n${nameUz}tabriklaymiz — internatura suhbatidan muvaffaqiyatli o'tdingiz.\nNatija: ${score}.\nTez orada hisob (akkaunt) va boshlanish bo'yicha siz bilan bog'lanishadi.\n\nXush kelibsiz!`
    : `Assalomu alaykum!\n\nInternatura suhbati uchun rahmat.\nNatija: ${score}. O'tish uchun kamida ${threshold}% kerak.\n\nTayyorlanish uchun quyidagi mavzularni qayta ko'rib chiqing:\n${topicsList}\n\n${cd ? `Qayta suhbat ${cd} dan keyin mumkin bo'ladi.` : "Qayta suhbat sanasi haqida alohida xabar beramiz."}\nTayyorgarlikda omad!`;

  return { ru, uz };
}

module.exports = { buildLetters };
