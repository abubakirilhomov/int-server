const AppError = require("../utils/AppError");

// In-memory discovery cache
let discoveryCache = null;
let discoveryCachedAt = 0;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

const isConfigured = () =>
  Boolean(
    process.env.MARS_ID_ISSUER &&
      process.env.MARS_ID_CLIENT_ID &&
      process.env.MARS_ID_CLIENT_SECRET &&
      process.env.MARS_ID_REDIRECT_URI
  );

const requireConfigured = () => {
  if (!isConfigured()) {
    throw new AppError("Mars ID не настроен на этом окружении", 503);
  }
};

const getDiscovery = async () => {
  requireConfigured();
  if (discoveryCache && Date.now() - discoveryCachedAt < DISCOVERY_TTL_MS) {
    return discoveryCache;
  }
  const issuer = process.env.MARS_ID_ISSUER.replace(/\/$/, "");
  const url = `${issuer}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new AppError(`Mars ID discovery failed: HTTP ${res.status}`, 502);
  }
  discoveryCache = await res.json();
  discoveryCachedAt = Date.now();
  return discoveryCache;
};

const buildAuthorizeUrl = async ({ state, nonce }) => {
  const disco = await getDiscovery();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.MARS_ID_CLIENT_ID,
    redirect_uri: process.env.MARS_ID_REDIRECT_URI,
    scope: "openid profile email",
    state,
    nonce,
  });
  return `${disco.authorization_endpoint}?${params.toString()}`;
};

const exchangeCode = async (code) => {
  const disco = await getDiscovery();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.MARS_ID_REDIRECT_URI,
    client_id: process.env.MARS_ID_CLIENT_ID,
    client_secret: process.env.MARS_ID_CLIENT_SECRET,
  });
  const res = await fetch(disco.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AppError(`Mars ID token exchange failed: ${res.status} ${detail}`, 502);
  }
  return res.json();
};

const fetchUserInfo = async (accessToken) => {
  const disco = await getDiscovery();
  const res = await fetch(disco.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AppError(`Mars ID userinfo failed: ${res.status} ${detail}`, 502);
  }
  return res.json();
};

// Returns ID token claims without signature verification.
// Acceptable here because /oauth/token call is over TLS to the configured
// issuer and we authenticate with client_secret — claims come from a trusted
// channel. Identity is also re-fetched from /userinfo before issuing a session.
const decodeIdToken = (idToken) => {
  if (!idToken || typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
};

module.exports = {
  isConfigured,
  getDiscovery,
  buildAuthorizeUrl,
  exchangeCode,
  fetchUserInfo,
  decodeIdToken,
};
