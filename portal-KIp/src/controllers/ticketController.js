const prisma = require('../config/prisma');

const PRIORITY_POINTS = { P1: 8, P2: 5, P3: 1 };
const VALID_AREAS = new Set([
    'GENERAL', 'REDES_FTTH', 'TRAFICO_INALAMBRICO', 'WAN',
    'GRANDES_CLIENTES', 'SEGURIDAD', 'TELEFONIA'
]);
const VALID_ORIGINS = new Set(['CORREO', 'LLAMADA', 'JEFATURA', 'COORDINADOR']);
const VALID_PRIORITIES = new Set(['NONE', 'P1', 'P2', 'P3']);

function assignmentValidationError({ operatorId, areaDesignada, prioridad }) {
    if (typeof operatorId !== 'string' || !operatorId.trim()) return 'Falta seleccionar un operador';
    if (areaDesignada && !VALID_AREAS.has(areaDesignada)) return 'Área designada no válida';
    if (prioridad && !Object.hasOwn(PRIORITY_POINTS, prioridad)) return 'Prioridad no válida';
    return null;
}

async function isOperator(operatorId) {
    return Boolean(await prisma.user.findFirst({
        where: { id: operatorId, rol: 'OPERADOR' },
        select: { id: true }
    }));
}

async function getNextTicketCode() {
    // 1. Prisma pide a Postgres solo el último ticket, ordenado de más nuevo a más viejo
    const lastTicket = await prisma.ticket.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { codigo_incidencia: true }
    });

    // 2. Si la base de datos está vacía, iniciamos en INC-004 (según tu lógica original)
    if (!lastTicket || !lastTicket.codigo_incidencia) return 'INC-004';

    // 3. Extraemos el número del último ticket y sumamos 1
    const match = /^INC-(\d+)$/i.exec(lastTicket.codigo_incidencia.trim());
    const lastNumber = match ? parseInt(match[1], 10) : 3;

    return `INC-${String(lastNumber + 1).padStart(3, '0')}`;
}

async function createTicket(req, res) {
    const body = req.body || {};
    const asunto = typeof body.asunto === 'string' ? body.asunto.trim() : '';
    const descripcion = typeof body.descripcion === 'string' ? body.descripcion.trim() : '';
    const remitente = typeof body.remitente === 'string' ? body.remitente.trim() : '';
    const { areaDesignada, origenIngesta, prioridad } = body;

    if (!asunto) return res.status(400).json({ success: false, error: 'El asunto es obligatorio' });
    if (typeof body.descripcion !== 'undefined' && typeof body.descripcion !== 'string') {
        return res.status(400).json({ success: false, error: 'La descripción no es válida' });
    }
    if (!VALID_AREAS.has(areaDesignada)) {
        return res.status(400).json({ success: false, error: 'Área designada no válida' });
    }
    if (!VALID_ORIGINS.has(origenIngesta)) {
        return res.status(400).json({ success: false, error: 'Origen de ingreso no válido' });
    }
    if (origenIngesta === 'CORREO' && !remitente) {
        return res.status(400).json({ success: false, error: 'El remitente es obligatorio para tickets de correo' });
    }
    if (remitente.length > 180) {
        return res.status(400).json({ success: false, error: 'El remitente no puede superar 180 caracteres' });
    }
    if (!VALID_PRIORITIES.has(prioridad)) {
        return res.status(400).json({ success: false, error: 'Prioridad no válida' });
    }

    try {
        const ticket = await prisma.ticket.create({
            data: {
                codigo_incidencia: await getNextTicketCode(),
                asunto,
                descripcion: descripcion || null,
                remitente: origenIngesta === 'CORREO' ? remitente : null,
                estado_actual: 'NUEVO',
                puntos_complejidad: PRIORITY_POINTS[prioridad] || 0,
                area_designada: areaDesignada,
                origen_ingesta: origenIngesta,
                ...(req.user?.id && !req.user.id.startsWith('temporary:') ? { creado_por_id: req.user.id } : {})
            }
        });

        return res.status(201).json({ success: true, ticket });
    } catch (error) {
        console.error('Error al crear ticket:', error);
        const status = error.code === 'P2002' ? 409 : 500;
        return res.status(status).json({
            success: false,
            error: status === 409 ? 'No se pudo generar un código de ticket único' : 'No se pudo crear el ticket'
        });
    }
}

async function assignTicket(req, res) {
    try {
        const { operatorId, areaDesignada, prioridad } = req.body;
        const ticketCode = typeof req.body.ticketCode === 'string' ? req.body.ticketCode.trim() : '';
        const validationError = assignmentValidationError({ operatorId, areaDesignada, prioridad });
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        if (!ticketCode) return res.status(400).json({ success: false, error: 'Falta código de incidencia' });
        if (!await isOperator(operatorId)) {
            return res.status(404).json({ success: false, error: 'Operador no encontrado' });
        }
        const existingTicket = await prisma.ticket.findUnique({
            where: { codigo_incidencia: ticketCode },
            select: { id: true, estado_actual: true }
        });
        if (!existingTicket) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });
        if (existingTicket.estado_actual === 'CERRADO') {
            return res.status(409).json({ success: false, error: 'Un ticket cerrado no puede reasignarse' });
        }

        const dataToUpdate = {
            estado_actual: 'NUEVO',
            fecha_asignacion: new Date(),
            asignado_a_id: operatorId
        };
        if (areaDesignada) dataToUpdate.area_designada = areaDesignada;
        if (prioridad) dataToUpdate.puntos_complejidad = PRIORITY_POINTS[prioridad];

        const result = await prisma.ticket.updateMany({
            where: { codigo_incidencia: ticketCode, estado_actual: { not: 'CERRADO' } },
            data: dataToUpdate
        });
        if (result.count !== 1) {
            const currentTicket = await prisma.ticket.findUnique({
                where: { codigo_incidencia: ticketCode },
                select: { id: true }
            });
            if (!currentTicket) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });
            return res.status(409).json({ success: false, error: 'Un ticket cerrado no puede reasignarse' });
        }
        const ticket = await prisma.ticket.findUnique({
            where: { codigo_incidencia: ticketCode },
            include: { asignado_a: { select: { id: true, nombre: true, email: true, rol: true, area_designada: true } } }
        });
        return res.json({ success: true, ticket });
    } catch (error) {
        console.error('Error al asignar ticket:', error);
        const status = error.code === 'P2025' ? 404 : 500;
        return res.status(status).json({
            success: false,
            error: status === 404 ? 'Ticket no encontrado' : 'No se pudo asignar el ticket'
        });
    }
}

async function unassignTicket(req, res) {
    try {
        const ticketCode = typeof req.body?.ticketCode === 'string' ? req.body.ticketCode.trim() : '';
        if (!ticketCode) return res.status(400).json({ success: false, error: 'Falta código de incidencia' });
        const existingTicket = await prisma.ticket.findUnique({
            where: { codigo_incidencia: ticketCode },
            select: { id: true, estado_actual: true }
        });
        if (!existingTicket) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });
        if (existingTicket.estado_actual === 'CERRADO') {
            return res.status(409).json({ success: false, error: 'Un ticket cerrado no puede desasignarse' });
        }

        const result = await prisma.ticket.updateMany({
            where: { codigo_incidencia: ticketCode, estado_actual: { not: 'CERRADO' } },
            data: {
                asignado_a_id: null,
                estado_actual: 'NUEVO',
                fecha_asignacion: null,
                puntos_complejidad: 0
            }
        });
        if (result.count !== 1) {
            const currentTicket = await prisma.ticket.findUnique({
                where: { codigo_incidencia: ticketCode },
                select: { id: true }
            });
            if (!currentTicket) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });
            return res.status(409).json({ success: false, error: 'Un ticket cerrado no puede desasignarse' });
        }
        const ticket = await prisma.ticket.findUnique({ where: { codigo_incidencia: ticketCode } });
        return res.json({ success: true, ticket });
    } catch (error) {
        console.error('Error al desasignar ticket:', error);
        return res.status(500).json({ success: false, error: 'No se pudo desasignar el ticket' });
    }
}

async function batchAssignTickets(req, res) {
    try {
        const { ticketCodes, operatorId, areaDesignada, prioridad } = req.body;
        if (!Array.isArray(ticketCodes) || ticketCodes.length === 0) {
            return res.status(400).json({ success: false, error: 'No se enviaron tickets' });
        }
        if (ticketCodes.some(code => typeof code !== 'string' || !code.trim())) {
            return res.status(400).json({ success: false, error: 'La selección contiene códigos de ticket no válidos' });
        }
        const uniqueCodes = [...new Set(ticketCodes.map(code => code.trim()))];
        const validationError = assignmentValidationError({ operatorId, areaDesignada, prioridad });
        if (validationError) return res.status(400).json({ success: false, error: validationError });
        if (!await isOperator(operatorId)) {
            return res.status(404).json({ success: false, error: 'Operador no encontrado' });
        }

        const fechaAsignacion = new Date();
        const updateData = {
            estado_actual: 'NUEVO',
            fecha_asignacion: fechaAsignacion,
            asignado_a_id: operatorId
        };
        if (areaDesignada) updateData.area_designada = areaDesignada;
        if (prioridad) updateData.puntos_complejidad = PRIORITY_POINTS[prioridad];

        const count = await prisma.$transaction(async transaction => {
            const existingTickets = await transaction.ticket.findMany({
                where: { codigo_incidencia: { in: uniqueCodes } },
                select: { codigo_incidencia: true, asignado_a_id: true, estado_actual: true }
            });
            if (existingTickets.length !== uniqueCodes.length) {
                const error = new Error('Uno o más tickets no existen');
                error.status = 404;
                throw error;
            }
            if (existingTickets.some(ticket => ticket.asignado_a_id || ticket.estado_actual !== 'NUEVO')) {
                const error = new Error('Uno o más tickets ya no están disponibles para asignación');
                error.status = 409;
                throw error;
            }

            const result = await transaction.ticket.updateMany({
                where: {
                    codigo_incidencia: { in: uniqueCodes },
                    asignado_a_id: null,
                    estado_actual: 'NUEVO'
                },
                data: updateData
            });
            if (result.count !== uniqueCodes.length) {
                const error = new Error('La selección cambió durante la asignación');
                error.status = 409;
                throw error;
            }
            return result.count;
        });

        return res.json({ success: true, count, fechaAsignacion: fechaAsignacion.toISOString() });
    } catch (error) {
        console.error('Error en asignación masiva:', error);
        const status = error.status || 500;
        return res.status(status).json({
            success: false,
            error: status < 500 ? error.message : 'No se pudo completar la asignación masiva'
        });
    }
}

async function claimTicket(req, res) {
    const ticketCode = typeof req.params.ticketCode === 'string' ? req.params.ticketCode.trim() : '';
    if (!ticketCode) return res.status(400).json({ success: false, error: 'Falta código de incidencia' });

    try {
        const ticket = await prisma.ticket.findUnique({
            where: { codigo_incidencia: ticketCode },
            select: { id: true, estado_actual: true, asignado_a_id: true, area_designada: true }
        });
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });
        if (ticket.estado_actual !== 'NUEVO' || (ticket.asignado_a_id !== null && ticket.asignado_a_id !== req.user.id)) {
            return res.status(409).json({ success: false, error: 'El ticket ya no está disponible para reclamar' });
        }

        const operatorArea = req.user.area_designada || 'GENERAL';
        if (ticket.area_designada !== 'GENERAL' && ticket.area_designada !== operatorArea) {
            return res.status(403).json({ success: false, error: 'El ticket no pertenece a tu área' });
        }

        const result = await prisma.ticket.updateMany({
            where: {
                id: ticket.id,
                estado_actual: 'NUEVO',
                OR: [
                    { asignado_a_id: null },
                    { asignado_a_id: req.user.id }
                ],
                area_designada: { in: [...new Set([operatorArea, 'GENERAL'])] }
            },
            data: {
                estado_actual: 'EN_PROGRESO',
                asignado_a_id: req.user.id,
                fecha_asignacion: new Date()
            }
        });
        if (result.count !== 1) {
            return res.status(409).json({ success: false, error: 'El ticket ya no está disponible para reclamar' });
        }
        return await sendTicket(req, res, ticket.id);
    } catch (error) {
        console.error('Error al reclamar ticket:', error);
        return res.status(500).json({ success: false, error: 'No se pudo reclamar el ticket' });
    }
}

async function updateOperatorTicket(req, res, action) {
    const ticketCode = typeof req.params.ticketCode === 'string' ? req.params.ticketCode.trim() : '';
    if (!ticketCode) return res.status(400).json({ success: false, error: 'Falta código de incidencia' });

    const transitions = {
        pause: { from: ['EN_PROGRESO'], to: 'EN_PAUSA', error: 'Solo se puede pausar un ticket en progreso' },
        resume: { from: ['EN_PAUSA', 'EN_ESPERA_TERCEROS'], to: 'EN_PROGRESO', error: 'El ticket no está pausado ni en espera externa' },
        resolve: { from: ['EN_PROGRESO', 'EN_PAUSA', 'EN_ESPERA_TERCEROS'], to: 'CERRADO', error: 'El ticket no se puede resolver desde su estado actual' }
    };
    const transition = transitions[action];

    try {
        const ticket = await prisma.ticket.findUnique({
            where: { codigo_incidencia: ticketCode },
            select: { id: true, estado_actual: true, asignado_a_id: true }
        });
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });
        if (ticket.asignado_a_id !== req.user.id) {
            return res.status(403).json({ success: false, error: 'El ticket no está asignado a este operador' });
        }
        if (!transition.from.includes(ticket.estado_actual)) {
            return res.status(409).json({ success: false, error: transition.error });
        }

        const now = new Date();
        const data = { estado_actual: transition.to };
        if (action === 'resolve') {
            data.fecha_cierre = now;
            data.resueltoEn = now;
        }
        const result = await prisma.ticket.updateMany({
            where: {
                id: ticket.id,
                asignado_a_id: req.user.id,
                estado_actual: { in: transition.from }
            },
            data
        });
        if (result.count !== 1) {
            return res.status(409).json({ success: false, error: 'El ticket cambió antes de completar la acción' });
        }
        return await sendTicket(req, res, ticket.id);
    } catch (error) {
        console.error(`Error al ${action} ticket:`, error);
        return res.status(500).json({ success: false, error: 'No se pudo actualizar el ticket' });
    }
}

async function sendTicket(req, res, ticketId) {
    const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { asignado_a: { select: { id: true, nombre: true, email: true, rol: true, area_designada: true } } }
    });
    return res.json({ success: true, ticket });
}

function pauseTicket(req, res) {
    return updateOperatorTicket(req, res, 'pause');
}

function resumeTicket(req, res) {
    return updateOperatorTicket(req, res, 'resume');
}

function resolveTicket(req, res) {
    return updateOperatorTicket(req, res, 'resolve');
}

function updateOperatorStatus(req, res) {
    const actionsByStatus = {
        EN_PAUSA: 'pause',
        PAUSADO: 'pause',
        EN_ESPERA: 'pause',
        pausar: 'pause',
        EN_PROGRESO: 'resume',
        CERRADO: 'resolve'
    };
    const action = actionsByStatus[req.body?.status];
    if (!action) return res.status(400).json({ success: false, error: 'Estado de destino no válido' });
    return updateOperatorTicket(req, res, action);
}


module.exports = {
    createTicket,
    assignTicket,
    unassignTicket,
    batchAssignTickets,
    claimTicket,
    pauseTicket,
    resumeTicket,
    resolveTicket,
    updateOperatorStatus
};