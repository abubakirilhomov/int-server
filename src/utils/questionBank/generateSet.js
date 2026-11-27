// Генератор набора по правилу банка (чистая функция, без БД).
//
// Жёстко (иначе набор не сохраняется — InterviewSet pre-validate): состав по
// уровням из levelQuota (18 = 4/9/5 и т. д.). Если в правилах есть квоты по
// темам для трека и размера (для 16/17/19 — пропорционально ближайшему) — они
// тоже жёсткие, но если банк их не тянет вместе с уровнями, набор собирается
// по одним уровням и квоты тем показываются как нарушение. Не больше одного
// вопроса из conflict-группы.
// Мягко (подбираем, а если не вышло — отдаём нарушения, не прячем): минимум
// amaliy (rules.minPractical), хотя бы одно мини-задание, без вопросов из
// `exclude` (последние собеседования трека и прошлые попытки кандидата) —
// повторы не нарушение правила: отдаются отдельно в `repeated`, минимальными.
//
// Правило — на трек (utils/questionBank/trackRules): JS — квоты по темам, Python —
// по модулям, amaliy может зависеть от размера (Python: 6, на 20 — 7). extras —
// вопросы чужого банка сверх основного состава (Python: 0–2 HTML/CSS из JS-банка),
// подбираются из списка правила, свежие (не из `exclude`) первыми.
//
// Алгоритм: случайный жадный подбор с повторами, лучший по числу мягких нарушений.
const { levelQuota } = require("./setLevels");
const { TOPICS } = require("../../config/questionBankTopics");
const { trackRules, minPracticalFor, quotaFor } = require("./trackRules");
const { groupsOf } = require("./conflicts");

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
      const gs = groupsOf(q);
      if (gs.some((g) => conflicts.has(g))) continue;
      used.add(q.code);
      gs.forEach((g) => conflicts.add(g));
      left[q.level] -= 1;
      picked.push(q);
      need -= 1;
    }
    if (need) return null;
  }
  return LEVELS.every((l) => left[l] === 0) ? picked : null;
}

// Ремонт мягких правил обменами «тот же трек-тема-уровень»: жадный подбор берёт
// свежие вопросы и никогда не возьмёт мини-задание/amaliy из исключённых, даже
// если иначе правило нарушится. Обмен не трогает квоты тем и уровней. Повтор
// дешевле нарушения правила.
function repairSoft(picked, pool, rules, avoid, rng, { minPractical = null, extra = [] } = {}) {
  let cur = picked.slice();
  const inPicked = (code) => cur.some((q) => q.code === code);
  const hasMini = pool.some((q) => q.isMiniTask);
  const extraPractical = extra.filter((q) => q.isPractical).length;
  const extraMini = extra.some((q) => q.isMiniTask);
  const state = (qs) => ({
    mini: hasMini && !extraMini && !qs.some((q) => q.isMiniTask),
    practical: minPractical != null ? Math.max(0, minPractical - extraPractical - qs.filter((q) => q.isPractical).length) : 0,
  });
  const score = (st) => (st.mini ? 1 : 0) + st.practical;
  for (let guard = 0; guard < 40; guard += 1) {
    const st = state(cur);
    if (!score(st)) break;
    let best = null;
    for (let oi = 0; oi < cur.length; oi += 1) {
      const out = cur[oi];
      for (const cand of shuffle(pool, rng)) {
        if (cand.topic !== out.topic || cand.level !== out.level || inPicked(cand.code)) continue;
        const cg = groupsOf(cand);
        if (cg.length && cur.some((q, i) => i !== oi && groupsOf(q).some((g) => cg.includes(g)))) continue;
        const next = cur.slice(); next[oi] = cand;
        const gain = score(st) - score(state(next));
        if (gain <= 0) continue;
        const repeats = (avoid.has(cand.code) ? 1 : 0) - (avoid.has(out.code) ? 1 : 0);
        if (!best || gain > best.gain || (gain === best.gain && repeats < best.repeats)) best = { next, gain, repeats };
      }
    }
    if (!best) break;
    cur = best.next;
  }
  return cur;
}

function softViolations(qs, minPractical, pool, requireMini) {
  const v = [];
  const practical = qs.filter((q) => q.isPractical).length;
  if (minPractical != null && practical < minPractical) {
    v.push(`amaliy ${practical} < ${minPractical}`);
  }
  if ((requireMini || pool.some((q) => q.isMiniTask)) && !qs.some((q) => q.isMiniTask)) v.push("нет мини-задания");
  return v;
}

// extras трека: n вопросов из списка правила, свежие первыми.
function pickExtras(questions, tr, n, avoid, rng) {
  if (!n) return [];
  const allowed = new Set(tr.extras?.codes || []);
  const banned = new Set(tr.extras?.exclude || []);
  const cands = (questions || []).filter((q) => q.isActive !== false && allowed.has(q.code) && !banned.has(q.code));
  const ordered = [...shuffle(cands.filter((q) => !avoid.has(q.code)), rng), ...shuffle(cands.filter((q) => avoid.has(q.code)), rng)];
  return ordered.slice(0, n);
}

/**
 * @param {object} p
 * @param {Array}  p.questions  вопросы банка {code, topic, tracks, level, isPractical, isMiniTask, conflictGroup, order, isActive}
 * @param {string} p.track
 * @param {number} p.size
 * @param {object} [p.rules]    Setting questionBankRules.value или уже trackRules(…)
 * @param {Array}  [p.exclude]  коды, которых лучше избежать
 * @param {number} [p.extras]   сколько вопросов из extras правила добавить сверх size
 * @returns {{codes: string[], violations: string[], repeated: string[]}}
 *   violations — нарушения правила (amaliy, мини-задание, квоты тем);
 *   repeated — коды из exclude, которые пришлось взять (информация, не нарушение).
 */
function generateSet({ questions, track, size, rules, exclude = [], extras = 0, rng = Math.random, attempts = 400 }) {
  const tr = trackRules(rules, track);
  const want = levelQuota(size, tr);
  if (!want) throw new Error(`Нет правила уровней для набора из ${size}`);
  const nExtra = Math.max(0, Math.min(Number(extras) || 0, tr.extras?.max ?? 0));
  if (nExtra && tr.extras?.maxTotal && size + nExtra > tr.extras.maxTotal) {
    throw new Error(`Всего вопросов ${size + nExtra} > ${tr.extras.maxTotal}: уменьшите основной набор`);
  }
  const pool = (questions || []).filter((q) => q.isActive !== false && (q.tracks || []).includes(track));
  const tq = quotaFor(tr, size);
  const allTopics = [...new Set(pool.map((q) => q.topic))];
  const avoid = new Set(exclude);
  const extra = pickExtras(questions, tr, nExtra, avoid, rng);
  const minPractical = minPracticalFor(tr, size + extra.length);
  const extraGroups = new Set(extra.flatMap(groupsOf));
  const basePool = extraGroups.size ? pool.filter((q) => !groupsOf(q).some((g) => extraGroups.has(g))) : pool;

  const search = (groups) => {
    let best = null;
    for (let i = 0; i < attempts; i += 1) {
      const first = attempt(basePool, groups, want, rng, avoid);
      if (!first) continue;
      const picked = repairSoft(first, basePool, tr, avoid, rng, { minPractical, extra });
      const violations = softViolations([...extra, ...picked], minPractical, basePool, tr.requireMiniTask === true);
      const repeated = [...extra, ...picked].filter((q) => avoid.has(q.code)).map((q) => q.code);
      // Нарушение правила весит больше любого числа повторов.
      const cost = violations.length * 1000 + repeated.length;
      if (!best || cost < best.cost) best = { picked, violations, repeated, cost };
      if (!cost) break;
    }
    return best;
  };

  let best = tq ? search(tq.map((g) => ({ topics: g.topics, count: g.count }))) : null;
  if (!best) {
    best = search([{ topics: allTopics, count: size }]);
    if (best && tq) best.violations.unshift("квоты тем не соблюдены: банк не тянет их вместе с правилом уровней");
  }
  if (!best) {
    throw new Error(`Не удалось собрать набор ${track} из ${size}: в банке не хватает вопросов под правило уровней/тем`);
  }
  if (extra.length < nExtra) best.violations.push(`дополнительных вопросов в банке ${extra.length} из ${nExtra}`);
  const codes = sortSet([...extra, ...best.picked]).map((q) => q.code);
  return { codes, violations: best.violations, repeated: codes.filter((c) => avoid.has(c)), extras: extra.map((q) => q.code) };
}

module.exports = { generateSet, sortSet };
