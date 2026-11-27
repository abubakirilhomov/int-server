// Conflict-группы: вопросы одной группы не попадают в один набор.
// Вопрос может входить в несколько групп (Python-банк: M8-06 конфликтует и с
// M6-09, и с M6-10, но M6-09 с M6-10 — нет), поэтому conflictGroup хранит
// список через запятую: "p7,p8". Пустое/null — групп нет.
function groupsOf(q) {
  const raw = q && q.conflictGroup;
  if (!raw) return [];
  return String(raw).split(",").map((s) => s.trim()).filter(Boolean);
}

// Списки кодов (правило файла) → { code: "p1,p7" } с префиксом id групп.
function groupIdsByCode(groups, prefix = "g") {
  const byCode = {};
  groups.forEach((g, i) => {
    const id = `${prefix}${i + 1}`;
    g.forEach((c) => { byCode[c] = byCode[c] ? `${byCode[c]},${id}` : id; });
  });
  return byCode;
}

const conflicts = (a, b) => {
  const ga = groupsOf(a);
  if (!ga.length) return false;
  const gb = new Set(groupsOf(b));
  return ga.some((g) => gb.has(g));
};

module.exports = { groupsOf, groupIdsByCode, conflicts };
