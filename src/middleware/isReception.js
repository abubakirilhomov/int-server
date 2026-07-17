const isAdminUser = require("../utils/isAdminUser");

// Пускает администраторов ресепшена (role: 'administrator') и обычных админов.
// Учёт жёлтых бейджиков ведёт ресепшен своего филиала; админ — глобально.
// Привязка к филиалу (свой ли это филиал для 'administrator') проверяется
// в контроллере через resolveBadgeBranch.
module.exports = function isReception(req, res, next) {
  if (isAdminUser(req.user) || req.user?.role === "administrator") return next();
  return res.status(403).json({ message: "Требуется роль администратора ресепшена" });
};
