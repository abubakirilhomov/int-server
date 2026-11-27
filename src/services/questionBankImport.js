// Запись разобранного банка (utils/questionBank/parseBank) в БД.
// Идемпотентно: сравнение по contentHash. Записи, которые правил админ
// (updatedBy !== "import"), импорт не трогает — только предупреждает.
const BankQuestion = require("../models/bankQuestionModel");
const InterviewSet = require("../models/interviewSetModel");
const Setting = require("../models/settingModel");

const SOURCE = "docx";
const { BP } = require("../config/questionBankTopics");

async function upsertAll(Model, items, keyOf, toDoc, { dryRun }) {
  const report = { created: 0, updated: 0, unchanged: 0, skippedEdited: [] };
  for (const item of items) {
    const existing = await Model.findOne(keyOf(item)).select("updatedBy contentHash version").lean();
    if (!existing) {
      report.created += 1;
      if (!dryRun) await Model.create({ ...toDoc(item), updatedBy: "import" });
      continue;
    }
    if (existing.contentHash === item.contentHash) { report.unchanged += 1; continue; }
    if (existing.updatedBy && existing.updatedBy !== "import") {
      report.skippedEdited.push(JSON.stringify(keyOf(item)));
      continue;
    }
    report.updated += 1;
    if (!dryRun) {
      const update = { $set: { ...toDoc(item), updatedBy: "import" } };
      if (existing.version != null) update.$inc = { version: 1 };
      await Model.updateOne({ _id: existing._id }, update);
    }
  }
  return report;
}

// Правило трека из Python-банка: value.tracks[track]. Правило, которое правил
// админ (updatedBy ≠ "import"), импорт не трогает — только сообщает.
async function applyTrackRules(track, rules, { dryRun }) {
  const doc = await Setting.findOne({ key: "questionBankRules" }).lean();
  const cur = doc?.value?.tracks?.[track];
  if (cur && cur.updatedBy && cur.updatedBy !== "import") return "skipped";
  const next = { ...rules, updatedBy: "import" };
  const strip = (r) => { if (!r) return null; const { updatedAt, ...rest } = r; return rest; };
  if (cur && JSON.stringify(strip(cur)) === JSON.stringify(next)) return "unchanged";
  if (!dryRun) {
    await Setting.updateOne(
      { key: "questionBankRules" },
      { $set: { [`value.tracks.${track}`]: { ...next, updatedAt: new Date() } } },
      { upsert: true }
    );
  }
  return cur ? "updated" : "created";
}

async function applyBank(parsed, { dryRun = false, sourceLabel = SOURCE } = {}) {
  const isPython = parsed.format === "python";
  // Банк Node: вопросы неактивны («не включён» — notCovered), пока владелец не
  // одобрит банк и квоту; общее правило (уровни, квоты JS) не перезаписывается.
  const isNode = parsed.format === "node";
  const questions = await upsertAll(
    BankQuestion,
    parsed.questions,
    (q) => ({ code: q.code }),
    (q) => ({
      code: q.code, topic: q.topic, tracks: q.tracks, level: q.level, order: q.order,
      isPractical: q.isPractical, isMiniTask: q.isMiniTask, prompt: q.prompt, promptShort: q.promptShort,
      expectedAnswer: q.expectedAnswer, answerKind: q.answerKind, conflictGroup: q.conflictGroup,
      isActive: isPython ? q.isActive : !isNode, source: sourceLabel, contentHash: q.contentHash,
      ...(isPython ? { editor: q.editor || undefined, subtopic: q.subtopic || null, notCovered: Boolean(q.notCovered) } : {}),
      ...(isNode ? { notCovered: true } : {}),
    }),
    { dryRun }
  );
  // Правила составления наборов (квоты/уровни/conflict-группы) — только коды и
  // числа, без текста вопросов. Пишутся ДО наборов: по ним InterviewSet
  // проверяет состав по уровням при создании. JS-банк пишет общие поля и не
  // трогает value.tracks (правила треков: Python, правки из админки).
  let rules = null;
  if (parsed.rules && isPython) {
    rules = await applyTrackRules(parsed.track || BP, parsed.rules, { dryRun });
  } else if (!dryRun && parsed.rules && !isNode) {
    const { levels, minPractical, quotas, conflictGroups } = parsed.rules;
    await Setting.updateOne(
      { key: "questionBankRules" },
      { $set: { "value.levels": levels, "value.minPractical": minPractical, "value.quotas": quotas, "value.conflictGroups": conflictGroups } },
      { upsert: true }
    );
  }
  const sets = await upsertAll(
    InterviewSet,
    parsed.sets,
    (s) => ({ track: s.track, number: s.number }),
    (s) => ({
      track: s.track, number: s.number, questionCodes: s.questionCodes, size: s.size,
      source: "docx", isActive: true, contentHash: s.contentHash,
    }),
    { dryRun }
  );
  return { questions, sets, rules };
}

module.exports = { applyBank, applyTrackRules };
