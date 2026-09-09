/**
 * Словари приложений и видов ошибок.
 *
 * Вынесены из модели отдельным модулем без зависимости от mongoose: их читает
 * и валидатор ingest-эндпоинта, а тянуть ради двух массивов регистрацию
 * mongoose-модели незачем.
 */
const APPS = ["interns", "mentors", "admin", "server"];

const KINDS = [
  "react-render",        // ErrorBoundary поймал падение рендера
  "unhandled-rejection", // необработанный промис (браузер и сервер)
  "window-error",        // window.onerror
  "api-failure",         // HTTP-слой клиента получил неожиданный ответ
  "uncaught-exception",  // process.on('uncaughtException')
  "cron-failure",        // упала задача по расписанию
  "http-5xx",            // errorController отдал 5xx
  "network",             // обрыв связи: метрика доступности, не баг
];

module.exports = { APPS, KINDS };
