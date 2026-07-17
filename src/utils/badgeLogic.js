const AppError = require("./AppError");
const isAdminUser = require("./isAdminUser");

// Чистая логика учёта жёлтых бейджиков — без БД, чтобы покрыть тестами
// два самых рискованных места: авторизацию по филиалу и формулу сверки.

// Разрешает филиал, на котором действует запрос:
//  - админ: глобален — берёт provided (или его первый филиал, если есть);
//  - administrator: только свой филиал — provided должен быть среди branchIds,
//    иначе (или если не указан) берётся первый его филиал; чужой → 403.
function resolveBadgeBranch(user, provided) {
  const allowed = (user.branchIds || (user.branchId ? [user.branchId] : [])).map(String);
  const p = provided ? String(provided) : null;
  if (isAdminUser(user)) return p || allowed[0] || null;
  const b = p || allowed[0] || null;
  if (!b || !allowed.includes(b)) {
    throw new AppError("Нет доступа к этому филиалу", 403);
  }
  return b;
}

// Сверка ящика: сколько должно лежать = запас − выданные на руки;
// расхождение = насчитано − ожидается (отрицательное → бейджики пропали).
function computeReconciliation(stock, openAtClose, countedInDrawer) {
  const expectedInDrawer = stock - openAtClose;
  const discrepancy = countedInDrawer - expectedInDrawer;
  return { expectedInDrawer, discrepancy };
}

module.exports = { resolveBadgeBranch, computeReconciliation };
