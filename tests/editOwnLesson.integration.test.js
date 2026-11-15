// Правка своего урока интерном против in-memory Mongo: проверяем, что условие
// status:"pending" действительно стоит в update-запросе, $unset работает,
// lessonsVisited синхронизируется и урок попадает в pending нового ментора.
jest.mock("../src/controllers/notificationController", () => ({
  sendNotificationToUser: jest.fn().mockResolvedValue(),
}));
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const lessonCtrl = require("../src/controllers/lessonController");
const Lesson = require("../src/models/lessonModel");
const Mentor = require("../src/models/mentorModel");
const { TASHKENT_OFFSET_MS } = require("../src/utils/tashkentTime");

jest.setTimeout(120000);
let mongod;

function call(handler, ctx = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200, body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; resolve(this); return this; },
    };
    handler({ params: {}, body: {}, query: {}, headers: {}, ...ctx }, res, (e) => (e ? reject(e) : resolve(res)));
  });
}
const wall = (d) => new Date(d.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 16);

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test("pending → editable (mentor switch reaches new mentor), confirmed → 409", async () => {
  const internId = new mongoose.Types.ObjectId();
  const [mA, mB] = await Mentor.insertMany([
    { name: "A", lastName: "One", password: "x", role: "mentor" },
    { name: "B", lastName: "Two", password: "x", role: "mentor" },
  ]);
  const time = wall(new Date(Date.now() - 3 * 3600 * 1000));
  const lesson = await Lesson.create({
    intern: internId, mentor: mA._id, topic: "JS", group: "G1", time,
    date: new Date(), status: "pending", feedback: "🔥",
  });
  await mongoose.connection.collection("interns").insertOne({
    _id: internId, name: "I", lessonsVisited: [{ mentorId: mA._id, lessonId: lesson._id, count: 1, date: lesson.date }],
  });
  const user = { role: "intern", id: String(internId) };

  const ok = await call(lessonCtrl.editOwnLesson, {
    user, params: { id: String(lesson._id) }, body: { mentor: String(mB._id), group: "G2", feedback: "" },
  });
  expect(ok.statusCode).toBe(200);
  const after = await Lesson.findById(lesson._id).lean();
  expect(String(after.mentor)).toBe(String(mB._id));
  expect(after.group).toBe("G2");
  expect(after.status).toBe("pending");
  expect(after.feedback).toBeUndefined();

  const iv = await mongoose.connection.collection("interns").findOne({ _id: internId });
  expect(String(iv.lessonsVisited[0].mentorId)).toBe(String(mB._id));

  // Новый ментор видит урок в своём pending-списке, старый — нет.
  expect(await Lesson.countDocuments({ mentor: mB._id, status: "pending" })).toBe(1);
  expect(await Lesson.countDocuments({ mentor: mA._id, status: "pending" })).toBe(0);

  await Lesson.updateOne({ _id: lesson._id }, { status: "confirmed", isRated: true });
  const blocked = await call(lessonCtrl.editOwnLesson, {
    user, params: { id: String(lesson._id) }, body: { topic: "hack" },
  });
  expect(blocked.statusCode).toBe(409);
  expect((await Lesson.findById(lesson._id).lean()).topic).toBe("JS");

  const stranger = await call(lessonCtrl.editOwnLesson, {
    user: { role: "intern", id: String(new mongoose.Types.ObjectId()) },
    params: { id: String(lesson._id) }, body: { topic: "x" },
  });
  expect(stranger.statusCode).toBe(403);
});
