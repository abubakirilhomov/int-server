const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const Mentor = require("../models/mentorModel");
const Intern = require("../models/internModel");
const marsIdService = require("../services/marsIdService");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");

const APP_KEYS = ["mentors", "interns", "admin"];
const STATE_TTL_SEC = 10 * 60;
const LINKAGE_TTL_SEC = 10 * 60;

const getReturnUrl = (app) => {
  const map = {
    mentors: process.env.MARS_ID_RETURN_URL_MENTORS,
    interns: process.env.MARS_ID_RETURN_URL_INTERNS,
    admin: process.env.MARS_ID_RETURN_URL_ADMIN,
  };
  return map[app] || null;
};

const buildFragmentRedirect = (returnUrl, params) => {
  const fragment = new URLSearchParams(params).toString();
  return `${returnUrl}${returnUrl.includes("#") ? "&" : "#"}${fragment}`;
};

const issueInternalSession = async (user, kind) => {
  if (kind === "mentor") {
    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
        branchIds: user.branches || [],
        branchId: user.branches?.[0] || null,
        name: user.name,
        lastName: user.lastName || "",
        jti: crypto.randomUUID(),
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );
    const refreshToken = jwt.sign(
      { id: user._id, jti: crypto.randomUUID() },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );
    return {
      token,
      refreshToken,
      user: {
        _id: user._id,
        name: user.name,
        lastName: user.lastName,
        role: user.role,
        branchIds: user.branches || [],
        branchId: user.branches?.[0] || null,
        profilePhoto: user.profilePhoto || "",
      },
    };
  }
  // intern
  const branchIds = (user.branches || []).map((b) => b.branch).filter(Boolean);
  const token = jwt.sign(
    {
      id: user._id,
      role: "intern",
      branchIds,
      branchId: branchIds[0] || null,
      isHeadIntern: (user.branches || []).some((b) => b.isHeadIntern),
      jti: crypto.randomUUID(),
    },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
  const refreshToken = jwt.sign(
    { id: user._id, jti: crypto.randomUUID() },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
  return {
    token,
    refreshToken,
    user: {
      _id: user._id,
      name: user.name,
      lastName: user.lastName,
      username: user.username,
      role: "intern",
      branchIds,
      branchId: branchIds[0] || null,
      isHeadIntern: (user.branches || []).some((b) => b.isHeadIntern),
      profilePhoto: user.profilePhoto || "",
    },
  };
};

// Decide which collection to look up Mars ID user in, based on app + claim role
const resolveKind = (app, marsRole) => {
  if (app === "interns") return "intern";
  if (app === "mentors" || app === "admin") return "mentor";
  // Fallback by Mars ID role
  if (marsRole === "student") return "intern";
  return "mentor";
};

exports.start = catchAsync(async (req, res) => {
  if (!marsIdService.isConfigured()) {
    throw new AppError("Mars ID не настроен на этом окружении", 503);
  }
  const app = String(req.query.app || "").toLowerCase();
  if (!APP_KEYS.includes(app)) {
    throw new AppError("Неизвестное приложение", 400);
  }
  const returnUrl = getReturnUrl(app);
  if (!returnUrl) {
    throw new AppError(`MARS_ID_RETURN_URL_${app.toUpperCase()} не настроен`, 503);
  }

  const nonce = crypto.randomBytes(16).toString("hex");
  // Sign state: opaque JWT carrying app + nonce so callback can verify without server session
  const state = jwt.sign(
    { app, nonce },
    process.env.JWT_SECRET,
    { expiresIn: STATE_TTL_SEC }
  );

  const url = await marsIdService.buildAuthorizeUrl({ state, nonce });
  res.redirect(url);
});

exports.callback = catchAsync(async (req, res) => {
  if (!marsIdService.isConfigured()) {
    throw new AppError("Mars ID не настроен на этом окружении", 503);
  }
  const { code, state, error: oauthError, error_description } = req.query;

  // Decode state first so we know where to redirect errors back to
  let stateClaims = null;
  try {
    stateClaims = jwt.verify(String(state || ""), process.env.JWT_SECRET);
  } catch {
    throw new AppError("Невалидный state — повторите вход", 400);
  }
  const returnUrl = getReturnUrl(stateClaims.app);
  if (!returnUrl) {
    throw new AppError("Неизвестное приложение в state", 400);
  }

  if (oauthError) {
    return res.redirect(
      buildFragmentRedirect(returnUrl, {
        marsIdError: String(error_description || oauthError),
      })
    );
  }
  if (!code) {
    return res.redirect(
      buildFragmentRedirect(returnUrl, { marsIdError: "no_code" })
    );
  }

  // Exchange + fetch user info
  const tokens = await marsIdService.exchangeCode(String(code));
  const idClaims = marsIdService.decodeIdToken(tokens.id_token);
  if (idClaims && idClaims.nonce && idClaims.nonce !== stateClaims.nonce) {
    throw new AppError("Nonce mismatch", 400);
  }
  const userinfo = await marsIdService.fetchUserInfo(tokens.access_token);

  if (!userinfo?.sub) {
    throw new AppError("Mars ID не вернул sub", 502);
  }

  const kind = resolveKind(stateClaims.app, userinfo.role);

  // Look up linked record
  const Model = kind === "mentor" ? Mentor : Intern;
  const existing = await Model.findOne({ "marsId.sub": userinfo.sub });

  if (existing) {
    // Optional: refresh stale handle/email/tg from latest userinfo
    existing.marsId = {
      sub: userinfo.sub,
      handle: userinfo.handle || existing.marsId?.handle || "",
      tg: userinfo.tg || existing.marsId?.tg || "",
      email: userinfo.email || existing.marsId?.email || "",
      linkedAt: existing.marsId?.linkedAt || new Date(),
    };
    await existing.save();

    const session = await issueInternalSession(existing, kind);
    return res.redirect(
      buildFragmentRedirect(returnUrl, {
        token: session.token,
        refreshToken: session.refreshToken,
        user: JSON.stringify(session.user),
      })
    );
  }

  // No linked record — issue linkageToken so frontend can collect creds
  const linkageToken = jwt.sign(
    {
      kind,
      app: stateClaims.app,
      sub: userinfo.sub,
      handle: userinfo.handle || "",
      tg: userinfo.tg || "",
      email: userinfo.email || "",
      role: userinfo.role || "",
    },
    process.env.JWT_SECRET,
    { expiresIn: LINKAGE_TTL_SEC }
  );
  return res.redirect(
    buildFragmentRedirect(returnUrl, {
      linkageToken,
      handle: userinfo.handle || "",
      kind,
    })
  );
});

exports.link = catchAsync(async (req, res) => {
  if (!marsIdService.isConfigured()) {
    throw new AppError("Mars ID не настроен на этом окружении", 503);
  }
  const { linkageToken, name, lastName, username, password } = req.body || {};
  if (!linkageToken || !password) {
    throw new AppError("linkageToken и password обязательны", 400);
  }

  let claims;
  try {
    claims = jwt.verify(linkageToken, process.env.JWT_SECRET);
  } catch {
    throw new AppError("Linkage token истёк или невалиден — повторите вход", 401);
  }

  const kind = claims.kind;
  if (kind !== "mentor" && kind !== "intern") {
    throw new AppError("Невалидный kind в linkage token", 400);
  }

  // Authenticate via existing creds (matches each app's login schema)
  let user;
  if (kind === "mentor") {
    const trimmedName = String(name || "").trim();
    const trimmedLast = String(lastName || "").trim();
    if (!trimmedName) {
      throw new AppError("name обязателен для ментора", 400);
    }
    const query = trimmedLast
      ? { name: trimmedName, lastName: trimmedLast }
      : { name: trimmedName };
    const candidates = await Mentor.find(query).select("+password");
    for (const c of candidates) {
      if (c.password && (await bcrypt.compare(password, c.password))) {
        user = c;
        break;
      }
    }
  } else {
    const trimmedUsername = String(username || "").trim();
    if (!trimmedUsername) {
      throw new AppError("username обязателен для интерна", 400);
    }
    const candidate = await Intern.findOne({ username: trimmedUsername }).select("+password");
    if (candidate && candidate.password && (await bcrypt.compare(password, candidate.password))) {
      user = candidate;
    }
  }
  if (!user) {
    throw new AppError("Неверные имя пользователя или пароль", 401);
  }

  // Ensure this Mars ID isn't already linked elsewhere
  const Model = kind === "mentor" ? Mentor : Intern;
  const conflict = await Model.findOne({ "marsId.sub": claims.sub });
  if (conflict && String(conflict._id) !== String(user._id)) {
    throw new AppError("Этот Mars ID уже привязан к другому аккаунту", 409);
  }

  user.marsId = {
    sub: claims.sub,
    handle: claims.handle || "",
    tg: claims.tg || "",
    email: claims.email || "",
    linkedAt: new Date(),
  };
  await user.save();

  const session = await issueInternalSession(user, kind);
  res.json(session);
});

exports.unlink = catchAsync(async (req, res) => {
  // Admin only — guarded by middleware in route
  const { userId, userType } = req.body || {};
  if (!userId || !["mentor", "intern"].includes(userType)) {
    throw new AppError("userId и userType (mentor|intern) обязательны", 400);
  }
  const Model = userType === "mentor" ? Mentor : Intern;
  const user = await Model.findById(userId);
  if (!user) throw new AppError("Пользователь не найден", 404);

  user.marsId = undefined;
  await user.save();
  res.json({ success: true });
});

exports.status = catchAsync(async (req, res) => {
  res.json({
    configured: marsIdService.isConfigured(),
    issuer: process.env.MARS_ID_ISSUER || null,
    apps: APP_KEYS.filter((a) => Boolean(getReturnUrl(a))),
  });
});
