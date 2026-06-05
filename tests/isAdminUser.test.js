const isAdminUser = require("../src/utils/isAdminUser");

describe("isAdminUser", () => {
  test("isAdmin flag grants admin (mentor stays a teaching mentor)", () => {
    expect(isAdminUser({ role: "mentor", isAdmin: true })).toBe(true);
  });

  test("legacy role:admin still counts as admin (backward-compat, no migration)", () => {
    expect(isAdminUser({ role: "admin" })).toBe(true);
    expect(isAdminUser({ role: "admin", isAdmin: false })).toBe(true);
  });

  test("plain mentor is not admin", () => {
    expect(isAdminUser({ role: "mentor" })).toBe(false);
    expect(isAdminUser({ role: "mentor", isAdmin: false })).toBe(false);
  });

  test("branchManager without flag is not admin", () => {
    expect(isAdminUser({ role: "branchManager" })).toBe(false);
  });

  test("non-boolean truthy isAdmin does not grant admin", () => {
    // Guards against e.g. a stray string sneaking through.
    expect(isAdminUser({ role: "mentor", isAdmin: "yes" })).toBe(false);
    expect(isAdminUser({ role: "mentor", isAdmin: 1 })).toBe(false);
  });

  test("null / undefined / empty are safe", () => {
    expect(isAdminUser(null)).toBe(false);
    expect(isAdminUser(undefined)).toBe(false);
    expect(isAdminUser({})).toBe(false);
  });
});
