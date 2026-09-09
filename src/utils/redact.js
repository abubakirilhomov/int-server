/**
 * Общие примитивы очистки данных перед записью в журналы.
 *
 * Вынесено из middleware/auditLog.js, когда появился трекер ошибок: обе
 * системы обязаны вырезать секреты одинаково, а тянуть middleware ради двух
 * функций нельзя — вместе с ним подтянулись бы его буфер и обработчики
 * сигналов. Поведение при выносе не менялось.
 */

// Совпадение по вхождению подстроки, а не по равенству: так под нож попадают
// и `newPassword`, и `refresh_token`, и `x-authorization` без отдельных правил.
const SECRET_KEYS = [
  "password",
  "currentpassword",
  "newpassword",
  "token",
  "refreshtoken",
  "accesstoken",
  "authorization",
  "secret",
  "jwt",
];
const REDACTED = "[REDACTED]";

const isSecretKey = (key) => {
  const k = String(key).toLowerCase().replace(/[-_\s]/g, "");
  return SECRET_KEYS.some((s) => k.includes(s));
};

/**
 * Рекурсивно заменяет значения секретных ключей на '[REDACTED]'.
 * Возвращает НОВЫЙ объект — исходник мутировать нельзя, его ещё читают дальше.
 */
const redact = (value, depth = 0) => {
  if (depth > 10) return "[DEPTH_LIMIT]";
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = isSecretKey(key) ? REDACTED : redact(val, depth + 1);
  }
  return out;
};

/**
 * Отредактированный объект, обрезанный по размеру. Загрузка файла в base64
 * или пакетный импорт не должны целиком оседать в журнале.
 */
const redactAndCap = (body, maxBytes) => {
  if (!body || typeof body !== "object") return null;
  if (Array.isArray(body) && body.length === 0) return null;
  if (!Array.isArray(body) && Object.keys(body).length === 0) return null;

  const clean = redact(body);
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(clean), "utf8");
  } catch {
    return { _unserializable: true };
  }
  if (bytes <= maxBytes) return clean;

  // Сохраняем форму (какие поля пришли), выбрасываем содержимое.
  return {
    _truncated: true,
    _bytes: bytes,
    _keys: Array.isArray(clean) ? ["<array>"] : Object.keys(clean).slice(0, 40),
  };
};

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Схлопывает конкретные идентификаторы в :id.
const normalizePath = (p) =>
  String(p || "")
    .split("/")
    .map((seg) => {
      if (!seg || seg.startsWith(":")) return seg;
      if (OBJECT_ID_RE.test(seg) || UUID_RE.test(seg) || /^\d+$/.test(seg)) return ":id";
      return seg;
    })
    .join("/");

module.exports = {
  SECRET_KEYS,
  REDACTED,
  isSecretKey,
  redact,
  redactAndCap,
  normalizePath,
  OBJECT_ID_RE,
  UUID_RE,
};
