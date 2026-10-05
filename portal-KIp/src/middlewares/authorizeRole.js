function authorizeRole(...allowedRoles) {
    if (allowedRoles.length === 0) {
        throw new TypeError('authorizeRole requires at least one role');
    }

    const roles = new Set(allowedRoles);

    return function roleAuthorizationMiddleware(req, res, next) {
        if (!req.user) {
            return res.status(401).json({ success: false, error: 'Autenticación requerida' });
        }

        if (!roles.has(req.user.rol)) {
            return res.status(403).json({ success: false, error: 'Permisos insuficientes' });
        }

        return next();
    };
}

module.exports = authorizeRole;