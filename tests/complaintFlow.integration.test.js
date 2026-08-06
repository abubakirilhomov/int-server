// Сквозной поток жалобы против in-memory Mongo: branch manager подаёт жалобу
// (internService.addBranchManagerComplaint) → админ видит её в отчёте
// (complaintController.getComplaints) → помечает разобранной.
//
// Заодно закрывает регресс: сервис грузит интерна с .populate("branches.branch"),
// и до фикса проверка «стажёр моего филиала» на populate-нутом доке всегда
// давала false — branch manager получал 403 на любую жалобу.
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const complaintCtrl = require("../src/controllers/complaintController");
const internService = require("../src/services/internService");
const Intern = require("../src/models/internModel");
const Branch = require("../src/models/branchModel");
const Mentor = require("../src/models/mentorModel");
const Rule = require("../src/models/rulesModel");

jest.setTimeout(120000);

let mongod;
let branch, otherBranch, manager, redRule, yellowRule, intern, outsider;

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

const managerUser = () => ({
  id: String(manager._id),
  role: "branchManager",
  name: "Bek",
  lastName: "Manager",
  branchIds: [String(branch._id)],
  branchId: String(branch._id),
  activeBranchId: String(branch._id),
});

const adminUser = () => ({ id: new mongoose.Types.ObjectId(), role: "admin" });

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
    Intern.deleteMany({}), Branch.deleteMany({}), Mentor.deleteMany({}), Rule.deleteMany({}),
  ]);
  branch = await Branch.create({ name: "Minor" });
  otherBranch = await Branch.create({ name: "Tinchlik" });
  manager = await Mentor.create({
    name: "Bek", lastName: "Manager", password: "hashed-placeholder",
    role: "branchManager", branches: [branch._id],
  });
  redRule = await Rule.create({ category: "red", title: "Опоздание на урок" });
  yellowRule = await Rule.create({ category: "yellow", title: "Не сдал домашку" });

  const base = { password: "password123", grade: "junior", status: "active" };
  intern = await Intern.create({
    ...base, name: "Ali", lastName: "Valiyev", username: "ali1",
    branches: [{ branch: branch._id, mentor: manager._id }],
  });
  outsider = await Intern.create({
    ...base, name: "Vali", lastName: "Aliyev", username: "vali2",
    branches: [{ branch: otherBranch._id, mentor: manager._id }],
  });
});

const fileComplaint = (targetId, payload, user = managerUser()) =>
  internService.addBranchManagerComplaint(user, String(targetId), payload);

const listComplaints = (query = {}, user = adminUser()) =>
  call(complaintCtrl.getComplaints, { query, user });

describe("branch manager подаёт жалобу", () => {
  test("жалоба на стажёра своего филиала проходит (регресс на 403)", async () => {
    const result = await fileComplaint(intern._id, { text: "Систематически опаздывает" });
    expect(result.message).toBe("Жалоба отправлена");

    const saved = await Intern.findById(intern._id);
    expect(saved.complaints).toHaveLength(1);
    expect(saved.complaints[0].text).toBe("Систематически опаздывает");
    expect(saved.complaints[0].createdByRole).toBe("branchManager");
    expect(saved.complaints[0].status).toBe("new");
    expect(String(saved.complaints[0].createdById)).toBe(String(manager._id));
  });

  test("жалоба на стажёра чужого филиала отклоняется", async () => {
    await expect(fileComplaint(outsider._id, { text: "нет доступа" })).rejects.toThrow(
      /только на стажёров своего филиала/i
    );
  });

  test("выбор правил создаёт нарушения и задаёт категорию по худшему правилу", async () => {
    await fileComplaint(intern._id, { text: "Нарушения", ruleIds: [yellowRule._id, redRule._id] });

    const saved = await Intern.findById(intern._id);
    expect(saved.violations).toHaveLength(2);
    expect(saved.violations.every((v) => v.issuedBy === "branchManager")).toBe(true);
    // red (severity 3) перебивает yellow (2)
    expect(saved.complaints[0].category).toBe("red");
  });

  test("пустая жалоба без правил отклоняется", async () => {
    await expect(fileComplaint(intern._id, { text: "   " })).rejects.toThrow(
      /текст жалобы или выберите правило/i
    );
  });
});

describe("админ смотрит журнал жалоб", () => {
  beforeEach(async () => {
    await fileComplaint(intern._id, { text: "Опоздания", ruleIds: [redRule._id] });
    await fileComplaint(intern._id, { text: "Домашка", ruleIds: [yellowRule._id] });
  });

  test("возвращает плоский список с именами стажёра, филиала и автора", async () => {
    const res = await listComplaints();
    expect(res.body).toHaveLength(2);

    const row = res.body.find((c) => c.text === "Опоздания");
    expect(row.internName).toBe("Ali Valiyev");
    expect(row.branchName).toBe("Minor");
    expect(row.createdByName).toBe("Bek Manager");
    expect(row.createdByRole).toBe("branchManager");
    expect(row.category).toBe("red");
    expect(row.status).toBe("new");
    expect(row.ruleTitles).toEqual(["Опоздание на урок"]);
    expect(row.complaintId).toBeDefined();
  });

  test("сортировка — сначала новые", async () => {
    const res = await listComplaints();
    const dates = res.body.map((c) => new Date(c.date).getTime());
    expect(dates[0]).toBeGreaterThanOrEqual(dates[1]);
  });

  test("фильтр по категории", async () => {
    const res = await listComplaints({ category: "red" });
    expect(res.body).toHaveLength(1);
    expect(res.body[0].text).toBe("Опоздания");
  });

  test("фильтр по филиалу учитывает все филиалы интерна, не только первый", async () => {
    // Интерн состоит в двух филиалах; жалоба должна находиться по второму.
    await Intern.updateOne(
      { _id: intern._id },
      { $push: { branches: { branch: otherBranch._id, mentor: manager._id } } }
    );

    const byPrimary = await listComplaints({ branch: String(branch._id) });
    const bySecondary = await listComplaints({ branch: String(otherBranch._id) });
    expect(byPrimary.body).toHaveLength(2);
    expect(bySecondary.body).toHaveLength(2);
  });

  test("фильтр по несвязанному филиалу ничего не возвращает", async () => {
    const empty = await Branch.create({ name: "Sergeli" });
    const res = await listComplaints({ branch: String(empty._id) });
    expect(res.body).toHaveLength(0);
  });

  test("архивные стажёры не попадают в журнал", async () => {
    await Intern.updateOne({ _id: intern._id }, { status: "archived" });
    const res = await listComplaints();
    expect(res.body).toHaveLength(0);
  });
});

describe("админ разбирает жалобу", () => {
  const setStatus = (internId, complaintId, status) =>
    call(complaintCtrl.setComplaintStatus, {
      params: { internId: String(internId), complaintId: String(complaintId) },
      body: { status },
      user: adminUser(),
    });

  test("пометка reviewed сохраняется и видна в отчёте", async () => {
    await fileComplaint(intern._id, { text: "Разобрать" });
    const [row] = (await listComplaints()).body;

    const res = await setStatus(intern._id, row.complaintId, "reviewed");
    expect(res.body.status).toBe("reviewed");

    const after = await listComplaints({ status: "reviewed" });
    expect(after.body).toHaveLength(1);
    expect((await listComplaints({ status: "new" })).body).toHaveLength(0);
  });

  test("недопустимый статус отклоняется", async () => {
    await fileComplaint(intern._id, { text: "Разобрать" });
    const [row] = (await listComplaints()).body;
    await expect(setStatus(intern._id, row.complaintId, "deleted")).rejects.toThrow(
      /Недопустимый статус/i
    );
  });

  test("несуществующая жалоба даёт 404", async () => {
    await expect(
      setStatus(intern._id, new mongoose.Types.ObjectId(), "reviewed")
    ).rejects.toThrow(/Жалоба не найдена/i);
  });
});
