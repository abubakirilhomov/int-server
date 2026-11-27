// Green-qoidalar — rag'bat (seed-praise-rules.js), shtraf emas.
// Regress: ментор при оценке урока отмечал "Real loyihani muvaffaqiyatli
// bajardi" / "Mars nomidan tadbirda ishtirok etdi", а в систему это уходило
// штрафом "Reyting ta'siri: -0.2", рейтинг падал, у интерна в дашборде —
// "Sariq · Noma'lum qoida".
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const {
  computePenalties,
  buildRuleMap,
  resolveCategory,
  splitViolations,
} = require("../src/utils/penaltyUtils");
const internService = require("../src/services/internService");
const Intern = require("../src/models/internModel");
const Branch = require("../src/models/branchModel");
const Mentor = require("../src/models/mentorModel");
const Lesson = require("../src/models/lessonModel");
const Rule = require("../src/models/rulesModel");

describe("penaltyUtils: green = rag'bat", () => {
  const greenId = new mongoose.Types.ObjectId();
  const yellowId = new mongoose.Types.ObjectId();
  const redId = new mongoose.Types.ObjectId();
  const ruleMap = buildRuleMap([
    { _id: greenId, category: "green" },
    { _id: yellowId, category: "yellow" },
    { _id: redId, category: "red" },
  ]);

  test("buildRuleMap + ObjectId ruleId: kategoriya to'g'ri aniqlanadi (avval hammasi yellow edi)", () => {
    expect(resolveCategory({ ruleId: greenId }, ruleMap)).toBe("green");
    expect(resolveCategory({ ruleId: redId }, ruleMap)).toBe("red");
  });

  test("populate qilingan ruleId ham tushuniladi", () => {
    expect(resolveCategory({ ruleId: { _id: greenId, category: "green", title: "x" } }, {})).toBe("green");
  });

  test("topilmagan qoida — yellow (shtraf jim yo'qolmaydi)", () => {
    expect(resolveCategory({ ruleId: new mongoose.Types.ObjectId() }, ruleMap)).toBe("yellow");
  });

  test("faqat green: ayirma 0, total 0, worstLevel null", () => {
    const info = computePenalties(
      Array.from({ length: 6 }, () => ({ ruleId: greenId })),
      ruleMap
    );
    expect(info.totalDeduction).toBe(0);
    expect(info.total).toBe(0);
    expect(info.worstLevel).toBeNull();
    expect(info.praiseCount).toBe(6);
  });

  test("green + yellow: faqat yellow ayiriladi", () => {
    const info = computePenalties([{ ruleId: greenId }, { ruleId: yellowId }], ruleMap);
    expect(info.totalDeduction).toBe(0.5);
    expect(info.total).toBe(1);
    expect(info.worstLevel).toBe("yellow");
  });

  test("splitViolations: green alohida, har yozuvda rule", () => {
    const greenRule = { _id: greenId, category: "green", title: "Real loyihani muvaffaqiyatli bajardi" };
    const yellowRule = { _id: yellowId, category: "yellow", title: "Kechikdi" };
    const { penalties, praises } = splitViolations([{ ruleId: greenRule }, { ruleId: yellowRule }]);
    expect(praises).toHaveLength(1);
    expect(praises[0].rule.title).toBe("Real loyihani muvaffaqiyatli bajardi");
    expect(penalties).toHaveLength(1);
    expect(penalties[0].rule.category).toBe("yellow");
  });
});

describe("rateIntern: green qoida shtraf bo'lmaydi", () => {
  jest.setTimeout(120000);
  let mongod;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  test("ментор отмечает green — рейтинг не падает, violationsCount не растёт", async () => {
    const branch = await Branch.create({ name: "Chilonzor" });
    const mentor = await Mentor.create({
      name: "Ment", lastName: "Or", password: "hashed-placeholder", branches: [branch._id],
    });
    const green1 = await Rule.create({ category: "green", title: "Real loyihani muvaffaqiyatli bajardi" });
    const green2 = await Rule.create({ category: "green", title: "Mars nomidan tadbirda ishtirok etdi" });
    const yellow = await Rule.create({ category: "yellow", title: "Uyga vazifani bajarmadi" });
    const intern = await Intern.create({
      name: "Muhammad", lastName: "Test", username: "mt1", password: "password123",
      grade: "middle", status: "active",
      branches: [{ branch: branch._id, mentor: mentor._id }],
    });
    const lesson = await Lesson.create({
      intern: intern._id, mentor: mentor._id, topic: "JS", time: "10:00", group: "G1",
      date: new Date(), status: "pending",
    });

    await internService.rateIntern(mentor._id, lesson._id, 5, "zo'r", [green1._id, green2._id]);

    let saved = await Intern.findById(intern._id);
    expect(saved.violations).toHaveLength(2); // yozuv saqlanadi (admin ko'radi)
    expect(saved.violationsCount || 0).toBe(0);
    expect(saved.lastViolationAt || null).toBeNull();
    for (const v of saved.violations) {
      expect(v.consequenceApplied).toBe("Rag'bat: reytingga ta'sir yo'q");
    }

    const ruleMap = buildRuleMap(await Rule.find({}).lean());
    const info = computePenalties(saved.violations, ruleMap);
    expect(info.totalDeduction).toBe(0);
    expect(info.worstLevel).toBeNull();

    // Oddiy (sariq) shtraf avvalgidek ishlaydi.
    const lesson2 = await Lesson.create({
      intern: intern._id, mentor: mentor._id, topic: "JS2", time: "11:00", group: "G1",
      date: new Date(), status: "pending",
    });
    await internService.rateIntern(mentor._id, lesson2._id, 4, "", [yellow._id]);
    saved = await Intern.findById(intern._id);
    expect(saved.violationsCount).toBe(1);
    expect(computePenalties(saved.violations, ruleMap).totalDeduction).toBe(0.5);
  });
});

describe("GET /dashboard/stats: rag'bat shtraflar ro'yxatida emas", () => {
  jest.setTimeout(120000);
  let mongod;
  const dashboardCtrl = require("../src/controllers/dashboardController");

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  test("violations — faqat shtraflar, `rule` bilan; green — praises'da", async () => {
    const branch = await Branch.create({ name: "Chilonzor" });
    const mentor = await Mentor.create({
      name: "Ment", lastName: "Or", password: "hashed-placeholder", branches: [branch._id],
    });
    const green = await Rule.create({ category: "green", title: "Mars nomidan tadbirda ishtirok etdi" });
    const yellow = await Rule.create({ category: "yellow", title: "Kechikib keldi" });
    const intern = await Intern.create({
      name: "Dash", lastName: "Board", username: "db1", password: "password123",
      grade: "middle", status: "active",
      branches: [{ branch: branch._id, mentor: mentor._id }],
      violations: [
        { ruleId: green._id, date: new Date(), issuedBy: "mentor" },
        { ruleId: yellow._id, date: new Date(), issuedBy: "mentor" },
      ],
    });

    const body = await new Promise((resolve, reject) => {
      const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        json(b) { resolve({ status: this.statusCode, body: b }); return this; },
      };
      dashboardCtrl.getDashboardStats({ user: { id: String(intern._id) } }, res).catch(reject);
    });

    expect(body.status).toBe(200);
    expect(body.body.violations).toHaveLength(1);
    expect(body.body.violations[0].rule.title).toBe("Kechikib keldi");
    expect(body.body.praises).toHaveLength(1);
    expect(body.body.praises[0].rule.title).toBe("Mars nomidan tadbirda ishtirok etdi");
    expect(body.body.penaltyInfo.totalDeduction).toBe(0.5);
    expect(body.body.penaltyInfo.worstLevel).toBe("yellow");
  });
});
