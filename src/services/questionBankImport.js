// Запись разобранного банка (utils/questionBank/parseBank) в БД.
// Идемпотентно: сравнение по contentHash. Записи, которые правил админ
// (updatedBy !== "import"), импорт не трогает — только предупреждает.
const BankQuestion = require("../models/bankQuestionModel");
const InterviewSet = require("../models/interviewSetModel");
const Setting = require("../models/settingModel");

const SOURCE = "docx";

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

async function applyBank(parsed, { dryRun = false, sourceLabel = SOURCE } = {}) {
  const questions = await upsertAll(
    BankQuestion,
    parsed.questions,
    (q) => ({ code: q.code }),
    (q) => ({
      code: q.code, topic: q.topic, tracks: q.tracks, level: q.level, order: q.order,
      isPractical: q.isPractical, isMiniTask: q.isMiniTask, prompt: q.prompt, promptShort: q.promptShort,
      expectedAnswer: q.expectedAnswer, answerKind: q.answerKind, conflictGroup: q.conflictGroup,
      isActive: true, source: sourceLabel, contentHash: q.contentHash,
    }),
    { dryRun }
  );
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
  // Правила составления наборов (квоты/уровни/conflict-группы) — только коды и
  // числа, без текста вопросов. Нужны генератору наборов (этап 3).
  if (!dryRun && parsed.rules) {
    await Setting.updateOne(
      { key: "questionBankRules" },
      { $set: { value: parsed.rules } },
      { upsert: true }
    );
  }
  return { questions, sets };
}

module.exports = { applyBank };
