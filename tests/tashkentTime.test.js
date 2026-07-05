const {
  TASHKENT_OFFSET_MS,
  startOfTashkentDay,
  startOfNextTashkentDay,
  startOfTashkentMonth,
  startOfNextTashkentMonth,
  tashkentMonthBounds,
  tashkentWeekday,
  tashkentWallClockToDate,
} = require("../src/utils/tashkentTime");

const iso = (d) => d.toISOString();

describe("tashkentWallClockToDate", () => {
  test("трактует строку как ташкентское стенное время (UTC+5): 23:30 → 18:30Z", () => {
    expect(iso(tashkentWallClockToDate("2026-06-30T23:30"))).toBe(
      "2026-06-30T18:30:00.000Z"
    );
  });

  test("урок у полуночи 1-го числа сохраняет верный момент (02:00 → пред. день 21:00Z)", () => {
    expect(iso(tashkentWallClockToDate("2026-07-01T02:00"))).toBe(
      "2026-06-30T21:00:00.000Z"
    );
  });

  test("возвращает null на битом/пустом вводе", () => {
    expect(tashkentWallClockToDate("2026-07-01")).toBeNull(); // нет времени
    expect(tashkentWallClockToDate("")).toBeNull();
    expect(tashkentWallClockToDate(undefined)).toBeNull();
    expect(tashkentWallClockToDate(null)).toBeNull();
    expect(tashkentWallClockToDate("not-a-date")).toBeNull();
    expect(tashkentWallClockToDate("2026-07-01T14:00:00")).toBeNull(); // секунды не в формате
  });
});

describe("границы ташкентского месяца", () => {
  test("[start, endExclusive) для момента, который в Ташкенте = 1 июля 02:00", () => {
    const ref = new Date("2026-06-30T21:00:00.000Z"); // = 2026-07-01 02:00 Tashkent
    const { start, endExclusive } = tashkentMonthBounds(ref);
    expect(iso(start)).toBe("2026-06-30T19:00:00.000Z"); // 1 июля 00:00 Ташкент
    expect(iso(endExclusive)).toBe("2026-07-31T19:00:00.000Z"); // 1 авг 00:00 Ташкент
  });

  test("границы февраля (2026 не високосный)", () => {
    const ref = tashkentWallClockToDate("2026-02-15T10:00");
    expect(iso(startOfTashkentMonth(ref))).toBe("2026-01-31T19:00:00.000Z"); // 1 фев
    expect(iso(startOfNextTashkentMonth(ref))).toBe("2026-02-28T19:00:00.000Z"); // 1 мар
  });
});

describe("дневные хелперы и день недели", () => {
  test("startOfNextTashkentDay = startOfTashkentDay + 24ч", () => {
    const d = tashkentWallClockToDate("2026-07-15T14:00");
    expect(
      startOfNextTashkentDay(d).getTime() - startOfTashkentDay(d).getTime()
    ).toBe(24 * 60 * 60 * 1000);
  });

  test("startOfTashkentDay для позднего вечера = ташкентская полночь того же дня", () => {
    const d = tashkentWallClockToDate("2026-07-15T23:30");
    expect(iso(startOfTashkentDay(d))).toBe("2026-07-14T19:00:00.000Z");
  });

  test("tashkentWeekday: Ср=3, Вс=0 — даже когда в UTC это ещё суббота", () => {
    expect(tashkentWeekday(tashkentWallClockToDate("2026-07-01T10:00"))).toBe(3); // Ср
    expect(tashkentWeekday(tashkentWallClockToDate("2026-07-05T10:00"))).toBe(0); // Вс
    // 2026-07-05 02:00 Ташкент (Вс) = 2026-07-04T21:00Z (Сб в UTC) → должно быть Вс(0)
    expect(tashkentWeekday(tashkentWallClockToDate("2026-07-05T02:00"))).toBe(0);
  });

  test("оффсет = +5ч", () => {
    expect(TASHKENT_OFFSET_MS).toBe(5 * 60 * 60 * 1000);
  });
});
