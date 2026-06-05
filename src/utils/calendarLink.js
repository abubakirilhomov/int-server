// Deep-link «Добавить в Google Calendar» — без OAuth/API. Клик открывает
// предзаполненное событие; напоминания на телефон даёт сам Google Calendar.
// Тот же идиом, что Яндекс-deeplink у филиалов.

const pad = (n) => String(n).padStart(2, "0");

// Google Calendar ждёт UTC в формате YYYYMMDDTHHmmssZ.
const toGCalDate = (d) => {
  const dt = new Date(d);
  return (
    dt.getUTCFullYear() +
    pad(dt.getUTCMonth() + 1) +
    pad(dt.getUTCDate()) +
    "T" +
    pad(dt.getUTCHours()) +
    pad(dt.getUTCMinutes()) +
    pad(dt.getUTCSeconds()) +
    "Z"
  );
};

function googleCalendarLink({ title, start, durationMinutes = 45, details = "", location = "" }) {
  if (!start) return "";
  const startDate = new Date(start);
  if (isNaN(startDate)) return "";
  const endDate = new Date(startDate.getTime() + durationMinutes * 60000);

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title || "Собеседование",
    dates: `${toGCalDate(startDate)}/${toGCalDate(endDate)}`,
    details: details || "",
    location: location || "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

module.exports = { googleCalendarLink, toGCalDate };
