'use strict';

/**
 * Roles del portal.
 * - OPERADOR: toma y trabaja tickets de su área (Mi panel).
 * - COORDINADOR: ve todas las áreas, asigna y cierra; administra el portal.
 * - JEFE: como el coordinador, pero solo sobre su área (`area_designada`).
 * - GERENTE: ve todas las áreas, asigna a cualquiera y administra usuarios,
 *   roles y áreas; es el único que da o quita los roles Jefe y Gerente.
 * Coordinadores y jefes marcados con "Atiende tickets" también trabajan casos.
 */

const SUPERVISORES = Object.freeze(['COORDINADOR', 'JEFE', 'GERENTE']);
const ROLES_ALTOS = Object.freeze(['JEFE', 'GERENTE']);

/** ¿Puede tomar, trabajar y responder tickets? */
function atiendeTickets(user) {
    if (!user) return false;
    return user.rol === 'OPERADOR' || ((user.rol === 'COORDINADOR' || user.rol === 'JEFE') && user.atiende_tickets === true);
}

/** Filtro de Prisma para los usuarios que atienden tickets (sin incluir `activo`). */
const ATIENDE_WHERE = Object.freeze({ OR: [{ rol: 'OPERADOR' }, { rol: { in: ['COORDINADOR', 'JEFE'] }, atiende_tickets: true }] });

/** ¿Coordina (asigna, cierra, ve Dashboard, Tickets, Turno y Reportes)? */
const esSupervisor = user => !!user && SUPERVISORES.includes(user.rol);

/** ¿Entra a Administración y Auditoría? (el jefe no: solo gestiona su área) */
const puedeAdministrar = user => !!user && (user.rol === 'COORDINADOR' || user.rol === 'GERENTE');

/** Área a la que se limita lo que ve (solo el jefe); null = todas. */
function areaScope(user) {
    if (!user || user.rol !== 'JEFE') return null;
    return user.area_designada || 'GENERAL';
}

/** Áreas de tickets visibles para el jefe: la suya y la general (sin clasificar). null = todas. */
function areasVisibles(user) {
    const area = areaScope(user);
    return area ? [...new Set([area, 'GENERAL'])] : null;
}

/** ¿El ticket (por su área) queda dentro de lo que ve este usuario? */
function ticketEnAlcance(user, areaTicket) {
    const areas = areasVisibles(user);
    return !areas || areas.includes(areaTicket || 'GENERAL');
}

/** Filtro de Prisma para tickets visibles ({} = sin límite). */
function ticketWhere(user) {
    const areas = areasVisibles(user);
    return areas ? { area_designada: { in: areas } } : {};
}

/** Filtro de Prisma para las personas visibles ({} = sin límite). */
function personaWhere(user) {
    const area = areaScope(user);
    return area ? { area_designada: area } : {};
}

/**
 * ¿Puede `actor` crear o editar a `objetivo` dándole el rol `rolNuevo`?
 * Solo el gerente toca a jefes y gerentes (salvo que aún no haya ninguno).
 * Devuelve el motivo o null si puede.
 */
function motivoNoGestionar(actor, objetivo, rolNuevo, { hayGerente = true } = {}) {
    if (!puedeAdministrar(actor)) return 'Permisos insuficientes';
    if (actor.rol === 'GERENTE') return null;
    // Mientras no haya un gerente activo, el coordinador puede nombrar al primero (y a los jefes)
    if (!hayGerente) return null;
    if (rolNuevo && ROLES_ALTOS.includes(rolNuevo)) return 'Solo el gerente puede dar los roles Jefe y Gerente';
    if (objetivo && ROLES_ALTOS.includes(objetivo.rol)) return 'Solo el gerente puede editar a jefes y gerentes';
    return null;
}

function middleware(check) {
    return function (req, res, next) {
        if (!req.user) return res.status(401).json({ success: false, error: 'Autenticación requerida' });
        if (!check(req.user)) return res.status(403).json({ success: false, error: 'Permisos insuficientes' });
        return next();
    };
}

/** Middleware: solo quien atiende tickets. */
const authorizeWorker = middleware(atiendeTickets);
/** Middleware: coordinador, jefe o gerente. */
const authorizeSupervisor = middleware(esSupervisor);
/** Middleware: coordinador o gerente (Administración y Auditoría). */
const authorizeAdmin = middleware(puedeAdministrar);

module.exports = {
    SUPERVISORES, ROLES_ALTOS,
    atiendeTickets, ATIENDE_WHERE, esSupervisor, puedeAdministrar,
    areaScope, areasVisibles, ticketEnAlcance, ticketWhere, personaWhere, motivoNoGestionar,
    authorizeWorker, authorizeSupervisor, authorizeAdmin
};
