/**
 * Seed initial LessonCriteria documents.
 * Safe to re-run — skips existing labels.
 *
 * Usage:
 *   cd int-server
 *   node scripts/seed-lesson-criteria.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const LessonCriteria = require("../src/models/lessonCriteriaModel");

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGO_URI not set in .env");
  process.exit(1);
}

const criteria = [
  // --- NEGATIVE ---
  { label: "Ўқувчи ухлаб қолди",                    labelRu: "Студент заснул",                          type: "negative", weight: 3, category: "tempo" },
  { label: "Ментор овози паст эди",                  labelRu: "Голос ментора был тихим",                 type: "negative", weight: 1, category: "communication" },
  { label: "Ментор жуда жаҳлдор эди",               labelRu: "Ментор был груб/агрессивен",              type: "negative", weight: 2, category: "communication" },
  { label: "Ментор саволга ўзи жавоб берди",        labelRu: "Ментор отвечал на свои же вопросы",       type: "negative", weight: 2, category: "communication" },
  { label: "Ўқувчилар билан коммуникация йўқ эди", labelRu: "Не было коммуникации со студентами",      type: "negative", weight: 2, category: "communication" },
  { label: "Дарс зерикарли эди (темп паст)",        labelRu: "Урок был скучным (низкий темп)",          type: "negative", weight: 2, category: "tempo" },
  { label: "Кечикиб келган ўқувчига огоҳлантириш берилмади", labelRu: "Опоздавшему не сделали замечание", type: "negative", weight: 1, category: "discipline" },
  { label: "Мавзу яхши тушунтирилмади",             labelRu: "Тема объяснена плохо",                    type: "negative", weight: 3, category: "content" },
  { label: "Ҳаётий мисоллар келтирилмади",          labelRu: "Не было реальных примеров",               type: "negative", weight: 1, category: "content" },
  // --- POSITIVE ---
  { label: "Дарс жуда қизиқарли эди",              labelRu: "Урок был очень интересным",               type: "positive", weight: 1, category: "tempo" },
  { label: "Ментор яхши тушунтирди",               labelRu: "Ментор хорошо объяснил тему",             type: "positive", weight: 1, category: "content" },
  { label: "Савол берганда яна тушунтириб берди",  labelRu: "Переобъяснил при вопросе",                type: "positive", weight: 1, category: "communication" },
  { label: "Юмор ва яхши кайфият бор эди",        labelRu: "Был юмор и хорошая атмосфера",            type: "positive", weight: 1, category: "communication" },
  { label: "Ўқувчиларга индивидуал ёндашув бор эди", labelRu: "Был индивидуальный подход",            type: "positive", weight: 1, category: "communication" },
];

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected\n");

  let created = 0;
  let skipped = 0;

  for (const c of criteria) {
    const exists = await LessonCriteria.findOne({ label: c.label });
    if (exists) {
      skipped++;
      continue;
    }
    await LessonCriteria.create(c);
    console.log(`  [${c.type.toUpperCase()}] ${c.label}`);
    created++;
  }

  console.log(`\nДобавлено: ${created}  Пропущено: ${skipped}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
