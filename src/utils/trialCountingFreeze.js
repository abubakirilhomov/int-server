/**
 * One-time policy: calendar days between now and the new cohort's real start
 * (2026-09-03, Asia/Tashkent) don't count toward any intern's 30-day trial
 * clock or monthly lesson quota — an administrative/holiday gap before the
 * program actually resumes. Not being able to log a lesson during this window
 * must not read as "fell behind" either, so anything derived from elapsed
 * days (daysWorking, requiredLessonsByNow, plan-blocking) should subtract the
 * frozen overlap via frozenDaysBetween()/frozenWorkingDaysBetween() below.
 * Counting resumes normally — no code change needed — once "now" >= END.
 */

const { startOfTashkentDay } = require("./tashkentTime");

const DAY_MS = 24 * 60 * 60 * 1000;

const COUNTING_FREEZE_START = startOfTashkentDay(new Date("2026-08-29T00:00:00+05:00"));
const COUNTING_FREEZE_END = startOfTashkentDay(new Date("2026-09-03T00:00:00+05:00")); // exclusive

/** Calendar days of [from, to) that overlap the freeze window. Rounds a partial
 * day UP (a day only partially inside the window still doesn't count) — the
 * safe direction here is excluding one extra day, not leaving an intern's
 * counter to tick up mid-freeze because of a rounding edge. */
function frozenDaysBetween(from, to) {
  const start = new Date(Math.max(new Date(from).getTime(), COUNTING_FREEZE_START.getTime()));
  const end = new Date(Math.min(new Date(to).getTime(), COUNTING_FREEZE_END.getTime()));
  if (start >= end) return 0;
  return Math.ceil((end.getTime() - start.getTime()) / DAY_MS);
}

module.exports = { COUNTING_FREEZE_START, COUNTING_FREEZE_END, frozenDaysBetween };
