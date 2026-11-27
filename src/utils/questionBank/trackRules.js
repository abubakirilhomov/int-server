// Правило набора на трек (чистые функции, без БД).
//
// Setting "questionBankRules".value:
//   levels, minPractical, quotas: { [track]: { [size]: [{topics, count}] } }, conflictGroups
//     — общие поля, их пишет импорт JS-банка (квоты по темам для React и Vue);
//   tracks: { [track]: { levels, minPractical, minPracticalBySize, requireMiniTask,
//                        quotas: { [size]: [{topics, count}] }, conflictGroups,
//                        extras: { codes, exclude, max, maxTotal }, order, updatedBy, updatedAt } }
//     — правило конкретного трека (Python: квоты по модулям; правка из админки).
//     Поле трека перекрывает общее.
//
// extras — вопросы чужого банка, которые трек может взять сверх основного состава
// (Python: HTML/CSS модулей 1–2 из JS-банка, не больше 1–2, всего не больше 20).
// Уровни и квоты проверяются по основному составу; extras — только лимитами.
const { levelQuota, fmt } = require("./setLevels");
const { topicQuota } = require("./topicQuota");
const { groupsOf } = require("./conflicts");
const { TOPICS, trackUnit } = require("../../config/questionBankTopics");

const LEVEL_RANK = { oson: 0, orta: 1, qiyin: 2 };
const SIZES = [15, 18, 20];

function trackRules(doc, track) {
  const v = doc || {};
  if (v.track === track && v.__trackRules) return v; // уже нормализовано
  const own = (v.tracks && v.tracks[track]) || null;
  const pick = (k, fallback) => (own && own[k] !== undefined && own[k] !== null ? own[k] : fallback);
  return {
    __trackRules: true,
    track,
    unit: trackUnit(track),
    levels: pick("levels", v.levels || null),
    minPractical: pick("minPractical", v.minPractical ?? null),
    minPracticalBySize: pick("minPracticalBySize", {}),
    requireMiniTask: pick("requireMiniTask", null),
    quotas: pick("quotas", (v.quotas && v.quotas[track]) || null),
    conflictGroups: pick("conflictGroups", v.conflictGroups || []),
    extras: pick("extras", null),
    order: pick("order", null),
    source: own ? (own.updatedBy && own.updatedBy !== "import" ? "admin" : "import") : "global",
    updatedBy: own?.updatedBy || null,
    updatedAt: own?.updatedAt || null,
  };
}

function minPracticalFor(tr, size) {
  const bySize = tr?.minPracticalBySize?.[size];
  if (bySize != null) return Number(bySize);
  return tr?.minPractical != null ? Number(tr.minPractical) : null;
}

const quotaFor = (tr, size) => (tr?.quotas ? topicQuota({ quotas: { [tr.track]: tr.quotas } }, tr.track, size) : null);
const extrasCodes = (tr) => new Set(tr?.extras?.codes || []);

// Вопрос — extra трека (из чужого банка, но разрешён правилом).
const isExtra = (q, tr) => !(q.tracks || []).includes(tr.track) && extrasCodes(tr).has(q.code);

// Порядок «модуль → от лёгкого к сложному → номер» (правило Python-банка).
const orderKey = (q) => [TOPICS.indexOf(q.topic), LEVEL_RANK[q.level] ?? 9, q.order || 0];
function isOrdered(qs) {
  for (let i = 1; i < qs.length; i += 1) {
    const a = orderKey(qs[i - 1]);
    const b = orderKey(qs[i]);
    for (let k = 0; k < a.length; k += 1) {
      if (a[k] < b[k]) break;
      if (a[k] > b[k]) return false;
    }
  }
  return true;
}

/**
 * Состав набора против правила трека. qs — вопросы набора по порядку
 * ({code, topic, tracks, level, isPractical, isMiniTask, conflictGroup, order}).
 * block — набор не сохраняется (уровни, лимиты extras, чужие вопросы);
 * warn — мягкие нарушения (квоты тем/модулей, amaliy, мини-задание, conflict, порядок).
 */
function checkComposition(qs, tr) {
  const block = [];
  const warn = [];
  const warnKinds = []; // вид каждого warn: quota | practical | mini | conflict | order
  const w = (kind, msg) => { warn.push(msg); warnKinds.push(kind); };
  const extras = qs.filter((q) => isExtra(q, tr));
  const base = qs.filter((q) => !isExtra(q, tr));

  const foreign = base.filter((q) => !(q.tracks || []).includes(tr.track)).map((q) => q.code);
  if (foreign.length) block.push(`не из направления ${tr.track}: ${foreign.join(", ")}`);
  const banned = qs.filter((q) => (tr.extras?.exclude || []).includes(q.code)).map((q) => q.code);
  if (banned.length) block.push(`по правилу не брать: ${banned.join(", ")}`);
  if (extras.length) {
    const max = tr.extras?.max ?? 0;
    if (extras.length > max) block.push(`дополнительных вопросов ${extras.length} > ${max}`);
    if (tr.extras?.maxTotal && qs.length > tr.extras.maxTotal) block.push(`всего вопросов ${qs.length} > ${tr.extras.maxTotal}`);
  }

  const size = base.length;
  const want = levelQuota(size, tr);
  const got = { oson: 0, orta: 0, qiyin: 0 };
  base.forEach((q) => { if (q.level in got) got[q.level] += 1; });
  const levelsOk = !want || ["oson", "orta", "qiyin"].every((l) => got[l] === want[l]);
  if (!levelsOk) block.push(`уровни ${fmt(got)}, по правилу ${fmt(want)} (oson/o'rta/qiyin) — собеседования должны быть одинаковыми по сложности`);

  const quota = quotaFor(tr, size);
  if (quota) {
    for (const g of quota) {
      const n = base.filter((q) => g.topics.includes(q.topic)).length;
      if (n !== g.count) w("quota", `${g.topics.join("+")}: ${n}, по правилу ${g.count}`);
    }
    const covered = new Set(quota.flatMap((g) => g.topics));
    const outside = base.filter((q) => !covered.has(q.topic)).map((q) => q.code);
    if (outside.length) w("quota", `вне квот правила: ${outside.join(", ")}`);
  }
  const minP = minPracticalFor(tr, qs.length);
  const practical = qs.filter((q) => q.isPractical).length;
  if (minP != null && practical < minP) w("practical", `amaliy ${practical} < ${minP}`);
  if (tr.requireMiniTask === true && !qs.some((q) => q.isMiniTask)) w("mini", "нет мини-задания");

  const byGroup = new Map();
  qs.forEach((q) => groupsOf(q).forEach((g) => byGroup.set(g, [...(byGroup.get(g) || []), q.code])));
  for (const [g, list] of byGroup) if (list.length > 1) w("conflict", `одна идея в одном наборе (${g}): ${list.join(", ")}`);

  if (tr.order === "module-level" && !isOrdered(base)) w("order", "порядок: по модулям, внутри модуля от лёгкого к сложному");

  return { block, warn, warnKinds, levels: { got, want, ok: levelsOk }, baseSize: size, extras: extras.map((q) => q.code) };
}

// Проверка правила трека перед сохранением из админки: суммы квот и уровней = размер.
function validateTrackRules(input) {
  const errors = [];
  const out = {};
  if (input.levels !== undefined) {
    out.levels = {};
    for (const [size, lv] of Object.entries(input.levels || {})) {
      const n = Number(size);
      const vals = ["oson", "orta", "qiyin"].map((l) => Number(lv?.[l]));
      if (!SIZES.includes(n) || vals.some((x) => !Number.isInteger(x) || x < 0)) { errors.push(`levels.${size}: целые ≥ 0 для 15/18/20`); continue; }
      if (vals.reduce((a, b) => a + b, 0) !== n) errors.push(`levels.${size}: сумма ${vals.reduce((a, b) => a + b, 0)} ≠ ${n}`);
      out.levels[n] = { oson: vals[0], orta: vals[1], qiyin: vals[2] };
    }
  }
  if (input.quotas !== undefined) {
    out.quotas = {};
    for (const [size, list] of Object.entries(input.quotas || {})) {
      const n = Number(size);
      if (!SIZES.includes(n) || !Array.isArray(list)) { errors.push(`quotas.${size}: список для 15/18/20`); continue; }
      const rows = list.map((g) => ({
        topics: (Array.isArray(g?.topics) ? g.topics : []).map(String),
        count: Number(g?.count),
      }));
      for (const r of rows) {
        if (!r.topics.length || r.topics.some((t) => !TOPICS.includes(t))) errors.push(`quotas.${size}: неизвестная тема ${r.topics.join("+")}`);
        if (!Number.isInteger(r.count) || r.count < 0) errors.push(`quotas.${size}: count целое ≥ 0`);
      }
      const sum = rows.reduce((a, r) => a + (Number.isFinite(r.count) ? r.count : 0), 0);
      if (sum !== n) errors.push(`quotas.${size}: сумма ${sum} ≠ ${n}`);
      out.quotas[n] = rows.filter((r) => r.count > 0);
    }
  }
  if (input.minPractical !== undefined) {
    const n = Number(input.minPractical);
    if (!Number.isInteger(n) || n < 0 || n > 20) errors.push("minPractical: 0–20");
    out.minPractical = n;
  }
  if (input.minPracticalBySize !== undefined) {
    out.minPracticalBySize = {};
    for (const [size, v] of Object.entries(input.minPracticalBySize || {})) {
      const n = Number(v);
      if (!SIZES.includes(Number(size)) || !Number.isInteger(n) || n < 0 || n > 20) { errors.push(`minPracticalBySize.${size}: 0–20`); continue; }
      out.minPracticalBySize[Number(size)] = n;
    }
  }
  if (input.requireMiniTask !== undefined) {
    if (typeof input.requireMiniTask !== "boolean") errors.push("requireMiniTask: true | false");
    out.requireMiniTask = input.requireMiniTask;
  }
  if (input.extras !== undefined && input.extras !== null) {
    const e = input.extras;
    const max = Number(e.max ?? 0);
    const maxTotal = Number(e.maxTotal ?? 20);
    if (!Number.isInteger(max) || max < 0 || max > 5) errors.push("extras.max: 0–5");
    if (!Number.isInteger(maxTotal) || maxTotal < 15 || maxTotal > 25) errors.push("extras.maxTotal: 15–25");
    out.extras = {
      codes: (Array.isArray(e.codes) ? e.codes : []).map((c) => String(c).trim()).filter(Boolean),
      exclude: (Array.isArray(e.exclude) ? e.exclude : []).map((c) => String(c).trim()).filter(Boolean),
      max, maxTotal,
    };
  }
  return { errors, value: out };
}

module.exports = {
  trackRules, minPracticalFor, quotaFor, isExtra, isOrdered, checkComposition, validateTrackRules, SIZES,
};
