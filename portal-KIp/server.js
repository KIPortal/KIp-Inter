const express = require('express');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;
const PRIORITY_POINTS = { P1: 8, P2: 5, P3: 1 };
const VALID_AREAS = new Set([
    'GENERAL', 'REDES_FTTH', 'TRAFICO_INALAMBRICO', 'WAN',
    'GRANDES_CLIENTES', 'SEGURIDAD', 'TELEFONIA'
]);
const VALID_ORIGINS = new Set(['CORREO', 'LLAMADA', 'JEFATURA', 'COORDINADOR']);
const VALID_PRIORITIES = new Set(['NONE', 'P1', 'P2', 'P3']);
const VALID_OPERATOR_STATES = new Set(['DISPONIBLE', 'EN_TERRENO', 'AUSENTE']);

function assignmentValidationError({ operatorId, areaDesignada, prioridad }) {
    if (typeof operatorId !== 'string' || !operatorId.trim()) return 'Falta seleccionar un operador';
    if (areaDesignada && !VALID_AREAS.has(areaDesignada)) return 'Área designada no válida';
    if (prioridad && !Object.hasOwn(PRIORITY_POINTS, prioridad)) return 'Prioridad no válida';
    return null;
}

async function getNextTicketCode() {
    const tickets = await prisma.ticket.findMany({
        select: { codigo_incidencia: true }
    });

    const numericValues = tickets
        .map(ticket => ticket.codigo_incidencia)
        .map(code => {
            const match = /^INC-(\d+)$/i.exec(String(code || '').trim());
            return match ? Number(match[1]) : null;
        })
        .filter(value => Number.isInteger(value));

    const defaultStart = 3;
    const lastNumber = numericValues.length ? Math.max(...numericValues) : defaultStart;
    const nextNumber = lastNumber + 1;

    return `INC-${String(nextNumber).padStart(3, '0')}`;
}

async function isOperator(operatorId) {
    return Boolean(await prisma.user.findFirst({
        where: { id: operatorId, rol: 'OPERADOR' },
        select: { id: true }
    }));
}

// Configuración del motor de plantillas y archivos públicos
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Middlewares para procesar datos de formularios y JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ruta principal: Renderiza el Dashboard
app.get('/', async (req, res) => {
    try {
        // Traemos todos los tickets con su operador asignado
        const tickets = await prisma.ticket.findMany({
            include: {
                asignado_a: true,
                creado_por: { select: { nombre: true, email: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        
        // Operadores del turno y su carga de tickets actual
        const operadoresTurno = await prisma.user.findMany({
            where: { rol: 'OPERADOR' },
            include: {
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

        // Métricas de KPIs
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

        const nextTicketCode = await getNextTicketCode();

        res.render('index', { 
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
        res.status(500).send('Error en el servidor');
    }
});

app.get('/gestion-turno', async (req, res) => {
    res.redirect(302, '/#gestion-turno');
});

app.patch('/api/operators/:operatorId/status', async (req, res) => {
    const { operatorId } = req.params;
    const { estadoOperativo } = req.body || {};

    if (!VALID_OPERATOR_STATES.has(estadoOperativo)) {
        return res.status(400).json({ success: false, error: 'Estado operativo no válido' });
    }
    if (!await isOperator(operatorId)) {
        return res.status(404).json({ success: false, error: 'Operador no encontrado' });
    }

    try {
        const operador = await prisma.user.update({
            where: { id: operatorId },
            data: { estado_operativo: estadoOperativo },
            select: { id: true, estado_operativo: true }
        });
        res.json({ success: true, operador });
    } catch (error) {
        console.error('Error al actualizar estado del operador:', error);
        res.status(500).json({ success: false, error: 'No se pudo actualizar el estado operativo' });
    }
});

// API: Crear ticket desde el formulario de coordinación
app.post('/api/tickets', async (req, res) => {
    const body = req.body || {};
    const asunto = typeof body.asunto === 'string' ? body.asunto.trim() : '';
    const descripcion = typeof body.descripcion === 'string' ? body.descripcion.trim() : '';
    const remitente = typeof body.remitente === 'string' ? body.remitente.trim() : '';
    const areaDesignada = body.areaDesignada;
    const origenIngesta = body.origenIngesta;
    const prioridad = body.prioridad;

    if (!asunto) {
        return res.status(400).json({ success: false, error: 'El asunto es obligatorio' });
    }
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
        const codigoIncidencia = await getNextTicketCode();

        const ticket = await prisma.ticket.create({
            data: {
                codigo_incidencia: codigoIncidencia,
                asunto,
                descripcion: descripcion || null,
                remitente: origenIngesta === 'CORREO' ? remitente : null,
                estado_actual: 'NUEVO',
                puntos_complejidad: PRIORITY_POINTS[prioridad] || 0,
                area_designada: areaDesignada,
                origen_ingesta: origenIngesta
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
});

// API: Asignar un ticket a un operador y área
app.post('/api/tickets/assign', async (req, res) => {
    try {
        const { operatorId, areaDesignada, prioridad } = req.body;
        const ticketCode = typeof req.body.ticketCode === 'string' ? req.body.ticketCode.trim() : '';
        const validationError = assignmentValidationError({ operatorId, areaDesignada, prioridad });
        if (validationError) {
            return res.status(400).json({ success: false, error: validationError });
        }
        if (!ticketCode) {
            return res.status(400).json({ success: false, error: 'Falta código de incidencia' });
        }
        if (!await isOperator(operatorId)) {
            return res.status(404).json({ success: false, error: 'Operador no encontrado' });
        }

        const dataToUpdate = {
            estado_actual: 'EN_PROGRESO',
            fecha_asignacion: new Date(),
            asignado_a_id: operatorId
        };

        if (areaDesignada) {
            dataToUpdate.area_designada = areaDesignada;
        }
        if (prioridad) dataToUpdate.puntos_complejidad = PRIORITY_POINTS[prioridad];

        const ticket = await prisma.ticket.update({
            where: { codigo_incidencia: ticketCode },
            data: dataToUpdate,
            include: { asignado_a: true }
        });

        res.json({ success: true, ticket });
    } catch (error) {
        console.error('Error al asignar ticket:', error);
        const status = error.code === 'P2025' ? 404 : 500;
        res.status(status).json({ success: false, error: status === 404 ? 'Ticket no encontrado' : 'No se pudo asignar el ticket' });
    }
});

// API: Desasignar ticket
app.post('/api/tickets/unassign', async (req, res) => {
    try {
        const { ticketCode } = req.body;
        if (!ticketCode) {
            return res.status(400).json({ success: false, error: 'Falta código de incidencia' });
        }

        const ticket = await prisma.ticket.update({
            where: { codigo_incidencia: ticketCode },
            data: {
                asignado_a_id: null,
                estado_actual: 'NUEVO',
                fecha_asignacion: null,
                puntos_complejidad: 0
            }
        });

        res.json({ success: true, ticket });
    } catch (error) {
        console.error('Error al desasignar ticket:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: Asignación masiva (batch)
app.post('/api/tickets/batch-assign', async (req, res) => {
    try {
        const { ticketCodes, operatorId, areaDesignada, prioridad } = req.body;
        if (!ticketCodes || !Array.isArray(ticketCodes) || ticketCodes.length === 0) {
            return res.status(400).json({ success: false, error: 'No se enviaron tickets' });
        }
        if (ticketCodes.some(code => typeof code !== 'string' || !code.trim())) {
            return res.status(400).json({ success: false, error: 'La selección contiene códigos de ticket no válidos' });
        }
        const uniqueCodes = [...new Set(ticketCodes.map(code => code.trim()))];
        const validationError = assignmentValidationError({ operatorId, areaDesignada, prioridad });
        if (validationError) {
            return res.status(400).json({ success: false, error: validationError });
        }
        if (!await isOperator(operatorId)) {
            return res.status(404).json({ success: false, error: 'Operador no encontrado' });
        }

        const fechaAsignacion = new Date();
        const updateData = {
            estado_actual: 'EN_PROGRESO',
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

        res.json({ success: true, count, fechaAsignacion: fechaAsignacion.toISOString() });
    } catch (error) {
        console.error('Error en asignación masiva:', error);
        const status = error.status || 500;
        res.status(status).json({
            success: false,
            error: status < 500 ? error.message : 'No se pudo completar la asignación masiva'
        });
    }
});

// Inicialización del servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor NOC activo en http://localhost:${PORT}`);
});