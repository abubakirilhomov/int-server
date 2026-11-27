// Редактор банка (этап 6): правка/добавление/архивирование вопросов и правка наборов.
// Только для админов (роуты auth + isAdmin). Правка вопроса НЕ трогает прошедшие и идущие
// сессии: в InterviewSession лежит снимок на момент старта (liveInterviewController.start);
// из банка по code берутся лишь ответ-черновик, исправленная сцена и тесты (их кандидат
// не видит, а на оценку они не влияют).
//
// Перевод: правка узбекского текста НЕ меняет ruSourceHash → перевод «устарел»
// (utils/questionBank/i18n.translationStatus). Правка русского текста обновляет хеш
// (перевод актуален для текущего uz). Правка обоих сразу = «перевёл при правке».
const BankQuestion = require("../models/bankQuestionModel");
const InterviewSet = require("../models/interviewSetModel");
const Setting = require("../models/settingModel");
const AppError = require("../utils/AppError");
const { TOPICS, BANK_TRACKS, CODE_PATTERN, EDITORS, defOfCode, TRACK_DEFS, TOPIC_DEFS } = require("../config/questionBankTopics");
const { normalizeDemo, normalizeDemoFix } = require("../utils/questionBank/demo");
const { normalizeTests } = require("../utils/questionBank/tests");
const { uzTextHash, translationStatus } = require("../utils/questionBank/i18n");
const { trackRules, checkComposition, validateTrackRules } = require("../utils/questionBank/trackRules");

const LEVELS = BankQuestion.LEVELS;
const ANSWER_KINDS = BankQuestion.ANSWER_KINDS;
const MAX_TEXT = 20000;
const CODE_RE = new RegExp(`^${CODE_PATTERN}$`);
const SELECT_ALL = "+expectedAnswer +expectedAnswerRu +options.correct +demoFix +tests";

const UZ_FIELDS = ["prompt", "promptShort", "expectedAnswer"];
const RU_FIELDS = ["promptRu", "promptShortRu", "expectedAnswerRu"];

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const plain = (x) => (x && typeof x.toObject === "function" ? x.toObject() : x);

function text(body, field, { required = false } = {}) {
  const v = body[field];
  if (typeof v !== "string") throw new AppError(`${field}: нужна строка`, 400);
  if (v.length > MAX_TEXT) throw new AppError(`${field}: длиннее ${MAX_TEXT} символов`, 400);
  if (required && !v.trim()) throw new AppError(`${field}: не может быть пустым`, 400);
  return v;
}

function normalizeOptions(raw) {
  if (raw === null) return [];
  if (!Array.isArray(raw)) throw new AppError("options: ожидается массив", 400);
  if (raw.length > 10) throw new AppError("options: не больше 10 вариантов", 400);
  const keys = new Set();
  return raw.map((o, i) => {
    const key = String(o?.key ?? "").trim();
    const t = String(o?.text ?? "").trim();
    if (!key || !t) throw new AppError(`options[${i}]: нужны key и text`, 400);
    if (keys.has(key)) throw new AppError(`options: повтор ключа ${key}`, 400);
    keys.add(key);
    return { key, text: t, textRu: String(o?.textRu ?? "").trim(), correct: o?.correct === true };
  });
}

// Разбор тела → набор присваиваний (только известные поля, всё проверено).
function parsePatch(body) {
  const set = {};
  if (!body || typeof body !== "object") throw new AppError("Нужно тело запроса", 400);
  for (const f of [...UZ_FIELDS, ...RU_FIELDS]) {
    if (body[f] !== undefined) set[f] = text(body, f, { required: f === "prompt" });
  }
  if (body.level !== undefined) {
    if (!LEVELS.includes(body.level)) throw new AppError(`level: ${LEVELS.join(" | ")}`, 400);
    set.level = body.level;
  }
  if (body.topic !== undefined) {
    if (!TOPICS.includes(body.topic)) throw new AppError(`topic: ${TOPICS.join(" | ")}`, 400);
    set.topic = body.topic;
  }
  if (body.tracks !== undefined) {
    if (!Array.isArray(body.tracks) || !body.tracks.length || body.tracks.some((t) => !BANK_TRACKS.includes(t))) {
      throw new AppError(`tracks: непустой список из ${BANK_TRACKS.join(", ")}`, 400);
    }
    set.tracks = [...new Set(body.tracks)];
  }
  for (const f of ["isPractical", "isMiniTask", "isActive"]) {
    if (body[f] !== undefined) {
      if (typeof body[f] !== "boolean") throw new AppError(`${f}: true | false`, 400);
      set[f] = body[f];
    }
  }
  // Включили вопрос ещё не пройденного модуля — он теперь обычный активный.
  if (set.isActive === true) set.notCovered = false;
  if (body.subtopic !== undefined) {
    const t = body.subtopic === null ? "" : String(body.subtopic).trim();
    if (t.length > 40) throw new AppError("subtopic: длиннее 40 символов", 400);
    set.subtopic = t || null;
  }
  if (body.answerKind !== undefined) {
    if (!ANSWER_KINDS.includes(body.answerKind)) throw new AppError(`answerKind: ${ANSWER_KINDS.join(" | ")}`, 400);
    set.answerKind = body.answerKind;
  }
  if (body.editor !== undefined) {
    if (body.editor !== null && body.editor !== "" && !EDITORS.includes(body.editor)) {
      throw new AppError(`editor: ${EDITORS.join(" | ")} или пусто (по префиксу кода)`, 400);
    }
    set.editor = body.editor || null; // null → $unset
  }
  if (body.conflictGroup !== undefined) {
    const g = body.conflictGroup === null ? "" : String(body.conflictGroup).trim();
    if (g.length > 60) throw new AppError("conflictGroup: длиннее 60 символов", 400);
    set.conflictGroup = g || null;
  }
  if (body.options !== undefined) set.options = normalizeOptions(body.options);
  try {
    if (body.demo !== undefined) set.demo = normalizeDemo(body.demo); // null/пустая → убрать
    if (body.demoFix !== undefined) set.demoFix = normalizeDemoFix(body.demoFix);
    if (body.tests !== undefined) set.tests = normalizeTests(body.tests);
  } catch (e) {
    throw new AppError(e.message, 400);
  }
  return set;
}

// Активные наборы, которым правка сломает состав/принадлежность (правило трека набора).
async function setsBrokenBy(code, { level, tracks, isActive }) {
  if (level === undefined && tracks === undefined && isActive === undefined) return [];
  const [sets, rules] = await Promise.all([
    InterviewSet.find({ isActive: true, questionCodes: code }).select("track number questionCodes").lean(),
    Setting.findOne({ key: "questionBankRules" }).lean(),
  ]);
  if (!sets.length) return [];
  const codes = [...new Set(sets.flatMap((s) => s.questionCodes))];
  const bank = await BankQuestion.find({ code: { $in: codes } })
    .select("code level topic tracks isPractical isMiniTask conflictGroup order").lean();
  const byCode = new Map(bank.map((q) => [q.code, { ...q }]));
  const edited = byCode.get(code);
  if (edited && level !== undefined) edited.level = level;
  if (edited && tracks !== undefined) edited.tracks = tracks;
  const broken = [];
  for (const s of sets) {
    let why = null;
    if (isActive === false) why = "вопрос архивируется";
    else if (tracks !== undefined && !tracks.includes(s.track) && !(s.questionCodes.includes(code) && trackRules(rules?.value, s.track).extras?.codes?.includes(code))) {
      why = `вопрос уходит из направления ${s.track}`;
    } else {
      const before = checkComposition(s.questionCodes.map((c) => bank.find((q) => q.code === c)).filter(Boolean), trackRules(rules?.value, s.track));
      const after = checkComposition(s.questionCodes.map((c) => byCode.get(c)).filter(Boolean), trackRules(rules?.value, s.track));
      const fresh = after.block.filter((m) => !before.block.includes(m));
      if (fresh.length) why = fresh.map((m) => m.replace(/^уровни /, "уровни станут ")).join("; ");
    }
    if (why) broken.push({ _id: s._id, track: s.track, number: s.number, reason: why });
  }
  return broken;
}

function inSetsError(broken) {
  const e = new AppError(
    `Вопрос входит в активные наборы (${broken.map((b) => `${b.track} №${b.number}: ${b.reason}`).join("; ")}). ` +
    "Сначала измените эти наборы.",
    422
  );
  e.sets = broken;
  return e;
}

// Вопрос → вид для редактора (всё, включая ответы и тесты) + статус перевода.
function view(doc) {
  const q = plain(doc);
  return { ...q, ruStatus: translationStatus(q) };
}

async function getQuestion(code) {
  return BankQuestion.findOne({ code: String(code) }).select(SELECT_ALL);
}

async function updateQuestion(code, body, actor) {
  const doc = await getQuestion(code);
  if (!doc) throw new AppError("Вопрос не найден", 404);
  const patch = parsePatch(body);

  const broken = await setsBrokenBy(doc.code, {
    level: patch.level !== undefined && patch.level !== doc.level ? patch.level : undefined,
    tracks: patch.tracks !== undefined && !same([...patch.tracks].sort(), [...doc.tracks].sort()) ? patch.tracks : undefined,
    isActive: patch.isActive === false && doc.isActive ? false : undefined,
  });
  if (broken.length) throw inSetsError(broken);

  const ruTouched = RU_FIELDS.some((f) => patch[f] !== undefined && patch[f] !== doc[f]) ||
    (patch.options && patch.options.some((o, i) => (doc.options?.[i]?.textRu ?? "") !== o.textRu));

  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (same(plain(doc)[k], v)) continue;
    changed = true;
    if (v === null || v === undefined) doc.set(k, undefined);
    else doc.set(k, v);
  }
  if (!changed) return { question: view(doc), changed: false };

  // Перевод: правка uz без ru → hash не трогаем (stale); правка ru → актуален для текущего uz.
  const after = uzTextHash(plain(doc));
  if (ruTouched) {
    doc.ruSourceHash = after;
    doc.ruUpdatedAt = new Date();
    doc.ruUpdatedBy = String(actor || "admin");
  }
  doc.version = (doc.version || 1) + 1;
  doc.updatedBy = String(actor || "admin");
  await doc.save();
  return { question: view(await getQuestion(doc.code)), changed: true };
}

async function createQuestion(body, actor) {
  const code = String(body?.code || "").trim().toUpperCase();
  if (!CODE_RE.test(code)) throw new AppError("code: буква темы + номер (J26) или модуль-номер Python (M4-26)", 400);
  const prefix = defOfCode(code);
  const patch = parsePatch(body);
  const topic = patch.topic || prefix?.topic;
  if (!patch.prompt) throw new AppError("prompt: не может быть пустым", 400);
  if (!patch.level) throw new AppError("level: обязательно", 400);
  if (await BankQuestion.exists({ code })) throw new AppError(`Вопрос ${code} уже есть`, 409);
  const last = await BankQuestion.findOne({ topic }).sort({ order: -1 }).select("order").lean();
  const doc = new BankQuestion({
    ...patch,
    code,
    topic,
    tracks: patch.tracks || prefix?.tracks || [],
    order: (last?.order || 0) + 1,
    source: "manual",
    updatedBy: String(actor || "admin"),
  });
  // новые вопросы никогда не стартуют как «перевод актуален»: ruSourceHash пуст
  if (doc.promptRu) {
    doc.ruSourceHash = uzTextHash(plain(doc));
    doc.ruUpdatedAt = new Date();
    doc.ruUpdatedBy = String(actor || "admin");
  }
  await doc.save();
  return { question: view(await getQuestion(code)) };
}

// ─── Наборы ───────────────────────────────────────────────────────────────

// Проверка состава без сохранения: block — не сохранится, warn — мягкие замечания.
async function checkSet({ track, questionCodes, ignoreSetId }) {
  const block = [];
  const warn = [];
  if (!BANK_TRACKS.includes(track)) throw new AppError(`track: ${BANK_TRACKS.join(" | ")}`, 400);
  if (!Array.isArray(questionCodes) || !questionCodes.length || questionCodes.some((c) => typeof c !== "string")) {
    throw new AppError("questionCodes: непустой список кодов", 400);
  }
  const codes = questionCodes.map((c) => c.trim());
  if (new Set(codes).size !== codes.length) block.push("в наборе есть повторы");
  const [bank, rules] = await Promise.all([
    BankQuestion.find({ code: { $in: codes } })
      .select("code level topic tracks isActive notCovered isPractical isMiniTask conflictGroup order").lean(),
    Setting.findOne({ key: "questionBankRules" }).lean(),
  ]);
  const byCode = new Map(bank.map((q) => [q.code, q]));
  const missing = codes.filter((c) => !byCode.has(c));
  if (missing.length) block.push(`нет в банке: ${missing.join(", ")}`);
  const known = codes.map((c) => byCode.get(c)).filter(Boolean);
  const notCovered = known.filter((q) => !q.isActive && q.notCovered).map((q) => q.code);
  if (notCovered.length) block.push(`ещё не пройдено: ${notCovered.join(", ")}`);
  const archived = known.filter((q) => !q.isActive && !q.notCovered).map((q) => q.code);
  if (archived.length) block.push(`в архиве: ${archived.join(", ")}`);
  const tr = trackRules(rules?.value, track);
  const comp = checkComposition(known, tr);
  const levels = comp.levels;
  comp.block.forEach((m) => { if (!(missing.length && m.startsWith("уровни"))) block.push(m); });
  warn.push(...comp.warn);
  const dup = await InterviewSet.findOne({
    track, isActive: true, questionCodes: { $all: codes, $size: codes.length },
    ...(ignoreSetId ? { _id: { $ne: ignoreSetId } } : {}),
  }).select("number").lean();
  if (dup) warn.push(`такой же набор уже есть: №${dup.number}`);
  return {
    ok: block.length === 0, block, warn, levels: { got: levels.got, want: levels.want },
    size: codes.length, baseSize: comp.baseSize, extras: comp.extras,
  };
}

// ─── Правило набора на трек ─────────────────────────────────────────────────

const RULE_FIELDS = ["levels", "quotas", "minPractical", "minPracticalBySize", "requireMiniTask", "extras"];

// Действующее правило трека + темы, по которым задаются квоты (для редактора правила).
async function getRules(track) {
  if (!BANK_TRACKS.includes(track)) throw new AppError(`track: ${BANK_TRACKS.join(" | ")}`, 400);
  const doc = await Setting.findOne({ key: "questionBankRules" }).lean();
  const tr = trackRules(doc?.value, track);
  const { __trackRules, ...rules } = tr;
  const topics = TOPIC_DEFS.filter((d) => d.tracks.includes(track)).map((d) => ({ topic: d.topic, label: d.label }));
  const counts = await BankQuestion.aggregate([
    { $match: { tracks: track } },
    { $group: { _id: { topic: "$topic", active: "$isActive" }, n: { $sum: 1 } } },
  ]);
  const inBank = {};
  counts.forEach((c) => {
    inBank[c._id.topic] = inBank[c._id.topic] || { active: 0, inactive: 0 };
    inBank[c._id.topic][c._id.active ? "active" : "inactive"] += c.n;
  });
  return { track, def: TRACK_DEFS.find((d) => d.track === track) || null, rules, topics, inBank };
}

// Сохранить правило трека из админки (перекрывает общее и импорт; повторный импорт его не тронет).
// Активные наборы, которые новое правило ломает (уровни), — отказ 422 со списком.
async function updateRules(track, body, actor) {
  if (!BANK_TRACKS.includes(track)) throw new AppError(`track: ${BANK_TRACKS.join(" | ")}`, 400);
  const input = Object.fromEntries(RULE_FIELDS.filter((k) => body?.[k] !== undefined).map((k) => [k, body[k]]));
  if (!Object.keys(input).length) throw new AppError(`Нужно хотя бы одно поле: ${RULE_FIELDS.join(", ")}`, 400);
  const { errors, value } = validateTrackRules(input);
  if (errors.length) throw new AppError(`Правило не сохранено: ${errors.join("; ")}`, 400);
  const doc = await Setting.findOne({ key: "questionBankRules" }).lean();
  const cur = trackRules(doc?.value, track);
  const { __trackRules, source, updatedBy, updatedAt, track: _t, unit, ...curRules } = cur;
  const next = { ...curRules, ...value, updatedBy: String(actor || "admin"), updatedAt: new Date() };

  const sets = await InterviewSet.find({ track, isActive: true }).select("number questionCodes").lean();
  const codes = [...new Set(sets.flatMap((s) => s.questionCodes))];
  const bank = await BankQuestion.find({ code: { $in: codes } })
    .select("code level topic tracks isPractical isMiniTask conflictGroup order").lean();
  const byCode = new Map(bank.map((q) => [q.code, q]));
  const trNext = trackRules({ tracks: { [track]: next } }, track);
  const broken = sets
    .map((s) => ({ s, r: checkComposition(s.questionCodes.map((c) => byCode.get(c)).filter(Boolean), trNext) }))
    .filter((x) => x.r.block.length)
    .map((x) => ({ _id: x.s._id, track, number: x.s.number, reason: x.r.block.join("; ") }));
  if (broken.length) {
    const e = new AppError(`Правило ломает активные наборы (${broken.map((x) => `№${x.number}: ${x.reason}`).join("; ")}). Сначала измените или архивируйте их.`, 422);
    e.sets = broken;
    throw e;
  }

  await Setting.updateOne({ key: "questionBankRules" }, { $set: { [`value.tracks.${track}`]: next } }, { upsert: true });
  return getRules(track);
}

async function createSet({ track, questionCodes }, actor) {
  const r = await checkSet({ track, questionCodes });
  if (!r.ok) throw Object.assign(new AppError(`Набор не сохранён: ${r.block.join("; ")}`, 422), { check: r });
  const last = await InterviewSet.findOne({ track }).sort({ number: -1 }).select("number").lean();
  const set = await InterviewSet.create({
    track, number: (last?.number || 0) + 1, questionCodes: questionCodes.map((c) => c.trim()),
    source: "manual", updatedBy: String(actor || "admin"),
  });
  return { set, check: r };
}

async function updateSet(id, body, actor) {
  const set = await InterviewSet.findById(id);
  if (!set) throw new AppError("Набор не найден", 404);
  let check = null;
  if (body.questionCodes !== undefined) {
    check = await checkSet({ track: set.track, questionCodes: body.questionCodes, ignoreSetId: set._id });
    if (!check.ok) throw Object.assign(new AppError(`Набор не сохранён: ${check.block.join("; ")}`, 422), { check });
    set.questionCodes = body.questionCodes.map((c) => c.trim());
    set.source = "manual";
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") throw new AppError("isActive: true | false", 400);
    // Возвращаем из архива — состав должен всё ещё удовлетворять правилу.
    if (body.isActive && !set.isActive && !check) {
      check = await checkSet({ track: set.track, questionCodes: set.questionCodes, ignoreSetId: set._id });
      if (!check.ok) throw Object.assign(new AppError(`Набор не вернуть из архива: ${check.block.join("; ")}`, 422), { check });
    }
    set.isActive = body.isActive;
  }
  set.updatedBy = String(actor || "admin");
  await set.save();
  return { set, check };
}

module.exports = {
  parsePatch, updateQuestion, createQuestion, getQuestion, checkSet, createSet, updateSet, view, SELECT_ALL,
  getRules, updateRules,
};
