// Регресс: служебные токены Mars ID не должны открывать API.
//
// До фикса state (публичный /api/auth/marsid/start) и linkageToken
// подписывались JWT_SECRET, а middleware/auth.js принимал любую валидную
// подпись. На проде анонимный state открывал /api/interns/rating и т.п.,
// а linkageToken с role:"admin" из Mars ID прошёл бы isAdmin.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-access-secret";
process.env.MARS_ID_RETURN_URL_ADMIN = "https://admin.example/auth";

jest.mock("../src/services/marsIdService", () => ({
  isConfigured: () => true,
  buildAuthorizeUrl: jest.fn(async ({ state }) => `https://id.example/authorize?state=${state}`),
  exchangeCode: jest.fn(async () => ({ id_token: "id", access_token: "acc" })),
  decodeIdToken: () => null,
  fetchUserInfo: jest.fn(async () => ({ sub: "mars-sub-1", role: "admin", handle: "evil" })),
}));

const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const auth = require("../src/middleware/auth");
const isAdmin = require("../src/middleware/isAdmin");
const marsId = require("../src/controllers/marsIdAuthController");
const { keyFor, isAccessClaims } = require("../src/utils/tokenKeys");

jest.setTimeout(120000);

function runMiddleware(mw, token) {
  return new Promise((resolve) => {
    const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ passed: false, status: this.statusCode, body: b, req }); return this; },
    };
    Promise.resolve(mw(req, res, () => resolve({ passed: true, req }))).catch((e) =>
      resolve({ passed: false, error: e })
    );
  });
}

// auth → isAdmin, как на админских роутах (/api/interviews и др.)
async function adminRoute(token) {
  const a = await runMiddleware(auth, token);
  if (!a.passed) return a;
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ passed: false, status: this.statusCode, body: b }); return this; },
    };
    isAdmin(a.req, res, () => resolve({ passed: true }));
  });
}

function callController(handler, query = {}, body = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      redirect(url) { resolve({ redirect: url }); },
      cookie() {},
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode || 200, body: b }); return this; },
    };
    handler({ query, body, headers: {} }, res, (err) => (err ? resolve({ error: err }) : reject(new Error("next() without error"))));
  });
}

const fragmentParam = (url, name) => new URLSearchParams(url.split("#")[1]).get(name);

let mongod;
beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe("ключи по назначению", () => {
  test("выведенные ключи отличаются от JWT_SECRET и друг от друга", () => {
    const keys = ["marsidState", "marsidLinkage", "candidate"].map(keyFor);
    expect(new Set([...keys, process.env.JWT_SECRET]).size).toBe(4);
  });

  test("явная env-переменная имеет приоритет", () => {
    process.env.CANDIDATE_JWT_SECRET = "explicit-candidate";
    expect(keyFor("candidate")).toBe("explicit-candidate");
    delete process.env.CANDIDATE_JWT_SECRET;
  });

  test("isAccessClaims: только id + известная роль без typ", () => {
    expect(isAccessClaims({ id: "1", role: "intern" })).toBe(true);
    expect(isAccessClaims({ id: "1", role: "admin", typ: "marsid-linkage" })).toBe(false);
    expect(isAccessClaims({ sub: "x", role: "admin" })).toBe(false);
    expect(isAccessClaims({ id: "1", jti: "r" })).toBe(false);
    expect(isAccessClaims({ id: "1", role: "candidate" })).toBe(false);
  });
});

describe("state и linkageToken Mars ID не открывают API", () => {
  test("state из /marsid/start → 401 в auth", async () => {
    const out = await callController(marsId.start, { app: "admin" });
    const state = new URL(out.redirect).searchParams.get("state");
    expect(state).toBeTruthy();

    const r = await runMiddleware(auth, state);
    expect(r.passed).toBe(false);
    expect(r.status).toBe(401);
  });

  test("linkageToken (Mars ID вернул role:admin, аккаунт не привязан) → 401 на админском роуте", async () => {
    const start = await callController(marsId.start, { app: "admin" });
    const state = new URL(start.redirect).searchParams.get("state");
    const cb = await callController(marsId.callback, { code: "c", state });
    const linkageToken = fragmentParam(cb.redirect, "linkageToken");
    expect(linkageToken).toBeTruthy();
    expect(jwt.decode(linkageToken).role).toBe("admin");

    const r = await adminRoute(linkageToken);
    expect(r.passed).toBe(false);
    expect(r.status).toBe(401);
  });

  test("linkageToken старого формата (подписан JWT_SECRET, выпущен до фикса) → 401", async () => {
    const legacy = jwt.sign(
      { kind: "mentor", app: "admin", sub: "s", role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: 600 }
    );
    const r = await adminRoute(legacy);
    expect(r.passed).toBe(false);
    expect(r.status).toBe(401);
  });

  test("/marsid/link не принимает linkage, подписанный JWT_SECRET", async () => {
    const legacy = jwt.sign({ kind: "mentor", sub: "s" }, process.env.JWT_SECRET, { expiresIn: 600 });
    const out = await callController(marsId.link, {}, { linkageToken: legacy, password: "x", name: "A" });
    expect(out.error).toBeTruthy();
    expect(out.error.statusCode).toBe(401);
  });

  test("callback не принимает state, подписанный JWT_SECRET", async () => {
    const legacyState = jwt.sign({ app: "admin", nonce: "n" }, process.env.JWT_SECRET, { expiresIn: 600 });
    const out = await callController(marsId.callback, { code: "c", state: legacyState });
    expect(out.error).toBeTruthy();
    expect(out.error.statusCode).toBe(400);
  });

  test("refresh-токен ({id, jti}, подписан JWT_SECRET при пустом JWT_REFRESH_SECRET) → 401", async () => {
    const refreshLike = jwt.sign({ id: new mongoose.Types.ObjectId(), jti: "j" }, process.env.JWT_SECRET);
    const r = await runMiddleware(auth, refreshLike);
    expect(r.status).toBe(401);
  });
});

describe("обычные access-токены работают как раньше", () => {
  const sign = (p) => jwt.sign({ jti: undefined, ...p }, process.env.JWT_SECRET, { expiresIn: "15m" });

  test("интерн проходит auth, но не isAdmin", async () => {
    const t = sign({ id: new mongoose.Types.ObjectId(), role: "intern", branchIds: [] });
    expect((await runMiddleware(auth, t)).passed).toBe(true);
    const r = await adminRoute(t);
    expect(r.passed).toBe(false);
    expect(r.status).toBe(403);
  });

  test("админ проходит auth и isAdmin", async () => {
    const t = sign({ id: new mongoose.Types.ObjectId(), role: "admin", isAdmin: true });
    expect((await adminRoute(t)).passed).toBe(true);
  });

  test("ментор с isAdmin проходит isAdmin", async () => {
    const t = sign({ id: new mongoose.Types.ObjectId(), role: "mentor", isAdmin: true });
    expect((await adminRoute(t)).passed).toBe(true);
  });
});
