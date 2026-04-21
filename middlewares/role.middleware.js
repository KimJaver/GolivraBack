function requireRoles(allowedRoles) {
  return function roleMiddleware(req, res, next) {
    const currentRole = req.auth && req.auth.role;
    if (!currentRole || !allowedRoles.includes(currentRole)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    return next();
  };
}

module.exports = {
  requireRoles,
};
