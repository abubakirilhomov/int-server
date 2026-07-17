const { resolveBadgeBranch, computeReconciliation } = require("../src/utils/badgeLogic");

describe("resolveBadgeBranch — авторизация по филиалу", () => {
  const admin = { isAdmin: true, branchIds: [] };
  const adminLegacy = { role: "admin" };
  const reception = { role: "administrator", branchIds: ["A", "B"] };
  const receptionSingle = { role: "administrator", branchId: "A" };

  test("админ может действовать на любом переданном филиале", () => {
    expect(resolveBadgeBranch(admin, "Z")).toBe("Z");
    expect(resolveBadgeBranch(adminLegacy, "Z")).toBe("Z");
  });

  test("администратор ресепшена — свой филиал проходит", () => {
    expect(resolveBadgeBranch(reception, "A")).toBe("A");
    expect(resolveBadgeBranch(reception, "B")).toBe("B");
  });

  test("администратор ресепшена — чужой филиал → 403", () => {
    expect(() => resolveBadgeBranch(reception, "Z")).toThrow("Нет доступа");
    try {
      resolveBadgeBranch(reception, "Z");
    } catch (e) {
      expect(e.statusCode).toBe(403);
    }
  });

  test("администратор без явного филиала — берётся его первый/единственный", () => {
    expect(resolveBadgeBranch(reception, null)).toBe("A");
    expect(resolveBadgeBranch(receptionSingle, null)).toBe("A");
  });

  test("администратор без филиалов вообще → 403", () => {
    expect(() => resolveBadgeBranch({ role: "administrator" }, null)).toThrow("Нет доступа");
  });

  test("ObjectId-подобные значения сравниваются как строки", () => {
    const user = { role: "administrator", branchIds: [{ toString: () => "A" }] };
    expect(resolveBadgeBranch(user, { toString: () => "A" })).toBe("A");
  });
});

describe("computeReconciliation — сверка ящика", () => {
  test("всё сошлось: запас 20, на руках 5, в ящике 15 → 0", () => {
    expect(computeReconciliation(20, 5, 15)).toEqual({ expectedInDrawer: 15, discrepancy: 0 });
  });

  test("не хватает: запас 20, на руках 5, насчитали 14 → −1", () => {
    expect(computeReconciliation(20, 5, 14)).toEqual({ expectedInDrawer: 15, discrepancy: -1 });
  });

  test("лишние (нашли/вернули лишний): 20, 5, 16 → +1", () => {
    expect(computeReconciliation(20, 5, 16)).toEqual({ expectedInDrawer: 15, discrepancy: 1 });
  });

  test("все на руках: запас 10, на руках 10, в ящике 0 → сходится", () => {
    expect(computeReconciliation(10, 10, 0)).toEqual({ expectedInDrawer: 0, discrepancy: 0 });
  });
});
