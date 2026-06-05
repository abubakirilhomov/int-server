const isAdminUser = require('../utils/isAdminUser');

module.exports = function isAdmin(req, res, next) {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ message: 'Требуется роль администратора' });
  }
  next();
};