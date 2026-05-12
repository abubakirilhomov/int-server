// Refresh token cookie helper. Cross-origin SPA → SameSite=None+Secure in
// prod; localhost dev can't use Secure over plain http, so fall back to Lax.

const REFRESH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const isProd = () => process.env.NODE_ENV === "production";

const buildOptions = (path) => ({
  httpOnly: true,
  secure: isProd(),
  sameSite: isProd() ? "none" : "lax",
  path,
  maxAge: REFRESH_MAX_AGE_MS,
});

// Path must cover both /refresh-token and /logout so logout can read the
// cookie to blacklist its jti. Scoping to /api/interns (or /api/mentors)
// adds the cookie to all calls under that prefix — that's ~400B overhead
// per request, acceptable given the security benefit.
const pathFor = (name) => {
  if (name === "refresh_intern") return "/api/interns";
  if (name === "refresh_mentor") return "/api/mentors";
  throw new Error(`Unknown refresh cookie name: ${name}`);
};

exports.setRefreshCookie = (res, name, token) => {
  res.cookie(name, token, buildOptions(pathFor(name)));
};

// Browsers require Path/SameSite/Secure parity with the original Set-Cookie
// to actually clear, so we re-emit the same attribute set with Max-Age=0.
exports.clearRefreshCookie = (res, name) => {
  res.clearCookie(name, {
    httpOnly: true,
    secure: isProd(),
    sameSite: isProd() ? "none" : "lax",
    path: pathFor(name),
  });
};
