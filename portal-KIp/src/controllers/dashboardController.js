const prisma = require('../config/prisma');
const { ACTIVE_STATES, getDayBounds } = require('../services/metricsService');
const { getShiftStatus, getWeekStart } = require('../services/shiftService');
const { loadShiftData } = require('./turnoController');
const { buildCoordinatorPanel } = require('../services/dashboardService');
const { buildQueue } = require('../services/ticketQueueService');
const { buildOperatorPanel } = require('../services/operatorPanelService');
const { ATIENDE_WHERE, atiendeTickets, ticketWhere, personaWhere } = require('../services/roleService');
const { loadActiveHandoff } = require('./ticketController');
const { AREA_NAMES } = require('../services/periodReportService');
const { MAPA_VIEWBOX, SHAPES: MAPA_SHAPES } = require('../services/mapaVenezuelaShapes');
const { loadConfig } = require('../services/configService');
const { getNextTicketCode } = require('../services/ticketCodeService');

const ticketRelations = {
    asignado_a: { select: { id: true, nombre: true, email: true, rol: true, area_designada: true, estado_operativo: true } },
    creado_por: { select: { nombre: true, email: true } }
};

async function renderDashboard(req, res) {
    if (req.user.rol === 'OPERADOR') return renderOperatorDashboard(req, res);
    try {
        // Solo lo que usa el Dashboard nuevo, en paralelo (cada consulta va a Supabase)
        const ahora = new Date();
        // El jefe de área solo ve su área (ticketWhere/personaWhere no limitan al coordinador ni al gerente)
        const [tickets, operadores, config] = await Promise.all([
            prisma.ticket.findMany({
                where: ticketWhere(req.user),
                select: {
                    codigo_incidencia: true, estado_actual: true, area_designada: true, estado_ve: true, puntos_complejidad: true,
                    asignado_a_id: true, createdAt: true, updatedAt: true, fecha_asignacion: true,
                    resueltoEn: true, fecha_cierre: true
                }
            }),
            loadOperatorsWithShift(ahora, personaWhere(req.user)),
            loadConfig(prisma)
        ]);
        const panel = buildCoordinatorPanel({ tickets, operators: operadores, now: ahora, periodo: req.query.periodo, rules: config.reglas });
        return res.render('dashboard', { titulo: 'Dashboard General', currentUser: req.user, panel, mapaViewBox: MAPA_VIEWBOX, mapaShapes: MAPA_SHAPES });
    } catch (error) {
        console.error('Error al cargar dashboard:', error);
        return res.status(500).send('Error en el servidor');
    }
}

/**
 * Operadores con su carga activa y su estado de turno
 * (En turno / De guardia / Fuera de turno) en el instante `ahora`.
 */
async function loadOperatorsWithShift(ahora = new Date(), filtro = {}) {
    const [operadores, { horarioPorUsuario, guardiaIds }] = await Promise.all([prisma.user.findMany({
        where: { activo: true, ...ATIENDE_WHERE, ...filtro },
        select: {
            id: true,
            email: true,
            nombre: true,
            rol: true,
            area_designada: true,
            telefono: true,
            subgrupo_id: true,
            estado_operativo: true,
            tickets_asignados: {
                // Carga activa completa: incluye recién asignados (NUEVO) y en pausa
                where: { estado_actual: { in: ACTIVE_STATES } },
                select: { codigo_incidencia: true, estado_actual: true },
                orderBy: { createdAt: 'desc' }
            }
        },
        orderBy: { nombre: 'asc' }
    }), loadShiftData(getWeekStart(ahora), ahora)]);
    operadores.forEach(operador => {
        const h = horarioPorUsuario.get(operador.id);
        operador.deGuardia = guardiaIds.has(operador.id);
        operador.turno = getShiftStatus({
            estadoOperativo: operador.estado_operativo,
            horario: h ? { dias: h.dias, inicio: h.hora_inicio, fin: h.hora_fin } : null,
            deGuardia: operador.deGuardia
        }, ahora);
    });
    return operadores;
}

// Cola de tickets del coordinador (rediseño, IMPLEMENTACION.md §3.2)
async function renderTickets(req, res) {
    if (req.user.rol === 'OPERADOR') return res.redirect(302, '/');
    try {
        const ahora = new Date();
        const [tickets, operadores, enPapelera, traspaso, config, siguienteCodigo] = await Promise.all([
            prisma.ticket.findMany({
                where: ticketWhere(req.user),
                include: {
                    ...ticketRelations,
                    asignado_a: { select: { id: true, nombre: true } },
                    adjuntos: { select: { nombre_original: true, ruta: true, peso: true } }
                },
                orderBy: { createdAt: 'desc' }
            }),
            loadOperatorsWithShift(ahora, personaWhere(req.user)),
            prisma.ticket.count({ where: { eliminado_en: { not: null }, ...ticketWhere(req.user) } }),
            loadActiveHandoff(ahora),
            loadConfig(prisma),
            getNextTicketCode(prisma)
        ]);
        const cola = buildQueue({ tickets, operators: operadores, now: ahora, rules: config.reglas });
        const guardias = operadores.filter(o => o.deGuardia)
            .map(o => ({ id: o.id, nombre: o.nombre, area: AREA_NAMES[o.area_designada] || o.area_designada }));

        return res.render('tickets', {
            titulo: 'Tickets',
            currentUser: req.user,
            cola,
            traspaso,
            guardias,
            enPapelera,
            siguienteCodigo,
            enTurno: operadores.filter(o => o.turno?.enTurno).length,
            plantillas: config.plantillas
        });
    } catch (error) {
        console.error('Error al cargar tickets:', error);
        return res.status(500).send('Error en el servidor');
    }
}


async function renderOperatorDashboard(req, res) {
    try {
        const ahora = new Date();
        const user = req.user;
        const area = user.area_designada || 'GENERAL';
        const hoy = getDayBounds(ahora).start;
        const detalle = ticketRelations;

        const [entrantes, mios, resueltos, operador, { horarioPorUsuario, guardiaIds }, config] = await Promise.all([
            prisma.ticket.findMany({
                where: {
                    estado_actual: 'NUEVO', asignado_a_id: null, area_designada: { in: [...new Set([area, 'GENERAL'])] },
                    ...(user.subgrupo_id ? { OR: [{ subgrupo_id: null }, { subgrupo_id: user.subgrupo_id }] } : {})
                },
                include: detalle,
                orderBy: { createdAt: 'asc' }
            }),
            prisma.ticket.findMany({
                where: { asignado_a_id: user.id, estado_actual: { in: ACTIVE_STATES } },
                include: detalle,
                orderBy: { createdAt: 'asc' }
            }),
            prisma.ticket.findMany({
                where: {
                    asignado_a_id: user.id,
                    estado_actual: { in: ['RESUELTO', 'CERRADO'] },
                    OR: [{ resueltoEn: { gte: hoy } }, { resueltoEn: null, fecha_cierre: { gte: hoy } }]
                },
                include: detalle,
                orderBy: { resueltoEn: 'desc' }
            }),
            prisma.user.findUnique({ where: { id: user.id }, select: { estado_operativo: true } }),
            loadShiftData(getWeekStart(ahora), ahora),
            loadConfig(prisma)
        ]);

        const h = horarioPorUsuario.get(user.id);
        const horario = h ? { dias: h.dias, inicio: h.hora_inicio, fin: h.hora_fin } : null;
        const deGuardia = guardiaIds.has(user.id);
        const estadoOperativo = operador?.estado_operativo || user.estado_operativo || 'DISPONIBLE';
        const turno = getShiftStatus({ estadoOperativo, horario, deGuardia }, ahora);

        // Pendientes del traspaso: solo los ve quien está de guardia
        let traspaso = null;
        let traspasoTickets = [];
        if (deGuardia) {
            traspaso = await loadActiveHandoff(ahora);
            if (traspaso && traspaso.pendientes.length) {
                traspasoTickets = await prisma.ticket.findMany({
                    where: { codigo_incidencia: { in: traspaso.pendientes } },
                    include: { asignado_a: { select: { id: true, nombre: true } } }
                });
            }
        }

        const panel = buildOperatorPanel({
            user: { ...user, estado_operativo: estadoOperativo },
            entrantes, mios, resueltos, turno, horario, deGuardia, traspaso, traspasoTickets,
            rules: config.reglas, now: ahora
        });
        return res.render('operator-dashboard', { titulo: 'Mi panel', currentUser: req.user, panel });
    } catch (error) {
        console.error('Error al cargar el panel del operador:', error);
        return res.status(500).send('Error en el servidor');
    }
}

// Mi panel del coordinador que también atiende tickets (el operador lo tiene en /)
function renderMyPanel(req, res) {
    if (req.user.rol === 'OPERADOR') return res.redirect(302, '/');
    if (!atiendeTickets(req.user)) return res.redirect(302, '/tickets');
    return renderOperatorDashboard(req, res);
}

module.exports = { renderDashboard, renderTickets, renderMyPanel, loadOperatorsWithShift };