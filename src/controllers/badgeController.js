const Intern = require("../models/internModel");
const Branch = require("../models/branchModel");
const BadgeEvent = require("../models/badgeEventModel");
const BadgeReconciliation = require("../models/badgeReconciliationModel");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { resolveBadgeBranch, computeReconciliation } = require("../utils/badgeLogic");

// ─── helpers ────────────────────────────────────────────────────────────────

function actorName(user) {
  return `${user.name || ""} ${user.lastName || ""}`.trim();
}

function internBranchIds(intern) {
  return (intern.branches || []).map((b) => String(b.branch?._id || b.branch));
}

// ─── board: живая доска ресепшена одного филиала ──────────────────────────────
exports.board = catchAsync(async (req, res) => {
  const branchId = resolveBadgeBranch(req.user, req.query.branch || req.headers["x-active-branch"]);
  if (!branchId) throw new AppError("Укажите филиал (branch)", 400);

  const branch = await Branch.findById(branchId).select("name badgeStock");
  if (!branch) throw new AppError("Филиал не найден", 404);

  const interns = await Intern.find({ "branches.branch": branchId, status: "active" })
    .select("name lastName username receptionBadge")
    .sort({ "receptionBadge.hasBadge": -1, name: 1 });

  // Сколько бейджиков этого филиала физически на руках (у кого угодно, любой статус).
  const out = await Intern.countDocuments({
    "receptionBadge.hasBadge": true,
    "receptionBadge.branch": branchId,
  });
  // Утечки: держит бейджик этого филиала, но уже не активный интерн здесь.
  const leaks = await Intern.find({
    "receptionBadge.hasBadge": true,
    "receptionBadge.branch": branchId,
    status: { $ne: "active" },
  }).select("name lastName username status receptionBadge");

  res.json({
    branch: { _id: branch._id, name: branch.name, badgeStock: branch.badgeStock },
    counts: {
      stock: branch.badgeStock,
      out,
      inDrawer: branch.badgeStock - out,
      activeInterns: interns.length,
      leaks: leaks.length,
    },
    interns: interns.map((i) => ({
      _id: i._id,
      name: i.name,
      lastName: i.lastName,
      username: i.username,
      hasBadge: !!i.receptionBadge?.hasBadge,
      since: i.receptionBadge?.since || null,
    })),
    leaks: leaks.map((i) => ({
      _id: i._id,
      name: i.name,
      lastName: i.lastName,
      status: i.status,
      since: i.receptionBadge?.since || null,
    })),
  });
});

// ─── toggle: выдать / принять / списать бейджик у интерна ──────────────────────
exports.toggleBadge = catchAsync(async (req, res) => {
  const { action, note } = req.body;
  const intern = await Intern.findById(req.params.internId).select(
    "name lastName username status receptionBadge branches"
  );
  if (!intern) throw new AppError("Интерн не найден", 404);

  const branchIds = internBranchIds(intern);
  // Филиал: из тела/заголовка, иначе единственный филиал интерна.
  const provided = req.body.branch || req.headers["x-active-branch"] ||
    (branchIds.length === 1 ? branchIds[0] : null);
  const branchId = resolveBadgeBranch(req.user, provided);
  if (!branchId) throw new AppError("Укажите филиал (branch)", 400);
  if (!branchIds.includes(branchId)) {
    throw new AppError("Интерн не привязан к этому филиалу", 400);
  }

  let eventAction;
  if (action === "give") {
    if (intern.receptionBadge?.hasBadge) {
      throw new AppError("Бейджик уже выдан этому интерну", 400);
    }
    intern.receptionBadge = {
      hasBadge: true,
      since: new Date(),
      branch: branchId,
      givenBy: req.user.id,
    };
    eventAction = "given";
  } else {
    // return | lost — у интерна должен быть выданный бейджик
    if (!intern.receptionBadge?.hasBadge) {
      throw new AppError("У интерна нет выданного бейджика", 400);
    }
    intern.receptionBadge = { hasBadge: false, since: null, branch: null, givenBy: null };
    eventAction = action === "lost" ? "lost" : "returned";
    // 'lost' — бейджик физически пропал → уменьшаем запас филиала (не ниже 0)
    if (action === "lost") {
      await Branch.updateOne(
        { _id: branchId, badgeStock: { $gt: 0 } },
        { $inc: { badgeStock: -1 } }
      );
    }
  }

  await intern.save();
  await BadgeEvent.create({
    intern: intern._id,
    branch: branchId,
    action: eventAction,
    by: req.user.id,
    byName: actorName(req.user),
    note: note || "",
  });

  res.json({
    success: true,
    internId: intern._id,
    hasBadge: !!intern.receptionBadge?.hasBadge,
    action: eventAction,
    branch: branchId,
  });
});

// ─── closeDay: сверка ящика при закрытии филиала ──────────────────────────────
exports.closeDay = catchAsync(async (req, res) => {
  const branchId = resolveBadgeBranch(req.user, req.body.branch || req.headers["x-active-branch"]);
  if (!branchId) throw new AppError("Укажите филиал (branch)", 400);

  const branch = await Branch.findById(branchId).select("name badgeStock");
  if (!branch) throw new AppError("Филиал не найден", 404);

  const counted = Number(req.body.countedInDrawer);
  const openAtClose = await Intern.countDocuments({
    "receptionBadge.hasBadge": true,
    "receptionBadge.branch": branchId,
  });
  const { expectedInDrawer, discrepancy } = computeReconciliation(
    branch.badgeStock,
    openAtClose,
    counted
  );

  const rec = await BadgeReconciliation.create({
    branch: branchId,
    stock: branch.badgeStock,
    openAtClose,
    expectedInDrawer,
    countedInDrawer: counted,
    discrepancy,
    by: req.user.id,
    byName: actorName(req.user),
    note: req.body.note || "",
  });

  // Кто не сдал бейджик к закрытию — для сигнала.
  const stillOut = await Intern.find({
    "receptionBadge.hasBadge": true,
    "receptionBadge.branch": branchId,
  }).select("name lastName username status receptionBadge");

  res.status(201).json({
    reconciliation: rec,
    openLoans: stillOut.map((i) => ({
      _id: i._id,
      name: i.name,
      lastName: i.lastName,
      status: i.status,
      since: i.receptionBadge?.since || null,
    })),
  });
});

// ─── setStock: инвентаризация (задать запас филиала) ──────────────────────────
exports.setStock = catchAsync(async (req, res) => {
  const { branch, badgeStock } = req.body;
  const branchDoc = await Branch.findByIdAndUpdate(
    branch,
    { badgeStock: Number(badgeStock) },
    { new: true, runValidators: true }
  ).select("name badgeStock");
  if (!branchDoc) throw new AppError("Филиал не найден", 404);
  res.json({ _id: branchDoc._id, name: branchDoc.name, badgeStock: branchDoc.badgeStock });
});

// ─── internHistory: полная история бейджика конкретного интерна (доказательство) ─
exports.internHistory = catchAsync(async (req, res) => {
  const events = await BadgeEvent.find({ intern: req.params.internId })
    .sort({ at: -1 })
    .limit(100)
    .populate("branch", "name");
  res.json(events);
});

// ─── report: сводка по всем филиалам (только админ) ───────────────────────────
exports.report = catchAsync(async (req, res) => {
  const branches = await Branch.find().select("name badgeStock").sort({ name: 1 });

  const agg = await Intern.aggregate([
    { $match: { "receptionBadge.hasBadge": true, "receptionBadge.branch": { $ne: null } } },
    {
      $group: {
        _id: "$receptionBadge.branch",
        out: { $sum: 1 },
        leaks: { $sum: { $cond: [{ $ne: ["$status", "active"] }, 1, 0] } },
      },
    },
  ]);
  const outBy = new Map(agg.map((o) => [String(o._id), o]));

  const perBranch = branches.map((b) => {
    const o = outBy.get(String(b._id)) || { out: 0, leaks: 0 };
    return {
      branch: { _id: b._id, name: b.name },
      stock: b.badgeStock,
      out: o.out,
      inDrawer: b.badgeStock - o.out,
      leaks: o.leaks,
    };
  });
  const totals = perBranch.reduce(
    (a, p) => ({
      stock: a.stock + p.stock,
      out: a.out + p.out,
      inDrawer: a.inDrawer + p.inDrawer,
      leaks: a.leaks + p.leaks,
    }),
    { stock: 0, out: 0, inDrawer: 0, leaks: 0 }
  );

  // Детали утечек: держат бейджик, но не активны (кейс "отдал другу").
  const leakList = await Intern.find({
    "receptionBadge.hasBadge": true,
    status: { $ne: "active" },
  })
    .select("name lastName username status receptionBadge")
    .populate("receptionBadge.branch", "name");

  const recentReconciliations = await BadgeReconciliation.find()
    .sort({ date: -1 })
    .limit(20)
    .populate("branch", "name");

  res.json({
    totals,
    perBranch,
    leaks: leakList.map((i) => ({
      _id: i._id,
      name: i.name,
      lastName: i.lastName,
      username: i.username,
      status: i.status,
      branch: i.receptionBadge?.branch || null,
      since: i.receptionBadge?.since || null,
    })),
    recentReconciliations,
  });
});
