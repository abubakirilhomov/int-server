// Состав набора по уровням (Абубакир, 27.11): каждое собеседование одинаково
// по сложности. Набор из 15–20 вопросов обязан иметь ровно столько oson /
// o'rta / qiyin, сколько задано правилом банка (Setting questionBankRules.levels),
// иначе он не сохраняется. Для размеров без явного правила внутри 15–20 —
// пропорционально правилу на 18 (метод наибольшего остатка).
const LEVELS = ["oson", "orta", "qiyin"];
const FALLBACK_18 = { oson: 4, orta: 9, qiyin: 5 }; // банк 27.11
const SIZE_RANGE = { min: 15, max: 20 };

function levelQuota(size, rules) {
  const explicit = rules?.levels?.[size];
  if (explicit) return { oson: explicit.oson, orta: explicit.orta, qiyin: explicit.qiyin };
  if (!(size >= SIZE_RANGE.min && size <= SIZE_RANGE.max)) return null;
  const base = rules?.levels?.[18] || FALLBACK_18;
  const baseTotal = LEVELS.reduce((s, l) => s + base[l], 0);
  const raw = LEVELS.map((l) => (base[l] * size) / baseTotal);
  const out = raw.map(Math.floor);
  let rest = size - out.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => {
    if (rest > 0) { out[i] += 1; rest -= 1; }
  });
  return Object.fromEntries(LEVELS.map((l, i) => [l, out[i]]));
}

// levels: уровни вопросов набора. Нет правила для размера → ok (не проверяется).
function checkSetLevels(levels, rules) {
  const want = levelQuota(levels.length, rules);
  const got = { oson: 0, orta: 0, qiyin: 0 };
  levels.forEach((l) => { if (l in got) got[l] += 1; });
  const ok = !want || LEVELS.every((l) => got[l] === want[l]);
  return { ok, got, want };
}

const fmt = (c) => `${c.oson}/${c.orta}/${c.qiyin}`;

module.exports = { levelQuota, checkSetLevels, fmt, SIZE_RANGE };
