// Генератор набора по правилу банка (чистая функция, без БД).
//
// Жёстко (иначе набор не сохраняется — InterviewSet pre-validate): состав по
// уровням из levelQuota (18 = 4/9/5 и т. д.). Если в правилах есть квоты по
// темам для трека и размера — они тоже жёсткие. Не больше одного вопроса из
// conflict-группы.
// Мягко (подбираем, а если не вышло — отдаём нарушения, не прячем): минимум
// amaliy (rules.minPractical), хотя бы одно мини-задание, без вопросов из
// `exclude` (последние собеседования трека и прошлые попытки кандидата).
//
// Алгоритм: случайный жадный подбор с повторами, лучший по числу мягких нарушений.
const { levelQuota } = require("./setLevels");
const { TOPICS } = require("../../config/questionBankTopics");

const LEVELS = ["oson", "orta", "qiyin"];
const LEVEL_RANK = { oson: 0, orta: 1, qiyin: 2 };

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Порядок в наборе: тема (как в банке) → от лёгкого к сложному → номер.
function sortSet(qs) {
  return qs.slice().sort((a, b) =>
    TOPICS.indexOf(a.topic) - TOPICS.indexOf(b.topic) ||
    LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
    (a.order || 0) - (b.order || 0) ||
    String(a.code).localeCompare(String(b.code))
  );
}

function topicQuotaFor(rules, track, size) {
  const q = rules?.quotas?.[track]?.[size];
  if (!Array.isArray(q) || !q.length) return null;
  const sum = q.reduce((s, g) => s + Number(g.count || 0), 0);
  return sum === size ? q : null; // квоты, не дающие размер, не применяем
}

// Одна попытка: группы (темы или одна общая) заполняются случайно, следя за
// остатком по уровням и conflict-группами. null — тупик.
function attempt(pool, groups, want, rng, avoid) {
  const left = { ...want };
  const used = new Set();
  const conflicts = new Set();
  const picked = [];
  for (const g of shuffle(groups, rng)) {
    let need = g.count;
    // Сначала «свежие» вопросы, потом из exclude.
    const cands = [
      ...shuffle(pool.filter((q) => g.topics.includes(q.topic) && !avoid.has(q.code)), rng),
      ...shuffle(pool.filter((q) => g.topics.includes(q.topic) && avoid.has(q.code)), rng),
    ];
    for (const q of cands) {
      if (!need) break;
      if (used.has(q.code) || !left[q.level]) continue;
      if (q.conflictGroup && conflicts.has(q.conflictGroup)) continue;
      used.add(q.code);
      if (q.conflictGroup) conflicts.add(q.conflictGroup);
      left[q.level] -= 1;
      picked.push(q);
      need -= 1;
    }
    if (need) return null;
  }
  return LEVELS.every((l) => left[l] === 0) ? picked : null;
}

function softViolations(qs, rules, avoid, pool) {
  const v = [];
  const practical = qs.filter((q) => q.isPractical).length;
  if (rules?.minPractical != null && practical < rules.minPractical) {
    v.push(`amaliy ${practical} < ${rules.minPractical}`);
  }
  if (pool.some((q) => q.isMiniTask) && !qs.some((q) => q.isMiniTask)) v.push("нет мини-задания");
  const repeated = qs.filter((q) => avoid.has(q.code)).map((q) => q.code);
  if (repeated.length) v.push(`повтор недавних: ${repeated.join(", ")}`);
  return v;
}

/**
 * @param {object} p
 * @param {Array}  p.questions  вопросы банка {code, topic, tracks, level, isPractical, isMiniTask, conflictGroup, order, isActive}
 * @param {string} p.track
 * @param {number} p.size
 * @param {object} [p.rules]    Setting questionBankRules.value
 * @param {Array}  [p.exclude]  коды, которых лучше избежать
 * @returns {{codes: string[], violations: string[]}}
 */
function generateSet({ questions, track, size, rules, exclude = [], rng = Math.random, attempts = 400 }) {
  const want = levelQuota(size, rules);
  if (!want) throw new Error(`Нет правила уровней для набора из ${size}`);
  const pool = (questions || []).filter((q) => q.isActive !== false && (q.tracks || []).includes(track));
  const tq = topicQuotaFor(rules, track, size);
  const groups = tq
    ? tq.map((g) => ({ topics: g.topics, count: Number(g.count) }))
    : [{ topics: [...new Set(pool.map((q) => q.topic))], count: size }];
  const avoid = new Set(exclude);

  let best = null;
  for (let i = 0; i < attempts; i += 1) {
    const picked = attempt(pool, groups, want, rng, avoid);
    if (!picked) continue;
    const violations = softViolations(picked, rules, avoid, pool);
    if (!best || violations.length < best.violations.length) best = { picked, violations };
    if (!violations.length) break;
  }
  if (!best) {
    throw new Error(`Не удалось собрать набор ${track} из ${size}: в банке не хватает вопросов под правило уровней/тем`);
  }
  return { codes: sortSet(best.picked).map((q) => q.code), violations: best.violations };
}

module.exports = { generateSet, sortSet };
