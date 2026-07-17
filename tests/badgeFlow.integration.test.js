// End-to-end поток бейджиков: реальные контроллеры + модели против in-memory Mongo.
// Проверяет выдачу/возврат/потерю, сверку дня, отчёт, детект утечки и авторизацию.
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const badgeCtrl = require("../src/controllers/badgeController");
const Intern = require("../src/models/internModel");
const Branch = require("../src/models/branchModel");
const Mentor = require("../src/models/mentorModel");
const BadgeEvent = require("../src/models/badgeEventModel");
const BadgeReconciliation = require("../src/models/badgeReconciliationModel");

jest.setTimeout(120000);

let mongod;
let branch, otherBranch, mentor, intern1, intern2;

// Вызвать обёрнутый catchAsync-хендлер с фейковыми req/res. catchAsync НЕ
// возвращает промис (fn().catch(next) без return), поэтому ждём момент, когда
// хендлер вызовет res.json (успех) или next(err) (ошибка).
function call(handler, ctx = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; resolve(this); return this; },
    };
    const next = (e) => (e ? reject(e) : resolve(res));
    handler({ params: {}, body: {}, query: {}, headers: {}, ...ctx }, res, next);
  });
}

const admin = () => ({ id: new mongoose.Types.ObjectId(), role: "admin", name: "Adm", lastName: "In", branchIds: [], branchId: null });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    Intern.deleteMany({}), Branch.deleteMany({}), Mentor.deleteMany({}),
    BadgeEvent.deleteMany({}), BadgeReconciliation.deleteMany({}),
  ]);
  branch = await Branch.create({ name: "TestFilial", badgeStock: 3 });
  otherBranch = await Branch.create({ name: "OtherFilial", badgeStock: 5 });
  mentor = await Mentor.create({ name: "M", lastName: "One", password: "hashed-placeholder", branches: [branch._id] });
  const base = { password: "password123", grade: "junior", status: "active" };
  intern1 = await Intern.create({ ...base, name: "Ali", lastName: "Valiyev", username: "ali1", branches: [{ branch: branch._id, mentor: mentor._id }] });
  intern2 = await Intern.create({ ...base, name: "Vali", lastName: "Aliyev", username: "vali2", branches: [{ branch: branch._id, mentor: mentor._id }] });
});

const toggle = (internId, action, user = admin(), extra = {}) =>
  call(badgeCtrl.toggleBadge, { params: { internId: String(internId) }, body: { action, ...extra }, user });

test("выдача бейджика: state + событие", async () => {
  const res = await toggle(intern1._id, "give");
  expect(res.body.hasBadge).toBe(true);

  const fresh = await Intern.findById(intern1._id);
  expect(fresh.receptionBadge.hasBadge).toBe(true);
  expect(String(fresh.receptionBadge.branch)).toBe(String(branch._id));

  const events = await BadgeEvent.find({ intern: intern1._id });
  expect(events).toHaveLength(1);
  expect(events[0].action).toBe("given");
});

test("двойная выдача → 400", async () => {
  await toggle(intern1._id, "give");
  await expect(toggle(intern1._id, "give")).rejects.toMatchObject({ statusCode: 400 });
});

test("возврат без выдачи → 400", async () => {
  await expect(toggle(intern1._id, "return")).rejects.toMatchObject({ statusCode: 400 });
});

test("доска: счётчики выдано/в ящике", async () => {
  await toggle(intern1._id, "give");
  const res = await call(badgeCtrl.board, { query: { branch: String(branch._id) }, user: admin() });
  expect(res.body.counts).toMatchObject({ stock: 3, out: 1, inDrawer: 2, activeInterns: 2, leaks: 0 });
});

test("потеря уменьшает запас филиала", async () => {
  await toggle(intern2._id, "give");
  await toggle(intern2._id, "lost");
  const b = await Branch.findById(branch._id);
  expect(b.badgeStock).toBe(2);
  const fresh = await Intern.findById(intern2._id);
  expect(fresh.receptionBadge.hasBadge).toBe(false);
  const lostEvents = await BadgeEvent.find({ intern: intern2._id, action: "lost" });
  expect(lostEvents).toHaveLength(1);
});

test("утечка: держит бейджик, но не активен → в leaks и в отчёте", async () => {
  await toggle(intern1._id, "give");
  await Intern.updateOne({ _id: intern1._id }, { status: "frozen" });

  const board = await call(badgeCtrl.board, { query: { branch: String(branch._id) }, user: admin() });
  expect(board.body.counts.leaks).toBe(1);
  expect(board.body.leaks.map((l) => String(l._id))).toContain(String(intern1._id));

  const report = await call(badgeCtrl.report, { user: admin() });
  expect(report.body.totals.leaks).toBe(1);
  expect(report.body.leaks).toHaveLength(1);
});

test("закрытие дня: сверка ящика и расхождение", async () => {
  await toggle(intern1._id, "give"); // stock 3, на руках 1 → в ящике должно быть 2

  const ok = await call(badgeCtrl.closeDay, { body: { branch: String(branch._id), countedInDrawer: 2 }, user: admin() });
  expect(ok.body.reconciliation).toMatchObject({ openAtClose: 1, expectedInDrawer: 2, countedInDrawer: 2, discrepancy: 0 });
  expect(ok.body.openLoans).toHaveLength(1);

  const short = await call(badgeCtrl.closeDay, { body: { branch: String(branch._id), countedInDrawer: 1 }, user: admin() });
  expect(short.body.reconciliation.discrepancy).toBe(-1);

  expect(await BadgeReconciliation.countDocuments({ branch: branch._id })).toBe(2);
});

test("история интерна: последовательность событий", async () => {
  await toggle(intern1._id, "give");
  await toggle(intern1._id, "return");
  await toggle(intern1._id, "give");
  const res = await call(badgeCtrl.internHistory, { params: { internId: String(intern1._id) }, user: admin() });
  const actions = res.body.map((e) => e.action); // newest first
  expect(actions).toEqual(["given", "returned", "given"]);
});

test("отчёт: расчёт по филиалу", async () => {
  await toggle(intern1._id, "give");
  const res = await call(badgeCtrl.report, { user: admin() });
  const row = res.body.perBranch.find((p) => String(p.branch._id) === String(branch._id));
  expect(row).toMatchObject({ stock: 3, out: 1, inDrawer: 2, leaks: 0 });
  expect(res.body.totals.stock).toBe(8); // 3 + 5
});

test("администратор чужого филиала → 403", async () => {
  const foreignReception = {
    id: new mongoose.Types.ObjectId(), role: "administrator", name: "R", lastName: "X",
    branchIds: [String(otherBranch._id)], branchId: String(otherBranch._id),
  };
  // интерн привязан к branch, но токен ресепшена — от otherBranch → доступа нет
  await expect(toggle(intern1._id, "give", foreignReception)).rejects.toMatchObject({ statusCode: 403 });
});

test("setStock: инвентаризация запаса", async () => {
  const res = await call(badgeCtrl.setStock, { body: { branch: String(branch._id), badgeStock: 25 }, user: admin() });
  expect(res.body.badgeStock).toBe(25);
  const b = await Branch.findById(branch._id);
  expect(b.badgeStock).toBe(25);
});
