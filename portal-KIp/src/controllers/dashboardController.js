const prisma = require('../config/prisma');

const ticketRelations = {
    asignado_a: { select: { id: true, nombre: true, email: true, rol: true, area_designada: true, estado_operativo: true } },
    creado_por: { select: { nombre: true, email: true } }
};

async function renderDashboard(req, res) {
    try {
        if (req.user.rol === 'OPERADOR') return await renderOperatorDashboard(req, res);

        const tickets = await prisma.ticket.findMany({
            include: ticketRelations,
            orderBy: { createdAt: 'desc' }
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
                    where: { estado_actual: { in: ['EN_PROGRESO', 'EN_ESPERA_TERCEROS'] } },
                    select: { codigo_incidencia: true, estado_actual: true },
                    orderBy: { createdAt: 'desc' }
                }
            },
            orderBy: { nombre: 'asc' }
        });
        const operadores = operadoresTurno.filter(operador => operador.estado_operativo === 'DISPONIBLE');
        const totalOperadores = operadoresTurno.length;
        const operadoresConectados = operadoresTurno.filter(operador => operador.estado_operativo !== 'AUSENTE').length;

        const ticketsActivos = await prisma.ticket.count({
            where: { estado_actual: { not: 'CERRADO' } }
        });
        const ticketsRealizados = await prisma.ticket.count({
            where: { estado_actual: 'CERRADO' }
        });
        const criticosSinAsignar = await prisma.ticket.count({
            where: {
                asignado_a_id: null,
                puntos_complejidad: { gte: 5 }
            }
        });
        const operadoresDisponibles = operadores.length;
        const ticketCodes = await prisma.ticket.findMany({
            select: { codigo_incidencia: true }
        });
        const numericCodes = ticketCodes
            .map(ticket => /^INC-(\d+)$/i.exec(String(ticket.codigo_incidencia || '').trim()))
            .filter(Boolean)
            .map(match => Number(match[1]))
            .filter(Number.isInteger);
        const nextTicketCode = `INC-${String((numericCodes.length ? Math.max(...numericCodes) : 3) + 1).padStart(3, '0')}`;

        return res.render('dashboard', {
            titulo: 'NOC Portal - Dashboard Operativo',
            ticketsActivos,
            ticketsRealizados,
            criticosSinAsignar,
            tiempoAtencion: '14.2',
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
            where: { ...assignedToUser, estado_actual: 'CERRADO' },
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