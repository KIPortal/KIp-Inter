const prisma = require('../config/prisma');
const { ATIENDE_WHERE, esSupervisor, areasVisibles, ticketWhere } = require('../services/roleService');
const { getWeekStart } = require('../services/shiftService');
const { buildHandoffView } = require('../services/ticketQueueService');
const { getNextTicketCode } = require('../services/ticketCodeService');
const { auditUserId } = require('../services/auditViewService');

const PRIORITY_POINTS = { P1: 8, P2: 5, P3: 1 };
const { isActiveArea, isValidSubgrupo, subgrupoName } = require('../services/areaCatalog');
const { parseEstadoVe } = require('../services/estadosVeService');
// Solo se puede elegir un área activa (las desactivadas conservan su historial)
const VALID_AREAS = { has: isActiveArea };
const VALID_ORIGINS = new Set(['CORREO', 'LLAMADA', 'JEFATURA', 'COORDINADOR']);
const VALID_PRIORITIES = new Set(['NONE', 'P1', 'P2', 'P3']);

function assignmentValidationError({ operatorId, areaDesignada, prioridad }) {
    if (typeof operatorId !== 'string' || !operatorId.trim()) return 'Falta seleccionar un operador';
    if (areaDesignada && !VALID_AREAS.has(areaDesignada)) return 'Área designada no válida';
    if (prioridad && !Object.hasOwn(PRIORITY_POINTS, prioridad)) return 'Prioridad no válida';
    return null;
}

async function isOperator(operatorId) {
    return prisma.user.findFirst({
        where: { id: operatorId, activo: true, ...ATIENDE_WHERE },
        select: { id: true, nombre: true, area_designada: true, subgrupo_id: true }
    });
}

// Si dos coordinadores crean a la vez, el segundo choca con el código (P2002) y reintenta
const CREATE_ATTEMPTS = 3;

async function createTicket(req, res) {
    const body = req.body || {};
    const asunto = typeof body.asunto === 'string' ? body.asunto.trim() : '';
    const descripcion = typeof body.descripcion === 'string' ? body.descripcion.trim() : '';
    const remitente = typeof body.remitente === 'string' ? body.remitente.trim() : '';
    const { areaDesignada, origenIngesta, prioridad } = body;
    const estadoVe = parseEstadoVe(body.estadoVe);
    if (estadoVe.error) return res.status(400).json({ success: false, error: estadoVe.error });

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
    const subgrupoId = typeof body.subgrupoId === 'string' && body.subgrupoId.trim() ? body.subgrupoId.trim() : null;
    if (subgrupoId && !isValidSubgrupo(subgrupoId, areaDesignada)) {
        return res.status(400).json({ success: false, error: 'El subgrupo no es de esa área o está desactivado' });
    }

    const data = {
        asunto,
        descripcion: descripcion || null,
        remitente: origenIngesta === 'CORREO' ? remitente : null,
        estado_actual: 'NUEVO',
        puntos_complejidad: PRIORITY_POINTS[prioridad] || 0,
        area_designada: areaDesignada,
        estado_ve: estadoVe.valor,
        subgrupo_id: subgrupoId,
        origen_ingesta: origenIngesta,
        ...(req.user?.id && !req.user.id.startsWith('temporary:') ? { creado_por_id: req.user.id } : {})
    };
    try {
        for (let intento = 1; ; intento++) {
            try {
                const ticket = await prisma.ticket.create({
                    data: { ...data, codigo_incidencia: await getNextTicketCode(prisma) }
                });
                return res.status(201).json({ success: true, ticket });
            } catch (error) {
                if (error.code !== 'P2002' || intento >= CREATE_ATTEMPTS) throw error;
            }
        }
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
        // Cada viaje a la base cuesta: las dos lecturas van en paralelo
        const [operador, existingTicket] = await Promise.all([
            isOperator(operatorId),
            prisma.ticket.findUnique({
                where: { codigo_incidencia: ticketCode },
                select: { id: true, estado_actual: true, asignado_a_id: true, area_designada: true, subgrupo_id: true, asignado_a: { select: { nombre: true } } }
            })
        ]);
        if (!operador) {
            return res.status(404).json({ success: false, error: 'Operador no encontrado' });
        }
        if (!existingTicket) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });
        if (['RESUELTO', 'CERRADO'].includes(existingTicket.estado_actual)) {
            return res.status(409).json({ success: false, error: 'Un ticket resuelto o cerrado no puede reasignarse' });
        }

        const dataToUpdate = {
            estado_actual: 'NUEVO',
            fecha_asignacion: new Date(),
            asignado_a_id: operatorId
        };
        if (areaDesignada) dataToUpdate.area_designada = areaDesignada;
        if (prioridad) dataToUpdate.puntos_complejidad = PRIORITY_POINTS[prioridad];
        // Subgrupo: se va si el ticket cambia de área; si no tiene, toma el de quien lo recibe (misma área)
        const areaFinal = areaDesignada || existingTicket.area_designada;
        let subgrupo = existingTicket.subgrupo_id && isValidSubgrupo(existingTicket.subgrupo_id, areaFinal) ? existingTicket.subgrupo_id : null;
        if (!subgrupo && operador.subgrupo_id && operador.area_designada === areaFinal) subgrupo = operador.subgrupo_id;
        if (subgrupo !== (existingTicket.subgrupo_id || null)) dataToUpdate.subgrupo_id = subgrupo;

        // Un solo viaje: el filtro de estado evita reasignar si lo resolvieron entretanto (P2025)
        const ticket = await prisma.ticket.update({
            where: { codigo_incidencia: ticketCode, estado_actual: { notIn: ['RESUELTO', 'CERRADO'] } },
            data: dataToUpdate,
            include: { asignado_a: { select: { id: true, nombre: true, email: true, rol: true, area_designada: true } } }
        });
        const nombre = operador.nombre || 'el operador';
        const extras = [areaDesignada ? `área ${areaDesignada}` : '', prioridad ? `prioridad ${prioridad}` : ''].filter(Boolean).join(', ');
        // La auditoría no hace esperar la respuesta (logAudit ya captura sus errores)
        if (existingTicket.asignado_a_id && existingTicket.asignado_a_id !== operatorId) {
            logAudit(req, 'TICKET_REASIGNADO', existingTicket.id, `De ${existingTicket.asignado_a?.nombre || 'otro operador'} a ${nombre}${extras ? ` (${extras})` : ''}`);
        } else {
            logAudit(req, 'TICKET_ASIGNADO', existingTicket.id, `A ${nombre}${extras ? ` (${extras})` : ''}`);
        }
        return res.json({ success: true, ticket });
    } catch (error) {
        if (error.code === 'P2025') {
            return res.status(409).json({ success: false, error: 'El ticket cambió de estado y ya no puede reasignarse' });
        }
        console.error('Error al asignar ticket:', error);
        return res.status(500).json({ success: false, error: 'No se pudo asignar el ticket' });
    }
}

async function unassignTicket(req, res) {
    try {
        const ticketCode = typeof req.body?.ticketCode === 'string' ? req.body.ticketCode.trim() : '';
        if (!ticketCode) return res.status(400).json({ success: false, error: 'Falta código de incidencia' });
        const existingTicket = await prisma.ticket.findUnique({
            where: { codigo_incidencia: ticketCode },
            select: { id: true, estado_actual: true, asignado_a: { select: { nombre: true } } }
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
        await logAudit(req, 'TICKET_DESASIGNADO', existingTicket.id, `Quitado a ${existingTicket.asignado_a?.nombre || 'nadie'}; vuelve a la cola`);
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
        const operador = await isOperator(operatorId);
        if (!operador) {
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
                select: { id: true, codigo_incidencia: true, asignado_a_id: true, estado_actual: true }
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
            return { count: result.count, ids: existingTickets.map(t => t.id) };
        });

        // Una sola inserción para todo el lote, sin hacer esperar la respuesta
        const detalles = `A ${operador.nombre || 'el operador'} (asignación múltiple de ${count.count})`;
        prisma.auditLog.createMany({
            data: count.ids.map(ticketId => ({ accion: 'TICKET_ASIGNADO', ticketId, userId: auditUserId(req), detalles }))
        }).catch(error => console.error('No se pudo registrar auditoría:', error.message));
        return res.json({ success: true, count: count.count, fechaAsignacion: fechaAsignacion.toISOString() });
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
        // El coordinador (y el gerente) ve todas las áreas: puede tomar cualquiera; el jefe, las de su área
        const areas = esSupervisor(req.user) ? areasVisibles(req.user) : [...new Set([operatorArea, 'GENERAL'])];
        if (areas && !areas.includes(ticket.area_designada)) {
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
                ...(areas ? { area_designada: { in: areas } } : {})
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
        await logAudit(req, 'TICKET_TOMADO', ticket.id, 'El operador lo tomó y quedó en progreso');
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
        wait: { from: ['EN_PROGRESO'], to: 'EN_ESPERA_TERCEROS', error: 'Solo se puede dejar en espera un ticket en progreso' },
        resume: { from: ['EN_PAUSA', 'EN_ESPERA_TERCEROS'], to: 'EN_PROGRESO', error: 'El ticket no está pausado ni en espera externa' },
        resolve: { from: ['EN_PROGRESO', 'EN_PAUSA', 'EN_ESPERA_TERCEROS'], to: 'RESUELTO', error: 'El ticket no se puede resolver desde su estado actual' }
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
            // El operador termina (RESUELTO); el cierre lo confirma el coordinador
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
        const ACCION = { pause: 'TICKET_PAUSADO', wait: 'TICKET_EN_ESPERA', resume: 'TICKET_REANUDADO', resolve: 'TICKET_RESUELTO' }[action];
        // Nota opcional del operador (motivo de la pausa o qué se hizo al resolver)
        const nota = typeof req.body?.nota === 'string' ? req.body.nota.trim().slice(0, 500) : '';
        if (ACCION) await logAudit(req, ACCION, ticket.id, `Estado: ${ticket.estado_actual} → ${transition.to}${nota ? '. Nota: ' + nota : ''}`);
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
        EN_ESPERA_TERCEROS: 'wait',
        pausar: 'pause',
        EN_PROGRESO: 'resume',
        RESUELTO: 'resolve',
        CERRADO: 'resolve'
    };
    const action = actionsByStatus[req.body?.status];
    if (!action) return res.status(400).json({ success: false, error: 'Estado de destino no válido' });
    return updateOperatorTicket(req, res, action);
}


// ---------------------------------------------------------------------------
// Acciones del coordinador: cerrar, editar, eliminar (borrado lógico) y restaurar
// ---------------------------------------------------------------------------

async function logAudit(req, accion, ticketId, detalles) {
    try {
        await prisma.auditLog.create({
            data: { accion, ticketId, userId: auditUserId(req), detalles: detalles || null }
        });
    } catch (error) {
        // La auditoría no debe impedir la acción principal
        console.error('No se pudo registrar auditoría:', error.message);
    }
}

function getTicketCode(req) {
    return typeof req.params.ticketCode === 'string' ? req.params.ticketCode.trim() : '';
}

async function closeTicket(req, res) {
    const ticketCode = getTicketCode(req);
    if (!ticketCode) return res.status(400).json({ success: false, error: 'Falta código de incidencia' });
    const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
    if (motivo.length > 300) {
        return res.status(400).json({ success: false, error: 'El motivo de cierre no puede superar 300 caracteres' });
    }
    try {
        const ticket = await prisma.ticket.findUnique({
            where: { codigo_incidencia: ticketCode },
            select: { id: true, estado_actual: true, resueltoEn: true, eliminado_en: true }
        });
        if (!ticket || ticket.eliminado_en) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });
        if (ticket.estado_actual === 'CERRADO') {
            return res.status(409).json({ success: false, error: 'El ticket ya está cerrado' });
        }
        const now = new Date();
        const data = { estado_actual: 'CERRADO', fecha_cierre: now };
        if (!ticket.resueltoEn) data.resueltoEn = now; // cierre directo sin resolución previa
        await prisma.ticket.update({ where: { id: ticket.id }, data });
        await logAudit(req, 'TICKET_CERRADO', ticket.id, `Estado previo: ${ticket.estado_actual}${motivo ? `. Motivo: ${motivo}` : ''}`);
        return await sendTicket(req, res, ticket.id);
    } catch (error) {
        console.error('Error al cerrar ticket:', error);
        return res.status(500).json({ success: false, error: 'No se pudo cerrar el ticket' });
    }
}


async function editTicket(req, res) {
    const ticketCode = getTicketCode(req);
    if (!ticketCode) return res.status(400).json({ success: false, error: 'Falta código de incidencia' });
    const body = req.body || {};
    const data = {};

    if (body.asunto !== undefined) {
        if (typeof body.asunto !== 'string' || !body.asunto.trim()) {
            return res.status(400).json({ success: false, error: 'El asunto no puede estar vacío' });
        }
        data.asunto = body.asunto.trim().slice(0, 300);
    }
    if (body.descripcion !== undefined) {
        data.descripcion = body.descripcion === null ? null : String(body.descripcion);
    }
    if (body.area_designada !== undefined) {
        if (!VALID_AREAS.has(body.area_designada)) {
            return res.status(400).json({ success: false, error: 'Área designada no válida' });
        }
        data.area_designada = body.area_designada;
    }
    if (body.estado_ve !== undefined) {
        const estadoVe = parseEstadoVe(body.estado_ve);
        if (estadoVe.error) return res.status(400).json({ success: false, error: estadoVe.error });
        data.estado_ve = estadoVe.valor;
    }
    if (body.prioridad !== undefined) {
        if (body.prioridad === 'NONE') data.puntos_complejidad = 0;
        else if (Object.hasOwn(PRIORITY_POINTS, body.prioridad)) data.puntos_complejidad = PRIORITY_POINTS[body.prioridad];
        else return res.status(400).json({ success: false, error: 'Prioridad no válida' });
    }
    if (body.subgrupo_id !== undefined) {
        if (body.subgrupo_id !== null && typeof body.subgrupo_id !== 'string') return res.status(400).json({ success: false, error: 'Subgrupo no válido' });
        data.subgrupo_id = (body.subgrupo_id || '').trim() || null;
    }
    if (Object.keys(data).length === 0) {
        return res.status(400).json({ success: false, error: 'No hay campos para actualizar' });
    }

    try {
        const ticket = await prisma.ticket.findUnique({
            where: { codigo_incidencia: ticketCode },
            include: { asignado_a: { select: { id: true, nombre: true, area_designada: true } } }
        });
        if (!ticket || ticket.eliminado_en) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });

        // Subgrupo: debe ser del área final; si el área cambia y no se eligió otro, se quita
        const areaFinal = data.area_designada || ticket.area_designada;
        if (data.subgrupo_id === undefined && ticket.subgrupo_id && data.area_designada && data.area_designada !== ticket.area_designada) data.subgrupo_id = null;
        if (data.subgrupo_id && !isValidSubgrupo(data.subgrupo_id, areaFinal)) {
            return res.status(400).json({ success: false, error: 'El subgrupo no es de esa área o está desactivado' });
        }
        if (data.subgrupo_id !== undefined && data.subgrupo_id === (ticket.subgrupo_id || null)) delete data.subgrupo_id;
        if (Object.keys(data).length === 0) return await sendTicket(req, res, ticket.id);

        // Cambiar el área de un ticket ya asignado a otra área requiere confirmación explícita
        const areaChanged = data.area_designada && data.area_designada !== ticket.area_designada;
        if (areaChanged && ticket.asignado_a && ticket.asignado_a.area_designada !== data.area_designada
            && data.area_designada !== 'GENERAL' && body.confirmarCambioArea !== true) {
            return res.status(409).json({
                success: false,
                requiereConfirmacion: true,
                error: `El ticket está asignado a ${ticket.asignado_a.nombre} (${ticket.asignado_a.area_designada}). Confirma el cambio de área.`
            });
        }

        const cambios = Object.keys(data).map(campo => {
            if (campo === 'subgrupo_id') return `subgrupo: ${subgrupoName(ticket.subgrupo_id) || '-'} → ${subgrupoName(data.subgrupo_id) || '-'}`;
            const antes = ticket[campo];
            return `${campo}: ${antes === null || antes === undefined ? '-' : String(antes).slice(0, 80)} → ${data[campo] === null ? '-' : String(data[campo]).slice(0, 80)}`;
        });
        await prisma.ticket.update({ where: { id: ticket.id }, data });
        await logAudit(req, 'TICKET_EDITADO', ticket.id, cambios.join(' | '));
        return await sendTicket(req, res, ticket.id);
    } catch (error) {
        console.error('Error al editar ticket:', error);
        return res.status(500).json({ success: false, error: 'No se pudo editar el ticket' });
    }
}

async function deleteTicket(req, res) {
    const ticketCode = getTicketCode(req);
    if (!ticketCode) return res.status(400).json({ success: false, error: 'Falta código de incidencia' });
    const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
    if (motivo.length < 3) {
        return res.status(400).json({ success: false, error: 'El motivo de eliminación es obligatorio' });
    }
    try {
        const ticket = await prisma.ticket.findUnique({
            where: { codigo_incidencia: ticketCode },
            select: { id: true, estado_actual: true, eliminado_en: true }
        });
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });
        if (ticket.eliminado_en) return res.status(409).json({ success: false, error: 'El ticket ya está en la papelera' });
        // Un ticket resuelto o cerrado exige confirmación adicional
        if (['RESUELTO', 'CERRADO'].includes(ticket.estado_actual) && req.body?.confirmar !== true) {
            return res.status(409).json({
                success: false,
                requiereConfirmacion: true,
                error: 'El ticket ya fue resuelto o cerrado. Confirma para enviarlo a la papelera.'
            });
        }
        await prisma.ticket.update({
            where: { id: ticket.id },
            data: { eliminado_en: new Date(), motivo_eliminacion: motivo.slice(0, 300), asignado_a_id: null }
        });
        await logAudit(req, 'TICKET_ELIMINADO', ticket.id, `Motivo: ${motivo}. Estado previo: ${ticket.estado_actual}`);
        return res.json({ success: true });
    } catch (error) {
        console.error('Error al eliminar ticket:', error);
        return res.status(500).json({ success: false, error: 'No se pudo eliminar el ticket' });
    }
}

async function restoreTicket(req, res) {
    const ticketCode = getTicketCode(req);
    if (!ticketCode) return res.status(400).json({ success: false, error: 'Falta código de incidencia' });
    try {
        const ticket = await prisma.ticket.findUnique({
            where: { codigo_incidencia: ticketCode },
            select: { id: true, eliminado_en: true }
        });
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });
        if (!ticket.eliminado_en) return res.status(409).json({ success: false, error: 'El ticket no está en la papelera' });
        await prisma.ticket.update({ where: { id: ticket.id }, data: { eliminado_en: null, motivo_eliminacion: null } });
        await logAudit(req, 'TICKET_RESTAURADO', ticket.id, null);
        return await sendTicket(req, res, ticket.id);
    } catch (error) {
        console.error('Error al restaurar ticket:', error);
        return res.status(500).json({ success: false, error: 'No se pudo restaurar el ticket' });
    }
}

// Traspaso de casos al operador de guardia (spec §10.1): una o varias incidencias,
// con nota de contexto obligatoria. No reinicia el tiempo (se mide desde createdAt).
async function handoffTickets(req, res) {
    try {
        const { ticketCodes } = req.body || {};
        const nota = typeof req.body?.nota === 'string' ? req.body.nota.trim() : '';
        if (!Array.isArray(ticketCodes) || ticketCodes.length === 0) {
            return res.status(400).json({ success: false, error: 'No se enviaron tickets' });
        }
        if (ticketCodes.some(code => typeof code !== 'string' || !code.trim())) {
            return res.status(400).json({ success: false, error: 'La selección contiene códigos de ticket no válidos' });
        }
        if (nota.length < 10) {
            return res.status(400).json({
                success: false,
                error: 'La nota de traspaso es obligatoria: indica qué se intentó, qué se hizo y qué sigue'
            });
        }
        const uniqueCodes = [...new Set(ticketCodes.map(code => code.trim()))];
        const tickets = await prisma.ticket.findMany({
            where: { codigo_incidencia: { in: uniqueCodes } },
            select: { id: true, codigo_incidencia: true, estado_actual: true, asignado_a: { select: { nombre: true } } }
        });
        if (tickets.length !== uniqueCodes.length) {
            return res.status(404).json({ success: false, error: 'Uno o más tickets no existen' });
        }
        const noTraspasables = tickets.filter(t => ['RESUELTO', 'CERRADO'].includes(t.estado_actual));
        if (noTraspasables.length > 0) {
            return res.status(409).json({
                success: false,
                error: `Ya están resueltos o cerrados: ${noTraspasables.map(t => t.codigo_incidencia).join(', ')}`
            });
        }

        // No cambia el operador: la guardia recibe la lista y la nota aparte
        const traspaso = await prisma.traspaso.create({
            data: {
                nota,
                semana_inicio: getWeekStart(new Date()),
                ...(req.user?.id && !req.user.id.startsWith('temporary:') ? { creado_por_id: req.user.id } : {}),
                tickets: {
                    create: tickets.map(t => ({
                        ticketId: t.id,
                        estado_al_pasar: t.estado_actual,
                        operador_al_pasar: t.asignado_a?.nombre || null
                    }))
                }
            },
            select: { id: true }
        });
        for (const ticket of tickets) {
            await logAudit(
                req,
                'TICKET_TRASPASADO_GUARDIA',
                ticket.id,
                `En la lista de la guardia (operador: ${ticket.asignado_a?.nombre || 'sin asignar'}). Nota: ${nota}`
            );
        }
        return res.json({ success: true, count: tickets.length, traspasoId: traspaso.id });
    } catch (error) {
        console.error('Error en traspaso a guardia:', error);
        return res.status(500).json({ success: false, error: 'No se pudo completar el traspaso' });
    }
}

const handoffInclude = {
    creado_por: { select: { nombre: true } },
    tickets: { include: { ticket: { select: { codigo_incidencia: true, estado_actual: true, eliminado_en: true } } } }
};

/**
 * Traspaso vigente (el más reciente sin marcar como atendido). Devuelve null si
 * no hay o si la tabla aún no existe (migración pendiente).
 */
async function loadActiveHandoff(now = new Date()) {
    try {
        const traspaso = await prisma.traspaso.findFirst({
            where: { cerrado_en: null, createdAt: { gte: new Date(now.getTime() - 24 * 3600 * 1000) } },
            orderBy: { createdAt: 'desc' },
            include: handoffInclude
        });
        const view = buildHandoffView(traspaso, now);
        return view && view.vigente ? view : null;
    } catch (error) {
        console.error('Traspasos no disponibles (¿migración pendiente?):', error.message);
        return null;
    }
}

async function getActiveHandoff(req, res) {
    return res.json({ success: true, traspaso: await loadActiveHandoff() });
}

// El coordinador da el traspaso por atendido: deja de mostrarse
async function closeHandoff(req, res) {
    const id = typeof req.params.id === 'string' ? req.params.id.trim() : '';
    if (!id) return res.status(400).json({ success: false, error: 'Falta el traspaso' });
    try {
        const traspaso = await prisma.traspaso.findUnique({ where: { id }, select: { id: true, cerrado_en: true } });
        if (!traspaso) return res.status(404).json({ success: false, error: 'Traspaso no encontrado' });
        if (traspaso.cerrado_en) return res.status(409).json({ success: false, error: 'El traspaso ya fue atendido' });
        await prisma.traspaso.update({ where: { id }, data: { cerrado_en: new Date() } });
        await logAudit(req, 'TRASPASO_ATENDIDO', null, `Traspaso ${id} marcado como atendido`);
        return res.json({ success: true });
    } catch (error) {
        console.error('Error al cerrar traspaso:', error);
        return res.status(500).json({ success: false, error: 'No se pudo marcar el traspaso' });
    }
}

// Historial de un ticket (ediciones, traspasos, cierre...) con la nota visible en el detalle
async function getTicketHistory(req, res) {
    const ticketCode = getTicketCode(req);
    try {
        const ticket = await prisma.ticket.findUnique({
            where: { codigo_incidencia: ticketCode },
            select: { id: true }
        });
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });
        const logs = await prisma.auditLog.findMany({
            where: { ticketId: ticket.id },
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: { user: { select: { nombre: true } } }
        });
        return res.json({
            success: true,
            historial: logs.map(l => ({
                accion: l.accion,
                detalles: l.detalles,
                usuario: l.user?.nombre || 'Sistema',
                fecha: l.createdAt
            }))
        });
    } catch (error) {
        console.error('Error al leer historial:', error);
        return res.status(500).json({ success: false, error: 'No se pudo leer el historial' });
    }
}

// Papelera: tickets eliminados (el filtro explícito evita el filtro automático)
async function listTrash(req, res) {
    try {
        const tickets = await prisma.ticket.findMany({
            where: { eliminado_en: { not: null }, ...ticketWhere(req.user) },
            orderBy: { eliminado_en: 'desc' },
            take: 200,
            select: {
                codigo_incidencia: true, asunto: true, area_designada: true, estado_actual: true,
                createdAt: true, eliminado_en: true, motivo_eliminacion: true
            }
        });
        return res.json({ success: true, tickets });
    } catch (error) {
        console.error('Error al listar papelera:', error);
        return res.status(500).json({ success: false, error: 'No se pudo leer la papelera' });
    }
}

module.exports = {
    handoffTickets,
    getActiveHandoff,
    closeHandoff,
    loadActiveHandoff,
    getTicketHistory,
    listTrash,
    closeTicket,
    editTicket,
    deleteTicket,
    restoreTicket,
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