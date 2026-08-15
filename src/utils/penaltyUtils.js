// Penalty severity weights — how much each violation category affects rating.
// The higher the severity, the bigger the hit to the intern's rating score.
const PENALTY_WEIGHTS = {
  green: 0.2,
  yellow: 0.5,
  red: 1.0,
  black: 2.0,
};

// Severity order — used to determine the "worst" penalty level for badges.
const SEVERITY_ORDER = ["green", "yellow", "red", "black"];

// Grade order (pastdan yuqoriga) — daraja pasaytirish uchun ishlatiladi.
const GRADE_ORDER = ["junior", "strongJunior", "middle", "strongMiddle", "senior"];

// Shtraf turiga qarab darajani pasaytiradi (red → -1, black → -2).
// Minimal daraja — junior. Yangi daraja oldingisidan past bo'lmasa null qaytaradi.
function demoteGrade(grade, steps = 0) {
  if (!steps || steps <= 0) return null;
  const idx = GRADE_ORDER.indexOf(grade);
  if (idx < 0) return null;
  const newIdx = Math.max(0, idx - steps);
  if (newIdx === idx) return null;
  return { from: grade, to: GRADE_ORDER[newIdx] };
}

// Compute a penalty summary for an intern given their violations and a
// ruleId → category map. Returns counts per category, total deduction and
// the worst (highest severity) level currently on the intern.
function computePenalties(violations = [], ruleMap = {}) {
  const counts = { green: 0, yellow: 0, red: 0, black: 0 };
  let totalDeduction = 0;
  let worstLevel = null;

  for (const v of violations) {
    const rule = ruleMap[String(v.ruleId)];
    // Default to yellow if the rule is missing (e.g. deleted) so a penalty
    // never silently disappears from the rating.
    const category = rule?.category || "yellow";
    if (counts[category] !== undefined) counts[category] += 1;
    totalDeduction += PENALTY_WEIGHTS[category] || 0;
    if (
      worstLevel === null ||
      SEVERITY_ORDER.indexOf(category) > SEVERITY_ORDER.indexOf(worstLevel)
    ) {
      worstLevel = category;
    }
  }

  return {
    counts,
    total: violations.length,
    totalDeduction: +totalDeduction.toFixed(2),
    worstLevel, // null | green | yellow | red | black
  };
}

// Build a ruleId → category map from a list of Rule documents.
function buildRuleMap(rules = []) {
  const map = {};
  for (const r of rules) {
    map[String(r._id)] = r.category;
  }
  return map;
}

module.exports = { computePenalties, buildRuleMap, PENALTY_WEIGHTS, SEVERITY_ORDER, GRADE_ORDER, demoteGrade };