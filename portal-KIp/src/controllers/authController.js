const prisma = require('../config/prisma');
const { isDevLoginEnabled } = require('../config/devLogin');
const { hashPassword, verifyPassword } = require('../services/passwordService');

function renderLogin(req, res) {
    return res.render('login');
}

async function login(req, res) {
    const { email, clave } = req.body || {};

    if (typeof email !== 'string' || !email.trim() || typeof clave !== 'string' || !clave) {
        return res.status(400).json({ success: false, message: 'Email y contraseña son obligatorios' });
    }

    try {
        const user = await prisma.user.findUnique({
            where: { email: email.trim() },
            select: { id: true, email: true, nombre: true, rol: true, area_designada: true, clave: true }
        });

        if (isDevLoginEnabled() && (!user || !user.clave)) {
            const temporaryUser = user ? {
                id: user.id,
                email: user.email,
                nombre: user.nombre,
                rol: user.rol,
                area_designada: user.area_designada
            } : {
                id: `temporary:${email.trim()}`,
                email: email.trim(),
                nombre: email.trim().split('@')[0],
                rol: 'COORDINADOR',
                area_designada: 'GENERAL'
            };
            if (user) {
                req.session.userId = user.id;
                req.session.role = user.rol;
                delete req.session.temporaryUser;
            } else {
                req.session.temporaryUser = temporaryUser;
                req.session.userId = temporaryUser.id;
                req.session.role = temporaryUser.rol;
            }
            return res.json({ success: true, redirect: '/dashboard' });
        }

        const check = user ? verifyPassword(clave, user.clave) : { ok: false };
        if (!user || !check.ok) {
            return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
        }
        if (check.needsRehash) {
            // Primera vez que entra con una contraseña guardada en texto plano: se guarda cifrada
            try {
                await prisma.user.update({ where: { id: user.id }, data: { clave: hashPassword(clave) } });
            } catch (error) {
                console.error('No se pudo actualizar el hash de la contraseña:', error.message);
            }
        }

        req.session.userId = user.id;
        req.session.role = user.rol;
        delete req.session.temporaryUser;

        return res.json({ success: true, redirect: '/dashboard' });
    } catch {
        return res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
}

function logout(req, res) {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error al destruir la sesión:', err);
            return res.status(500).json({ success: false, message: 'Error al cerrar sesión' });
        }
        return res.redirect('/auth/login');
    });
}

module.exports = { renderLogin, login, logout };
