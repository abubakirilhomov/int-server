const { googleCalendarLink, toGCalDate } = require("../src/utils/calendarLink");

describe("calendarLink", () => {
  test("toGCalDate formats UTC as YYYYMMDDTHHmmssZ", () => {
    expect(toGCalDate("2026-06-08T09:30:00Z")).toBe("20260608T093000Z");
  });

  test("builds a TEMPLATE url with start/end (45 min default)", () => {
    const url = googleCalendarLink({
      title: "Собес: Иван (Frontend React)",
      start: "2026-06-08T09:30:00Z",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(u.searchParams.get("action")).toBe("TEMPLATE");
    expect(u.searchParams.get("text")).toBe("Собес: Иван (Frontend React)");
    expect(u.searchParams.get("dates")).toBe("20260608T093000Z/20260608T101500Z");
  });

  test("respects custom duration", () => {
    const url = googleCalendarLink({ title: "x", start: "2026-06-08T09:00:00Z", durationMinutes: 30 });
    expect(new URL(url).searchParams.get("dates")).toBe("20260608T090000Z/20260608T093000Z");
  });

  test("invalid/empty start returns empty string", () => {
    expect(googleCalendarLink({ title: "x", start: "" })).toBe("");
    expect(googleCalendarLink({ title: "x", start: "not-a-date" })).toBe("");
  });
});
