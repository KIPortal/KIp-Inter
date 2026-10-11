const prisma = require('../config/prisma');

async function requireAuth(req, res, next) {
    if (req.session?.temporaryUser && process.env.NODE_ENV !== 'production') {
        const { id, email, nombre, rol, area_designada } = req.session.temporaryUser;
        req.user = { id, email, nombre, rol, area_designada: area_designada || 'GENERAL' };
        req.session.temporaryUser = req.user;
        return next();
    }

    const userId = req.session?.userId;
    if (!userId) {
        return unauthenticated(req, res);
    }

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, email: true, nombre: true, rol: true, area_designada: true }
        });

        if (!user) {
            return req.session.destroy(() => unauthenticated(req, res));
        }

        req.user = user;
        return next();
    } catch (error) {
        console.error('Error al verificar la sesión:', error);
        if (isApiRequest(req)) return res.status(500).json({ success: false, error: 'Error en el servidor' });
        return res.status(500).send('Error en el servidor');
    }
}

function isApiRequest(req) {
    return req.originalUrl?.split('?')[0].startsWith('/api/');
}

function unauthenticated(req, res) {
    if (isApiRequest(req)) return res.status(401).json({ success: false, error: 'Autenticación requerida' });
    return res.redirect('/auth/login');
}

module.exports = requireAuth;