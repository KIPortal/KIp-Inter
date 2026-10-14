'use strict';

/**
 * Quién atiende tickets: los operadores y los coordinadores marcados con
 * "Atiende tickets" en Administración (coordinan y además trabajan casos).
 */

/** ¿Puede tomar, trabajar y responder tickets? */
function atiendeTickets(user) {
    if (!user) return false;
    return user.rol === 'OPERADOR' || (user.rol === 'COORDINADOR' && user.atiende_tickets === true);
}

/** Filtro de Prisma para los usuarios que atienden tickets (sin incluir `activo`). */
const ATIENDE_WHERE = Object.freeze({ OR: [{ rol: 'OPERADOR' }, { rol: 'COORDINADOR', atiende_tickets: true }] });

/** Middleware: solo quien atiende tickets. */
function authorizeWorker(req, res, next) {
    if (!req.user) return res.status(401).json({ success: false, error: 'Autenticación requerida' });
    if (!atiendeTickets(req.user)) return res.status(403).json({ success: false, error: 'Permisos insuficientes' });
    return next();
}

module.exports = { atiendeTickets, ATIENDE_WHERE, authorizeWorker };
