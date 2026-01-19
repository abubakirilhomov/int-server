module.exports = function isAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Требуется роль администратора' });
  }
  console.log("Authenticated User:", req.user); 
  next();
};