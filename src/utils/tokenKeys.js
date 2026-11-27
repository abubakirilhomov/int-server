// Ключи подписи JWT по назначению.
//
// Раньше state и linkageToken Mars ID подписывались тем же JWT_SECRET, что и
// access-токены, а middleware/auth.js принимал любую валидную подпись. Итог:
// анонимный state из публичного /api/auth/marsid/start открывал роуты под
// `auth`, а linkageToken с role:"admin" из Mars ID проходил бы isAdmin.
//
// Теперь у каждого назначения свой ключ. Если отдельная env-переменная не
// задана, ключ выводится из JWT_SECRET через HMAC — он всё равно отличается
// от JWT_SECRET, поэтому общий `auth` такую подпись не примет.
const crypto = require("crypto");

const PURPOSE_ENV = {
  marsidState: "MARSID_STATE_JWT_SECRET",
  marsidLinkage: "MARSID_LINKAGE_JWT_SECRET",
  candidate: "CANDIDATE_JWT_SECRET",
};

function keyFor(purpose) {
  const envName = PURPOSE_ENV[purpose];
  if (!envName) throw new Error(`Unknown token purpose: ${purpose}`);
  const explicit = process.env[envName];
  if (explicit) return explicit;
  const base = process.env.JWT_SECRET;
  if (!base) throw new Error("JWT_SECRET is not set");
  return crypto
    .createHmac("sha256", base)
    .update(`interns-system:${purpose}:v1`)
    .digest("hex");
}

// Роли, которые выдают /interns/login, /mentors/login и Mars ID (issueInternalSession).
const ACCESS_ROLES = new Set(["intern", "mentor", "admin", "branchManager", "administrator"]);

// Access-токен = есть id, роль из списка и нет служебного `typ`.
// Отсекает state/linkage старого формата (без id) и refresh-токены
// ({id, jti} без роли), если JWT_REFRESH_SECRET не задан и они подписаны JWT_SECRET.
function isAccessClaims(decoded) {
  return Boolean(
    decoded &&
      typeof decoded === "object" &&
      decoded.id &&
      ACCESS_ROLES.has(decoded.role) &&
      !decoded.typ
  );
}

module.exports = { keyFor, isAccessClaims, ACCESS_ROLES, PURPOSE_ENV };
