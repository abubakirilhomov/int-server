// Авторизация кандидата (/api/candidate/*). Свой ключ подписи (tokenKeys
// "candidate") и aud "candidate": токены интернов/менторов здесь не проходят,
// а токен кандидата не проходит общий middleware/auth.
// В отличие от общего auth, доступ читается из БД на каждый запрос: отзыв
// («Завершить», сброс пароля) и истечение окна действуют мгновенно.
//
// Ответы об отказе: 401 {code: invalid | expired | finished | revoked}, 403 {code: not_yet, validFrom}.
const mongoose = require("mongoose");
const CandidateAccess = require("../models/candidateAccessModel");
const InterviewSession = require("../models/interviewSessionModel");
const { verifyCandidateToken } = require("../services/candidateAccess");

const SEEN_THROTTLE_MS = 5000;

function deny(res, status, code, message, extra = {}) {
  return res.status(status).json({ code, message, ...extra });
}

// Причина отказа по состоянию доступа (общая для входа и токена).
function accessDenial(access, now = new Date()) {
  if (access.status === "revoked") {
    return access.revokeReason === "finished"
      ? { status: 401, code: "finished", message: "Собеседование завершено" }
      : { status: 401, code: "revoked", message: "Доступ отозван" };
  }
  if (access.status === "expired" || now > access.expiresAt) {
    return { status: 401, code: "expired", message: "Срок доступа истёк" };
  }
  if (now < access.validFrom) {
    return { status: 403, code: "not_yet", message: "Вход ещё не открыт", validFrom: access.validFrom };
  }
  return null;
}

async function candidateAuth(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return deny(res, 401, "invalid", "Нет токена");

  let claims;
  try {
    claims = verifyCandidateToken(header.slice(7));
  } catch {
    return deny(res, 401, "invalid", "Неверный токен");
  }
  if (claims.typ !== "candidate" || !claims.sub) return deny(res, 401, "invalid", "Неверный токен");

  // Опрос GET /session: голова сессии (rev, язык) читается одновременно с
  // доступом — пустой опрос стоит один поход в БД, а не два. Используется,
  // только если доступ прошёл проверку и iid совпал с его собеседованием.
  const headP = req.method === "GET" && req.path === "/session" && mongoose.isValidObjectId(claims.iid)
    ? InterviewSession.findOne({ interview: claims.iid }).select("_id candidateRev language").lean().catch(() => undefined)
    : undefined;

  let access;
  try {
    access = await CandidateAccess.findById(claims.sub);
  } catch {
    return deny(res, 401, "invalid", "Неверный токен");
  }
  if (!access) return deny(res, 401, "invalid", "Неверный токен");

  const now = new Date();
  const denial = accessDenial(access, now);
  if (denial) {
    const { status, code, message, ...extra } = denial;
    return deny(res, status, code, message, extra);
  }
  if (access.tokenVersion !== claims.v) return deny(res, 401, "invalid", "Токен устарел — войдите снова");

  if (!access.lastSeenAt || now - access.lastSeenAt > SEEN_THROTTLE_MS) {
    access.lastSeenAt = now;
    // Не ждём: опрос кандидата не должен платить за эту запись лишним походом в БД.
    CandidateAccess.updateOne({ _id: access._id }, { $set: { lastSeenAt: now } }).catch(() => {});
  }
  req.candidate = { access, headP: headP && String(access.interview) === claims.iid ? headP : undefined };
  next();
}

module.exports = candidateAuth;
module.exports.accessDenial = accessDenial;
