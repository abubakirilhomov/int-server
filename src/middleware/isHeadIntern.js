module.exports = function isHeadIntern(req, res, next) {
  if (req.user?.role !== 'intern' || !req.user?.isHeadIntern) {
    return res.status(403).json({ message: 'Требуется роль Head Intern' });
  }
  next();
};
