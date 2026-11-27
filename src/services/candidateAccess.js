// Разовый доступ кандидата на одно собеседование: выдача, сброс, продление,
// отзыв, токен. Пароль хранится только хешем и показывается интервьюеру один раз.
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const CandidateAccess = require("../models/candidateAccessModel");
const { keyFor } = require("../utils/tokenKeys");

const TOKEN_AUDIENCE = "candidate";
const MAX_TOKEN_TTL_SEC = 4 * 3600;
// Блокировка после стольких неверных паролей подряд (сброс пароля снимает).
const LOCK_AFTER_FAILS = 8;
const MIN = 60 * 1000;

// Без похожих символов (0/O, 1/I/l): логин и пароль диктуют вслух.
const USER_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const PASS_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

function randomFrom(alphabet, len) {
  let out = "";
  for (let i = 0; i < len; i += 1) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

const normalizeUsername = (u) => String(u || "").trim().toUpperCase();
const generateUsername = () => `C-${randomFrom(USER_ALPHABET, 6)}`;
const generatePassword = () => randomFrom(PASS_ALPHABET, 8);

// Окно: от (начало − before) до (max(начало, сейчас) + after). Если интервьюер
// стартует позже назначенного, доступ не должен родиться уже истёкшим.
function accessWindow(scheduledAt, cfgWindow, now = new Date()) {
  const start = new Date(scheduledAt || now);
  const before = Number(cfgWindow?.beforeMinutes ?? 30);
  const after = Number(cfgWindow?.afterMinutes ?? 180);
  return {
    validFrom: new Date(start.getTime() - before * MIN),
    expiresAt: new Date(Math.max(start.getTime(), now.getTime()) + after * MIN),
  };
}

async function issueAccess({ interview, window, createdBy }) {
  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 10);
  for (let i = 0; i < 5; i += 1) {
    try {
      const access = await CandidateAccess.create({
        application: interview.application,
        interview: interview._id,
        username: generateUsername(),
        passwordHash,
        passwordShownAt: new Date(),
        validFrom: window.validFrom,
        expiresAt: window.expiresAt,
        createdBy: createdBy || null,
      });
      return { access, password };
    } catch (e) {
      // Коллизия логина — пробуем другой; повтор по interview — наверх (409).
      if (e?.code === 11000 && e.keyPattern?.username) continue;
      throw e;
    }
  }
  throw new Error("Не удалось подобрать свободный логин");
}

// Новый пароль: старые токены гаснут (tokenVersion), блокировка снимается.
async function resetPassword(accessId) {
  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 10);
  const access = await CandidateAccess.findOneAndUpdate(
    { _id: accessId, status: { $ne: "revoked" } },
    { $set: { passwordHash, passwordShownAt: new Date(), failedLogins: 0 }, $inc: { tokenVersion: 1 } },
    { new: true }
  );
  return access ? { access, password } : null;
}

// +N минут от max(сейчас, конец окна); истёкший доступ снова активен.
async function extendAccess(accessId, minutes = 30, now = new Date()) {
  const access = await CandidateAccess.findById(accessId);
  if (!access || access.status === "revoked") return null;
  const base = Math.max(now.getTime(), access.expiresAt.getTime());
  access.expiresAt = new Date(base + minutes * MIN);
  if (access.status === "expired") {
    access.status = "active";
    access.revokeReason = null;
  }
  await access.save();
  return access;
}

async function revokeAccess(filter, reason) {
  return CandidateAccess.updateMany(
    { ...filter, status: { $ne: "revoked" } },
    { $set: { status: "revoked", revokedAt: new Date(), revokeReason: reason }, $inc: { tokenVersion: 1 } }
  );
}

// Крон: активные доступы с прошедшим окном → expired (рантайм и так их не пускает).
async function expireDueAccesses(now = new Date()) {
  const r = await CandidateAccess.updateMany(
    { status: "active", expiresAt: { $lt: now } },
    { $set: { status: "expired", revokeReason: "expired" } }
  );
  return r.modifiedCount || 0;
}

function signCandidateToken(access, now = new Date()) {
  const left = Math.floor((access.expiresAt.getTime() - now.getTime()) / 1000);
  const ttl = Math.max(60, Math.min(MAX_TOKEN_TTL_SEC, left));
  return jwt.sign(
    { sub: String(access._id), v: access.tokenVersion, typ: "candidate" },
    keyFor("candidate"),
    { algorithm: "HS256", audience: TOKEN_AUDIENCE, expiresIn: ttl }
  );
}

function verifyCandidateToken(token) {
  return jwt.verify(token, keyFor("candidate"), { algorithms: ["HS256"], audience: TOKEN_AUDIENCE });
}

module.exports = {
  LOCK_AFTER_FAILS,
  normalizeUsername,
  generatePassword,
  accessWindow,
  issueAccess,
  resetPassword,
  extendAccess,
  revokeAccess,
  expireDueAccesses,
  signCandidateToken,
  verifyCandidateToken,
};
