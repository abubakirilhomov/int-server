const mongoose = require("mongoose");
const Intern = require("../src/models/internModel");

// Регресс на баг: жалобы branch manager всегда падали в 403.
// internService.addBranchManagerComplaint грузит интерна с
// .populate("branches.branch"), после чего b.branch — документ Branch, а не
// ObjectId. Прежняя реализация сравнивала b.branch.toString() с id филиала;
// у mongoose-документа toString() возвращает inspect-строку вида
// "{ _id: new ObjectId('...'), name: 'Minor' }", поэтому совпадения не было
// никогда. Методы должны давать одинаковый ответ на populate-нутом и на
// сыром документе.

const BRANCH_ID = new mongoose.Types.ObjectId();
const OTHER_BRANCH_ID = new mongoose.Types.ObjectId();
const MENTOR_ID = new mongoose.Types.ObjectId();

// Методы читают только this.branches, поэтому вызываем их на «сыром» объекте —
// так тест не требует подключения к БД.
const callOn = (method, branches, branchId) =>
  Intern.prototype[method].call({ branches }, branchId);

// Как выглядит поддокумент до populate: branch — ObjectId.
const rawBranches = [
  { branch: BRANCH_ID, mentor: MENTOR_ID, isHeadIntern: true },
  { branch: OTHER_BRANCH_ID, mentor: MENTOR_ID, isHeadIntern: false },
];

// Как выглядит после populate: branch — документ с _id и выбранными полями.
const populatedBranches = [
  {
    branch: { _id: BRANCH_ID, name: "Minor", telegramLink: "@minor" },
    mentor: MENTOR_ID,
    isHeadIntern: true,
  },
  {
    branch: { _id: OTHER_BRANCH_ID, name: "Tinchlik", telegramLink: "@tinchlik" },
    mentor: MENTOR_ID,
    isHeadIntern: false,
  },
];

describe("intern branch methods: populate-safety", () => {
  describe.each([
    ["raw (ObjectId)", rawBranches],
    ["populated (Branch doc)", populatedBranches],
  ])("%s", (_label, branches) => {
    test("isInBranch finds the branch the intern belongs to", () => {
      expect(callOn("isInBranch", branches, BRANCH_ID)).toBe(true);
      expect(callOn("isInBranch", branches, OTHER_BRANCH_ID)).toBe(true);
    });

    test("isInBranch rejects a branch the intern is not in", () => {
      expect(
        callOn("isInBranch", branches, new mongoose.Types.ObjectId())
      ).toBe(false);
    });

    test("isInBranch accepts a hex string id, not just ObjectId", () => {
      expect(callOn("isInBranch", branches, String(BRANCH_ID))).toBe(true);
    });

    test("isHeadInternAt is per-branch, not global", () => {
      expect(callOn("isHeadInternAt", branches, BRANCH_ID)).toBe(true);
      expect(callOn("isHeadInternAt", branches, OTHER_BRANCH_ID)).toBe(false);
    });

    test("getMentorForBranch resolves the mentor", () => {
      expect(String(callOn("getMentorForBranch", branches, BRANCH_ID))).toBe(
        String(MENTOR_ID)
      );
    });
  });

  test("populated and raw docs agree", () => {
    for (const id of [BRANCH_ID, OTHER_BRANCH_ID, new mongoose.Types.ObjectId()]) {
      expect(callOn("isInBranch", populatedBranches, id)).toBe(
        callOn("isInBranch", rawBranches, id)
      );
      expect(callOn("isHeadInternAt", populatedBranches, id)).toBe(
        callOn("isHeadInternAt", rawBranches, id)
      );
    }
  });

  // Раньше падало с TypeError → 500 вместо осмысленного ответа. Такое
  // возможно у пользователя без филиалов (activeBranchId === undefined).
  test("missing branchId returns false instead of throwing", () => {
    for (const empty of [undefined, null, ""]) {
      expect(() => callOn("isInBranch", rawBranches, empty)).not.toThrow();
      expect(callOn("isInBranch", rawBranches, empty)).toBe(false);
      expect(callOn("isHeadInternAt", rawBranches, empty)).toBe(false);
      expect(callOn("getMentorForBranch", rawBranches, empty)).toBeNull();
    }
  });

  test("branch entry without a branch field is skipped, not thrown on", () => {
    const broken = [{ mentor: MENTOR_ID }, { branch: null }, ...rawBranches];
    expect(() => callOn("isInBranch", broken, BRANCH_ID)).not.toThrow();
    expect(callOn("isInBranch", broken, BRANCH_ID)).toBe(true);
  });
});
