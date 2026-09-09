const crypto = require("crypto");

/**
 * Группировка ошибок. От качества этого файла зависит вся система: слишком
 * грубо — разные баги слипнутся в один issue и Hermes будет чинить не то;
 * слишком тонко — один баг размажется на тысячу issue и утонет.
 *
 * Правило: fingerprint должен пережить деплой. Поэтому из ключа выброшено
 * всё, что меняется от сборки к сборке — номера строк, хеши в именах файлов,
 * конкретные id в тексте ошибки.
 */

// ─── Нормализация сообщения ──────────────────────────────────────────────────
// Идея та же, что у normalizePath в utils/redact.js: схлопнуть конкретику.
// Порядок замен важен — URL и даты содержат числа, поэтому числа идут последними.
const UUID_RE = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
const OBJECT_ID_RE = /\b[0-9a-fA-F]{24}\b/g;
const URL_RE = /https?:\/\/[^\s"'()<>]+/g;
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b/g;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g;
const NUMBER_RE = /\b\d+\b/g;

const normalizeMessage = (msg) =>
  String(msg == null ? "" : msg)
    .replace(UUID_RE, "<uuid>")
    .replace(OBJECT_ID_RE, "<id>")
    .replace(URL_RE, "<url>")
    .replace(ISO_DATE_RE, "<date>")
    .replace(EMAIL_RE, "<email>")
    .replace(NUMBER_RE, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);

// ─── Разбор стека ────────────────────────────────────────────────────────────
// Поддержаны формат V8 ("at fn (loc)" / "at loc") и формат Firefox/Safari
// ("fn@loc"). Первая строка стека — это "Error: message", она не матчится
// ни одним из шаблонов и отбрасывается сама.
const parseStack = (stack) => {
  if (!stack || typeof stack !== "string") return [];
  const frames = [];

  for (const rawLine of stack.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    let fn = null;
    let loc = null;

    let m = line.match(/^at\s+(?:async\s+)?(.+?)\s+\((.+)\)$/);
    if (m) {
      fn = m[1];
      loc = m[2];
    } else if ((m = line.match(/^at\s+(.+)$/))) {
      loc = m[1];
    } else if ((m = line.match(/^([^@\s]*)@(.+)$/))) {
      // Firefox/Safari. Пустое имя перед @ — анонимная функция.
      fn = m[1] || null;
      loc = m[2];
    }

    if (loc) frames.push({ raw: line, fn, loc });
  }
  return frames;
};

const EXTENSION_RE = /^(chrome|moz|safari|safari-web)-extension:\/\//;
const NATIVE_RE = /\[native code\]|^native$|^<anonymous>$/;
const VENDOR_RE = /[/\\]node_modules[/\\]|^node:|^internal[/\\]/;
// Сторонние скрипты, которые встречаются в браузерных стеках чаще прочих.
const THIRD_PARTY_HOST_RE =
  /(googletagmanager|google-analytics|doubleclick|facebook\.net|fbcdn|yandex\.(ru|net)|mc\.yandex|hotjar|intercom|clarity\.ms|sentry\.io)/i;

const originOf = (loc) => {
  const m = String(loc).match(/^(https?:\/\/[^/]+)/);
  return m ? m[1] : null;
};

/**
 * 'extension' | 'native' | 'vendor' | 'own'
 *
 * `pageOrigin` (origin страницы из отчёта) позволяет отличить наш бандл от
 * чужого скрипта: всё, что грузится с другого origin, нашим кодом не является.
 */
const classifyFrame = (frame, pageOrigin) => {
  const loc = String(frame.loc || "");
  if (EXTENSION_RE.test(loc)) return "extension";
  if (NATIVE_RE.test(loc)) return "native";
  if (VENDOR_RE.test(loc)) return "vendor";
  if (THIRD_PARTY_HOST_RE.test(loc)) return "vendor";

  const frameOrigin = originOf(loc);
  if (frameOrigin && pageOrigin && frameOrigin !== pageOrigin) return "vendor";

  return "own";
};

// ─── Ключ кадра ──────────────────────────────────────────────────────────────
// Из локации выбрасываем номера строк и хеш сборки: и то и другое меняется на
// каждом деплое, а fingerprint обязан деплой переживать.
const stripBuildHash = (file) =>
  file
    // Vite: index-DsvmxSug.js
    .replace(/-[A-Za-z0-9_-]{8,}(\.[a-z]+)$/, "$1")
    // webpack-подобное: chunk.a1b2c3d4.js
    .replace(/\.[0-9a-f]{8,}(\.[a-z]+)$/, "$1");

const normalizeLocation = (loc, pageOrigin) => {
  let out = String(loc).trim();
  out = out.replace(/\?.*$/, "");          // query
  out = out.replace(/:\d+(:\d+)?$/, "");   // :line:col
  if (pageOrigin && out.startsWith(pageOrigin)) out = out.slice(pageOrigin.length);
  out = out.replace(/^https?:\/\/[^/]+/, "");
  out = out.replace(/^.*?[/\\](src[/\\].*)$/, "$1"); // абсолютный путь → от src/
  const parts = out.split(/[/\\]/);
  parts[parts.length - 1] = stripBuildHash(parts[parts.length - 1] || "");
  return parts.filter(Boolean).join("/");
};

const normalizeFn = (fn) => {
  if (!fn) return "<anon>";
  return String(fn)
    .replace(/^(async|new|get|set)\s+/, "")
    .replace(/^Object\./, "")
    .replace(/^Module\./, "")
    .trim() || "<anon>";
};

const frameKey = (frame, pageOrigin) =>
  `${normalizeFn(frame.fn)}@${normalizeLocation(frame.loc, pageOrigin)}`;

// ─── Сетевые ошибки ──────────────────────────────────────────────────────────
// На клиенте это метрика доступности, а не баг: чинить в коде нечего, issue
// заводить не по чему. На СЕРВЕРЕ наоборот — ECONNREFUSED к Mongo это ровно
// то, о чём надо кричать, поэтому там сетевую классификацию не применяем.
const NETWORK_MESSAGE_RE =
  /failed to fetch|networkerror|network request failed|load failed|the internet connection appears to be offline|net::ERR_|ERR_NETWORK|ERR_INTERNET_DISCONNECTED|Load failed|AbortError/i;

const isNetworkError = ({ app, kind, message }) => {
  if (app === "server") return false;
  if (kind === "network") return true;
  return NETWORK_MESSAGE_RE.test(String(message || ""));
};

// ─── Основная функция ────────────────────────────────────────────────────────
const TOP_FRAMES = 3;

/**
 * Считает fingerprint и заодно возвращает всё, что нужно фильтрам шума.
 *
 * Возвращает:
 *   fingerprint        — sha1(app|kind|normalizedMessage|topFrames)
 *   normalizedMessage  — то, по чему группировали
 *   topFrames          — верхние 3 кадра НАШЕГО кода, нормализованные
 *   hasOwnFrames       — есть ли в стеке хоть один наш кадр
 *   hasExtensionFrames — есть ли кадры расширения браузера
 */
const computeFingerprint = ({ app, kind, message, stack, url }) => {
  const pageOrigin = url ? originOf(url) : null;
  const frames = parseStack(stack);

  const classified = frames.map((f) => ({ f, cls: classifyFrame(f, pageOrigin) }));
  const own = classified.filter((c) => c.cls === "own").map((c) => c.f);

  const topFrames = own.slice(0, TOP_FRAMES).map((f) => frameKey(f, pageOrigin));
  const normalizedMessage = normalizeMessage(message);

  const fingerprint = crypto
    .createHash("sha1")
    .update(`${app}|${kind}|${normalizedMessage}|${topFrames.join(">")}`)
    .digest("hex");

  return {
    fingerprint,
    normalizedMessage,
    topFrames,
    hasOwnFrames: own.length > 0,
    hasExtensionFrames: classified.some((c) => c.cls === "extension"),
    frameCount: frames.length,
  };
};

/**
 * Решение по отчёту:
 *   'drop'       — не писать вообще (шум)
 *   'event-only' — записать событие, issue не заводить (метрика доступности)
 *   'full'       — записать событие и завести/обновить issue
 */
const classifyReport = (report) => {
  const fp = computeFingerprint(report);

  if (fp.hasExtensionFrames) {
    return { ...fp, decision: "drop", reason: "browser-extension" };
  }
  if (isNetworkError(report)) {
    return { ...fp, decision: "event-only", reason: "network", kind: "network" };
  }
  if (!fp.hasOwnFrames) {
    // Сюда попадает и "Script error." из cross-origin скрипта, и мусор без
    // стека вообще. Чинить в этом нечего — в стеке нет ни строчки нашего кода.
    return { ...fp, decision: "drop", reason: "no-own-frames" };
  }
  return { ...fp, decision: "full", reason: null };
};

module.exports = {
  normalizeMessage,
  parseStack,
  classifyFrame,
  frameKey,
  normalizeLocation,
  isNetworkError,
  computeFingerprint,
  classifyReport,
  TOP_FRAMES,
};
