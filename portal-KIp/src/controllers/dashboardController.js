const prisma = require('../config/prisma');
const { ACTIVE_STATES } = require('../services/metricsService');
const { getShiftStatus, getWeekStart } = require('../services/shiftService');
const { loadShiftData } = require('./turnoController');
const { buildCoordinatorPanel } = require('../services/dashboardService');
const { buildQueue } = require('../services/ticketQueueService');
const { loadActiveHandoff } = require('./ticketController');
const { AREA_NAMES } = require('../services/periodReportService');
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
        const [tickets, operadores, config] = await Promise.all([
            prisma.ticket.findMany({
                select: {
                    codigo_incidencia: true, estado_actual: true, area_designada: true, puntos_complejidad: true,
                    asignado_a_id: true, createdAt: true, updatedAt: true, fecha_asignacion: true,
                    resueltoEn: true, fecha_cierre: true
                }
            }),
            loadOperatorsWithShift(ahora),
            loadConfig(prisma)
        ]);
        const panel = buildCoordinatorPanel({ tickets, operators: operadores, now: ahora, periodo: req.query.periodo, rules: config.reglas });
        return res.render('dashboard', { titulo: 'Dashboard General', currentUser: req.user, panel });
    } catch (error) {
        console.error('Error al cargar dashboard:', error);
        return res.status(500).send('Error en el servidor');
    }
}

/**
 * Operadores con su carga activa y su estado de turno
 * (En turno / De guardia / Fuera de turno) en el instante `ahora`.
 */
async function loadOperatorsWithShift(ahora = new Date()) {
    const [operadores, { horarioPorUsuario, guardiaIds }] = await Promise.all([prisma.user.findMany({
        where: { rol: 'OPERADOR', activo: true },
        select: {
            id: true,
            email: true,
            nombre: true,
            rol: true,
            area_designada: true,
            estado_operativo: true,
            tickets_asignados: {
                // Carga activa completa: incluye recién asignados (NUEVO) y en pausa
                where: { estado_actual: { in: ACTIVE_STATES } },
                select: { codigo_incidencia: true, estado_actual: true },
                orderBy: { createdAt: 'desc' }
            }
        },
        orderBy: { nombre: 'asc' }
    }), loadShiftData(getWeekStart(ahora))]);
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
                include: {
                    ...ticketRelations,
                    asignado_a: { select: { id: true, nombre: true } },
                    adjuntos: { select: { nombre_original: true, ruta: true, peso: true } }
                },
                orderBy: { createdAt: 'desc' }
            }),
            loadOperatorsWithShift(ahora),
            prisma.ticket.count({ where: { eliminado_en: { not: null } } }),
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
    const area = req.user.area_designada || 'GENERAL';
    const availableAreas = [...new Set([area, 'GENERAL'])];
    const orderBy = { createdAt: 'desc' };
    const assignedToUser = { asignado_a_id: req.user.id };

    const [ticketsAvailable, ticketsAssigned, ticketsPaused, ticketsWaiting, ticketsResolved] = await Promise.all([
        prisma.ticket.findMany({
            where: {
                estado_actual: 'NUEVO',
                asignado_a_id: null,
                area_designada: { in: availableAreas }
            },
            include: ticketRelations,
            orderBy
        }),
        prisma.ticket.findMany({
            where: { ...assignedToUser, estado_actual: 'EN_PROGRESO' },
            include: ticketRelations,
            orderBy
        }),
        prisma.ticket.findMany({
            where: { ...assignedToUser, estado_actual: 'EN_PAUSA' },
            include: ticketRelations,
            orderBy
        }),
        prisma.ticket.findMany({
            where: { ...assignedToUser, estado_actual: 'EN_ESPERA_TERCEROS' },
            include: ticketRelations,
            orderBy
        }),
        prisma.ticket.findMany({
            where: { ...assignedToUser, estado_actual: { in: ['RESUELTO', 'CERRADO'] } },
            include: ticketRelations,
            orderBy
        })
    ]);

    return res.render('operator-dashboard', {
        titulo: 'NOC Portal - Sesión de Operador',
        currentUser: req.user,
        ticketsAvailable,
        ticketsAssigned,
        ticketsPaused,
        ticketsWaiting,
        ticketsResolved
    });
}

module.exports = { renderDashboard, renderTickets, loadOperatorsWithShift };