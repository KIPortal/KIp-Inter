const prisma = require('../config/prisma');
const {
    ACTIVE_STATES,
    getDayBounds,
    getHourOfDay,
    getClosingDate,
    averageResolutionMinutes,
    formatMinutes,
    computeOverload
} = require('../services/metricsService');
const { getShiftStatus, getWeekStart } = require('../services/shiftService');
const { loadShiftData } = require('./turnoController');

const ticketRelations = {
    asignado_a: { select: { id: true, nombre: true, email: true, rol: true, area_designada: true, estado_operativo: true } },
    creado_por: { select: { nombre: true, email: true } }
};

async function renderDashboard(req, res) {
    try {
        if (req.user.rol === 'OPERADOR') return await renderOperatorDashboard(req, res);

        let orderByConfig = { createdAt: 'desc' };
        const sortBy = req.query.sortBy || req.query.sort;
        const order = req.query.order === 'asc' ? 'asc' : 'desc';
        if (sortBy) {
            if (['Fecha', 'fecha', 'fecha_creacion', 'createdAt'].includes(sortBy)) {
                orderByConfig = { createdAt: order };
            } else {
                orderByConfig = { [sortBy]: order };
            }
        }

        const tickets = await prisma.ticket.findMany({
            include: ticketRelations,
            orderBy: orderByConfig
        });

        const operadoresTurno = await prisma.user.findMany({
            where: { rol: 'OPERADOR' },
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
        });
        // Turnos: cada operador recibe su estado de turno (En turno / De guardia / Fuera de turno)
        const { horarioPorUsuario, guardiaIds } = await loadShiftData(getWeekStart(new Date()));
        const ahora = new Date();
        operadoresTurno.forEach(operador => {
            const h = horarioPorUsuario.get(operador.id);
            operador.deGuardia = guardiaIds.has(operador.id);
            operador.turno = getShiftStatus({
                estadoOperativo: operador.estado_operativo,
                horario: h ? { dias: h.dias, inicio: h.hora_inicio, fin: h.hora_fin } : null,
                deGuardia: operador.deGuardia
            }, ahora);
        });
        // Disponible = en turno normal y marcado disponible (el de guardia no cuenta, pero puede recibir tickets)
        const operadores = operadoresTurno.filter(operador => operador.turno.disponible);
        const totalOperadores = operadoresTurno.length;
        const operadoresConectados = operadoresTurno.filter(operador => operador.estado_operativo !== 'AUSENTE').length;

        const ticketsActivos = await prisma.ticket.count({
            where: { estado_actual: { not: 'CERRADO' } }
        });
        // "Realizados" = cerrados durante el día de hoy (Caracas), según su fecha de cierre
        const { start: startOfDay, end: endOfDay } = getDayBounds();
        const cerradosHoy = await prisma.ticket.findMany({
            where: {
                OR: [
                    { fecha_cierre: { gte: startOfDay, lt: endOfDay } },
                    { resueltoEn: { gte: startOfDay, lt: endOfDay } }
                ]
            },
            select: { createdAt: true, fecha_cierre: true, resueltoEn: true }
        });
        const ticketsRealizados = cerradosHoy.length;
        // Tiempo de atención: promedio desde que el ticket llegó hasta que se cerró
        const tiempoAtencion = formatMinutes(averageResolutionMinutes(cerradosHoy));
        const creadosHoy = await prisma.ticket.findMany({
            where: { createdAt: { gte: startOfDay, lt: endOfDay } },
            select: { createdAt: true }
        });
        const ticketsCreadosHoy = creadosHoy.length;

        // Flujo por hora de HOY en hora de Caracas (la vista solo lo dibuja)
        const flujoHoy = { creados: new Array(24).fill(0), cerrados: new Array(24).fill(0) };
        creadosHoy.forEach(t => { flujoHoy.creados[getHourOfDay(t.createdAt)]++; });
        cerradosHoy.forEach(t => {
            const fin = getClosingDate(t);
            if (fin && fin >= startOfDay && fin < endOfDay) flujoHoy.cerrados[getHourOfDay(fin)]++;
        });
        const criticosSinAsignar = await prisma.ticket.count({
            where: {
                asignado_a_id: null,
                estado_actual: { not: 'CERRADO' },
                puntos_complejidad: { gte: 5 }
            }
        });

        // Operadores con carga activa muy por encima del promedio de su área
        const sobrecargaPorOperador = computeOverload(operadoresTurno.map(operador => ({
            id: operador.id,
            area_designada: operador.area_designada,
            estado_operativo: operador.estado_operativo,
            cargaActual: operador.tickets_asignados.length
        })));
        const alertasSobrecarga = operadoresTurno
            .filter(operador => sobrecargaPorOperador.get(operador.id)?.sobrecarga)
            .map(operador => ({
                id: operador.id,
                nombre: operador.nombre,
                area_designada: operador.area_designada,
                ticketsActivos: operador.tickets_asignados.length,
                promedioArea: sobrecargaPorOperador.get(operador.id).promedioArea,
                indiceCarga: sobrecargaPorOperador.get(operador.id).indiceCarga
            }));
        const operadoresDisponibles = operadores.length;
        const ticketCodes = await prisma.ticket.findMany({
            where: prisma.INCLUDE_DELETED, // incluye eliminados: no se reutilizan códigos
            select: { codigo_incidencia: true }
        });
        const numericCodes = ticketCodes
            .map(ticket => /^INC-(\d+)$/i.exec(String(ticket.codigo_incidencia || '').trim()))
            .filter(Boolean)
            .map(match => Number(match[1]))
            .filter(Number.isInteger);
        const nextTicketCode = `INC-${String((numericCodes.length ? Math.max(...numericCodes) : 0) + 1).padStart(3, '0')}`;

        return res.render('dashboard', {
            titulo: 'NOC Portal - Dashboard Operativo',
            ticketsActivos,
            ticketsRealizados,
            ticketsCreadosHoy,
            flujoHoy,
            criticosSinAsignar,
            tiempoAtencion,
            alertasSobrecarga,
            operadoresDisponibles,
            totalOperadores,
            operadores,
            operadoresTurno,
            operadoresConectados,
            tickets,
            nextTicketCode
        });
    } catch (error) {
        console.error('Error al cargar dashboard:', error);
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

function redirectToShiftSection(req, res) {
    return res.redirect(302, '/#gestion-turno');
}

module.exports = { renderDashboard, redirectToShiftSection };