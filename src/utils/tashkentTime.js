/**
 * Единый источник правды для дат в таймзоне Asia/Tashkent.
 *
 * Раньше `TASHKENT_OFFSET_MS` + `startOfTashkentDay` / `startOfTashkentMonth`
 * дублировались в weeklyPlanService.js и cronService.js. Теперь оба импортят
 * отсюда. Плюс здесь живёт разбор наивной строки урока `time`
 * ("YYYY-MM-DDTHH:mm", ташкентское стенное время) в корректный UTC-момент.
 *
 * Узбекистан — стабильный UTC+5, без переходов на летнее время, поэтому
 * фиксированный оффсет корректен для любой даты.
 */

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Формат datetime-local с фронта интерна: "2026-06-30T15:00" (без секунд/TZ).
const TASHKENT_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** UTC-Date, соответствующий 00:00 Asia/Tashkent того дня, в который попадает `d`. */
function startOfTashkentDay(d) {
  const t = new Date(d.getTime() + TASHKENT_OFFSET_MS);
  t.setUTCHours(0, 0, 0, 0);
  return new Date(t.getTime() - TASHKENT_OFFSET_MS);
}

/** UTC-Date для 00:00 Asia/Tashkent следующего дня (exclusive конец дня). */
function startOfNextTashkentDay(d) {
  return new Date(startOfTashkentDay(d).getTime() + DAY_MS);
}

/** UTC-Date для 1-го числа текущего (по Ташкенту) месяца, 00:00 Asia/Tashkent. */
function startOfTashkentMonth(d) {
  const t = new Date(d.getTime() + TASHKENT_OFFSET_MS);
  const utcMs = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1);
  return new Date(utcMs - TASHKENT_OFFSET_MS);
}

/** UTC-Date для 1-го числа следующего (по Ташкенту) месяца — exclusive конец окна. */
function startOfNextTashkentMonth(d) {
  const t = new Date(d.getTime() + TASHKENT_OFFSET_MS);
  const utcMs = Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1);
  return new Date(utcMs - TASHKENT_OFFSET_MS);
}

/**
 * Полуоткрытый интервал текущего ташкентского месяца `[start, endExclusive)`.
 * Использовать с `date: { $gte: start, $lt: endExclusive }`, чтобы не плодить
 * расхождение $lt / $lte.
 */
function tashkentMonthBounds(d = new Date()) {
  return { start: startOfTashkentMonth(d), endExclusive: startOfNextTashkentMonth(d) };
}

/** День недели в Ташкенте: 0 = воскресенье … 6 = суббота. */
function tashkentWeekday(d) {
  return new Date(d.getTime() + TASHKENT_OFFSET_MS).getUTCDay();
}

/**
 * Разбирает строку урока `time` ("YYYY-MM-DDTHH:mm", ташкентское стенное время)
 * в корректный UTC-момент. Возвращает `null` при неверном формате.
 *
 * Приём: трактуем строку как если бы она была в UTC ("...:00.000Z"), затем
 * сдвигаем на -5ч, получая реальный момент, соответствующий стенным часам
 * Ташкента.
 */
function tashkentWallClockToDate(timeStr) {
  if (typeof timeStr !== "string" || !TASHKENT_TIME_RE.test(timeStr)) return null;
  const asIfUtc = new Date(`${timeStr}:00.000Z`);
  if (Number.isNaN(asIfUtc.getTime())) return null;
  return new Date(asIfUtc.getTime() - TASHKENT_OFFSET_MS);
}

module.exports = {
  TASHKENT_OFFSET_MS,
  TASHKENT_TIME_RE,
  startOfTashkentDay,
  startOfNextTashkentDay,
  startOfTashkentMonth,
  startOfNextTashkentMonth,
  tashkentMonthBounds,
  tashkentWeekday,
  tashkentWallClockToDate,
};
