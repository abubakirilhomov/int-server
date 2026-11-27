// Penalty severity weights — how much each violation category affects rating.
// The higher the severity, the bigger the hit to the intern's rating score.
// green — bu shtraf emas, rag'bat (praise): seed-praise-rules.js, head intern
// panelidagi "Rag'batlantirish". Reytingni kamaytirmaydi.
const PENALTY_WEIGHTS = {
  green: 0,
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

const PRAISE_CATEGORY = "green";
const isPraiseCategory = (category) => category === PRAISE_CATEGORY;

// Hozircha prodda har qanday shtraf reytingdan bir xil (sariq vazn) ayiriladi:
// avval buildRuleMap qatorni qaytarar, computePenalties esa .category o'qir edi,
// natijada hamma narsa "yellow" bo'lib qolardi. Qizil/qora uchun asl vaznlarni
// (PENALTY_WEIGHTS) yoqish — egasining qarori, shu flag bilan yoqiladi.
const ENFORCE_SEVERITY_WEIGHTS = false;

function deductionFor(category) {
  if (isPraiseCategory(category)) return 0;
  return ENFORCE_SEVERITY_WEIGHTS
    ? PENALTY_WEIGHTS[category] ?? PENALTY_WEIGHTS.yellow
    : PENALTY_WEIGHTS.yellow;
}

// Violation kategoriyasini aniqlash. ruleId populate qilingan (hujjat) yoki
// ObjectId bo'lishi mumkin; ruleMap qiymati — kategoriya qatori yoki
// { category } obyekti. Qoida topilmasa — "yellow" (shtraf jim yo'qolmasin).
function resolveCategory(v, ruleMap = {}) {
  const ref = v?.ruleId;
  if (ref && typeof ref === "object" && typeof ref.category === "string") {
    return ref.category;
  }
  if (v?.rule && typeof v.rule.category === "string") return v.rule.category;
  const id = ref && typeof ref === "object" && ref._id ? ref._id : ref;
  const entry = ruleMap[String(id)];
  if (typeof entry === "string") return entry;
  if (entry && typeof entry.category === "string") return entry.category;
  return "yellow";
}

// Compute a penalty summary for an intern given their violations and a
// ruleId → category map. Returns counts per category, total deduction and
// the worst (highest severity) level currently on the intern.
// Green (rag'bat) yozuvlar shtraf emas: total/worstLevel/totalDeduction'ga
// kirmaydi, faqat counts.green va praiseCount'da ko'rinadi.
function computePenalties(violations = [], ruleMap = {}) {
  const counts = { green: 0, yellow: 0, red: 0, black: 0 };
  let totalDeduction = 0;
  let worstLevel = null;
  let total = 0;

  for (const v of violations) {
    const category = resolveCategory(v, ruleMap);
    if (counts[category] !== undefined) counts[category] += 1;
    if (isPraiseCategory(category)) continue;
    total += 1;
    totalDeduction += deductionFor(category);
    if (
      worstLevel === null ||
      SEVERITY_ORDER.indexOf(category) > SEVERITY_ORDER.indexOf(worstLevel)
    ) {
      worstLevel = category;
    }
  }

  return {
    counts,
    total,
    praiseCount: counts.green,
    totalDeduction: +totalDeduction.toFixed(2),
    worstLevel, // null | yellow | red | black
  };
}

// Intern violations'ni shtraflar va rag'batlarga ajratadi; har biriga
// populate qilingan qoidani `rule` maydonida beradi (frontend v.rule o'qiydi).
function splitViolations(violations = [], ruleMap = {}) {
  const penalties = [];
  const praises = [];
  for (const v of violations) {
    const obj = v && v.toObject ? v.toObject() : v;
    const ref = obj.ruleId;
    const rule = ref && typeof ref === "object" && ref.title !== undefined ? ref : obj.rule || null;
    const item = { ...obj, rule };
    if (isPraiseCategory(resolveCategory(obj, ruleMap))) praises.push(item);
    else penalties.push(item);
  }
  return { penalties, praises };
}

// Build a ruleId → category map from a list of Rule documents.
function buildRuleMap(rules = []) {
  const map = {};
  for (const r of rules) {
    map[String(r._id)] = r.category;
  }
  return map;
}

module.exports = {
  computePenalties,
  buildRuleMap,
  resolveCategory,
  splitViolations,
  isPraiseCategory,
  deductionFor,
  PENALTY_WEIGHTS,
  SEVERITY_ORDER,
  GRADE_ORDER,
  demoteGrade,
};