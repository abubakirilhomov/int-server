/**
 * Reads the X-Active-Branch header and sets req.user.activeBranchId.
 * For multi-branch users, the client sends this header to specify context.
 * Falls back to req.user.branchId for single-branch users.
 */
module.exports = function resolveActiveBranch(req, res, next) {
  const activeBranch = req.headers["x-active-branch"];

  if (activeBranch) {
    const allowed = req.user.branchIds || (req.user.branchId ? [req.user.branchId] : []);
    if (!allowed.map(String).includes(String(activeBranch))) {
      return res.status(403).json({ message: "Нет доступа к этому филиалу" });
    }
    req.user.activeBranchId = activeBranch;
  } else {
    req.user.activeBranchId = req.user.branchId;
  }

  next();
};
