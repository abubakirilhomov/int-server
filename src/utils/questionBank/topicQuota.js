// Квоты тем набора. Правило банка задаёт их для 15/18/20; для остальных размеров
// внутри 15–20 (16, 17, 19) квоты масштабируются пропорционально ближайшему
// заданному размеру (метод наибольшего остатка, сумма точно равна размеру).

function scaleCounts(counts, size) {
  const total = counts.reduce((s, c) => s + c, 0);
  if (!total) return counts.map(() => 0);
  const raw = counts.map((c) => (c * size) / total);
  const out = raw.map(Math.floor);
  let rest = size - out.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => {
    if (rest > 0) { out[i] += 1; rest -= 1; }
  });
  return out;
}

const sumOf = (q) => q.reduce((s, g) => s + Number(g.count || 0), 0);

// → [{topics, count}] с суммой = size, либо null (правила для трека нет).
function topicQuota(rules, track, size) {
  const byTrack = rules?.quotas?.[track];
  if (!byTrack) return null;
  const exact = byTrack[size];
  if (Array.isArray(exact) && exact.length && sumOf(exact) === size) {
    return exact.map((g) => ({ topics: g.topics, count: Number(g.count) }));
  }
  // Ближайший заданный размер (при равной близости — больший: ближе к 18).
  const sizes = Object.keys(byTrack)
    .map(Number)
    .filter((n) => Array.isArray(byTrack[n]) && byTrack[n].length && sumOf(byTrack[n]) === n)
    .sort((a, b) => Math.abs(a - size) - Math.abs(b - size) || b - a);
  if (!sizes.length) return null;
  const base = byTrack[sizes[0]];
  const counts = scaleCounts(base.map((g) => Number(g.count)), size);
  return base.map((g, i) => ({ topics: g.topics, count: counts[i] })).filter((g) => g.count > 0);
}

module.exports = { topicQuota, scaleCounts };
