// Сериализатор «вопрос/сессия для кандидата»: белый список полей.
// Данные синтетические.
const { toCandidateQuestion, toCandidateSession } = require("../src/serializers/candidateView");

const SECRET_FIELDS = ["expectedAnswer", "tests", "result", "note", "code", "level", "isPractical",
  "conflictGroup", "promptShort", "topic", "contentHash", "updatedBy", "_id"];

function deepKeys(obj, acc = new Set()) {
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) { acc.add(k); deepKeys(v, acc); }
  }
  return acc;
}

const bankDoc = {
  _id: "abc",
  code: "J99",
  topic: "js",
  level: "qiyin",
  isPractical: true,
  conflictGroup: "g1",
  promptShort: "qisqa",
  prompt: "Sintetik savol: funksiya yozing.",
  expectedAnswer: "MAXFIY sintetik javob",
  tests: [{ name: "t", code: "assert(true)" }],
  answerKind: "sandbox",
  sandbox: { template: "vanilla", files: new Map([["/index.js", "// start"]]) },
  contentHash: "h",
  updatedBy: "import",
};

describe("toCandidateQuestion", () => {
  test("только prompt, тип ответа, стартовые файлы песочницы", () => {
    const out = toCandidateQuestion(bankDoc, 1);
    expect(out).toEqual({
      position: 1,
      prompt: "Sintetik savol: funksiya yozing.",
      answerKind: "sandbox",
      sandbox: { template: "vanilla", files: { "/index.js": "// start" } },
    });
    const keys = deepKeys(out);
    SECRET_FIELDS.forEach((f) => expect(keys.has(f)).toBe(false));
    expect(JSON.stringify(out)).not.toContain("MAXFIY");
  });
});

describe("toCandidateSession", () => {
  const session = {
    status: "live",
    rev: 7,
    interviewer: "mentor-id",
    signals: [{ type: "paste" }],
    questions: [
      { code: "H1", order: 0, prompt: "Yopilgan savol", answerKind: "text", state: "closed",
        openedAt: new Date("2026-11-27T10:00:00Z"), result: "pass", note: "yaxshi" },
      { code: "C1", order: 1, prompt: "Ochiq savol", answerKind: "code", state: "open",
        openedAt: new Date("2026-11-27T10:05:00Z"), result: null, note: "eslatma" },
      { code: "J1", order: 2, prompt: "YASHIRIN savol", answerKind: "text", state: "hidden" },
      { code: "R1", order: 3, prompt: "YASHIRIN savol 2", answerKind: "text", state: "hidden" },
    ],
  };

  test("скрытые вопросы и их количество не видны", () => {
    const out = toCandidateSession(session);
    expect(out.questions).toHaveLength(2);
    expect(JSON.stringify(out)).not.toContain("YASHIRIN");
    expect(out).toEqual({
      status: "live",
      rev: 7,
      current: 2,
      questions: [
        { position: 1, prompt: "Yopilgan savol", answerKind: "text", state: "closed" },
        { position: 2, prompt: "Ochiq savol", answerKind: "code", state: "open" },
      ],
    });
  });

  test("ни оценок, ни заметок, ни кодов, ни сигналов, ни интервьюера", () => {
    const out = toCandidateSession(session);
    const keys = deepKeys(out);
    [...SECRET_FIELDS, "signals", "interviewer"].forEach((f) => expect(keys.has(f)).toBe(false));
    expect(JSON.stringify(out)).not.toMatch(/yaxshi|eslatma|H1|C1/);
  });

  test("aborted показывается кандидату как finished; нет открытых → current null", () => {
    const out = toCandidateSession({ status: "aborted", rev: 1, questions: [] });
    expect(out).toEqual({ status: "finished", rev: 1, current: null, questions: [] });
  });
});
