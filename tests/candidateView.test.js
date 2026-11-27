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
      editor: "js",
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
      language: "uz",
      current: 2,
      questions: [
        { position: 1, prompt: "Yopilgan savol", answerKind: "text", state: "closed" },
        { position: 2, prompt: "Ochiq savol", answerKind: "code", editor: "web", state: "open" },
      ],
    });
  });

  test("редактор по треку: web / js / jsx / vue / html / node; не код → нет поля", () => {
    const ed = (code, answerKind = "code", sandbox) => toCandidateQuestion({ code, prompt: "x", answerKind, sandbox }, 1).editor;
    expect(["H1", "C1", "J1", "R1", "V1", "T1", "N1", "A1"].map((c) => ed(c))).toEqual(["web", "web", "js", "jsx", "vue", "html", "node", "node"]);
    expect(ed("J1", "text")).toBeUndefined();
    expect(ed("J1", "choice")).toBeUndefined();
    expect(ed("C1", "sandbox", { template: "vanilla" })).toBe("js");
  });

  test("заглушка заморозки (пустой ответ без черновика) — как «ответа нет»", () => {
    const out = toCandidateSession(session, "uz", { C1: { text: "", revision: 0, frozenAt: new Date() } });
    expect(out.questions[1].answer).toBeNull();
    const real = toCandidateSession(session, "uz", { C1: { text: "", revision: 2, draftUpdatedAt: new Date(), frozenAt: new Date() } });
    expect(real.questions[1].answer).toMatchObject({ text: "", revision: 2, frozen: true });
  });

  test("ни оценок, ни заметок, ни кодов, ни сигналов, ни интервьюера", () => {
    const out = toCandidateSession(session);
    const keys = deepKeys(out);
    [...SECRET_FIELDS, "signals", "interviewer"].forEach((f) => expect(keys.has(f)).toBe(false));
    expect(JSON.stringify(out)).not.toMatch(/yaxshi|eslatma|H1|C1/);
  });

  test("aborted показывается кандидату как finished; нет открытых → current null", () => {
    const out = toCandidateSession({ status: "aborted", rev: 1, questions: [] });
    expect(out).toEqual({ status: "finished", rev: 1, language: "uz", current: null, questions: [] });
  });
});

describe("язык кандидата (uz | ru, fallback uz)", () => {
  const bilingual = {
    ...bankDoc,
    answerKind: "choice",
    sandbox: undefined,
    promptRu: "Синтетический вопрос: напишите функцию.",
    promptShortRu: "кратко",
    expectedAnswerRu: "СЕКРЕТ синтетический ответ",
    options: [
      { key: "A", text: "Birinchi", textRu: "Первый", correct: true },
      { key: "B", text: "Ikkinchi", textRu: "", correct: false },
    ],
  };

  test("ru → русский текст; вариант без перевода — на uz; верный вариант не виден", () => {
    const out = toCandidateQuestion(bilingual, 1, "ru");
    expect(out).toEqual({
      position: 1,
      prompt: "Синтетический вопрос: напишите функцию.",
      answerKind: "choice",
      options: [{ key: "A", text: "Первый" }, { key: "B", text: "Ikkinchi" }],
    });
    const keys = deepKeys(out);
    [...SECRET_FIELDS, "correct", "expectedAnswerRu", "promptShortRu", "textRu", "promptRu"].forEach((f) => expect(keys.has(f)).toBe(false));
    expect(JSON.stringify(out)).not.toMatch(/СЕКРЕТ|MAXFIY|кратко/);
  });

  test("uz, без языка и неизвестный язык → узбекский", () => {
    for (const lang of ["uz", undefined, "en", "RU-xx"]) {
      expect(toCandidateQuestion(bilingual, 1, lang).prompt).toBe("Sintetik savol: funksiya yozing.");
    }
    expect(toCandidateQuestion(bilingual, 1, "RU").prompt).toBe("Синтетический вопрос: напишите функцию.");
  });

  test("ru, но перевода нет (пусто/пробелы) → узбекский", () => {
    expect(toCandidateQuestion({ ...bankDoc, promptRu: "  " }, 1, "ru").prompt).toBe("Sintetik savol: funksiya yozing.");
  });

  test("сессия: язык сессии по умолчанию, явный язык запроса важнее", () => {
    const session = {
      status: "live", rev: 2, language: "ru",
      questions: [
        { code: "H1", order: 0, prompt: "Ochiq", promptRu: "Открытый", state: "open", openedAt: new Date() },
        { code: "J1", order: 1, prompt: "YASHIRIN", promptRu: "СКРЫТЫЙ", state: "hidden" },
      ],
    };
    const ru = toCandidateSession(session);
    expect(ru.language).toBe("ru");
    expect(ru.questions[0].prompt).toBe("Открытый");
    expect(JSON.stringify(ru)).not.toMatch(/СКРЫТЫЙ|YASHIRIN/);
    const uz = toCandidateSession(session, "uz");
    expect(uz.language).toBe("uz");
    expect(uz.questions[0].prompt).toBe("Ochiq");
  });
});
