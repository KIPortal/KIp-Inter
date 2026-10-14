'use strict';

const prisma = require('../config/prisma');
const { ATIENDE_WHERE, personaWhere, ticketWhere, areaScope } = require('../services/roleService');
const { validateSchedule, getShiftStatus, getWeekStart, DEFAULT_SCHEDULE } = require('../services/shiftService');
const { parseCaracasDate, ACTIVE_STATES } = require('../services/metricsService');
const { buildShiftBoard } = require('../services/shiftBoardService');
const { auditUserId } = require('../services/auditViewService');

async function audit(req, accion, detalles) {
    try {
        await prisma.auditLog.create({ data: { accion, userId: auditUserId(req), detalles } });
    } catch (e) {
        console.error('No se pudo registrar auditoría:', e.message);
    }
}

const DIAS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const { formatCaracasDate } = require('../services/metricsService');
const formatWeek = weekStart => formatCaracasDate(weekStart);

function resolveWeek(semana) {
    if (!semana) return getWeekStart(new Date());
    const d = parseCaracasDate(semana);
    return d ? getWeekStart(d) : null;
}

/** Carga horarios y guardias; tolera que las tablas aún no existan (migración pendiente). */
async function loadShiftData(weekStart) {
    try {
        const [horarios, guardias] = await Promise.all([
            prisma.horarioOperador.findMany(),
            prisma.guardiaSemanal.findMany({ where: { semana_inicio: weekStart } })
        ]);
        return {
            horarioPorUsuario: new Map(horarios.map(h => [h.userId, h])),
            guardiaIds: new Set(guardias.map(g => g.userId))
        };
    } catch (error) {
        console.error('Turnos no disponibles (¿migración pendiente?):', error.message);
        return { horarioPorUsuario: new Map(), guardiaIds: new Set() };
    }
}

async function getTurnos(req, res) {
    try {
        const weekStart = resolveWeek(req.query.semana);
        if (!weekStart) return res.status(400).json({ error: 'Fecha inválida (use AAAA-MM-DD)' });
        const operadores = await prisma.user.findMany({
            where: { activo: true, ...ATIENDE_WHERE, ...personaWhere(req.user) },
            select: { id: true, nombre: true, email: true, area_designada: true, estado_operativo: true },
            orderBy: { nombre: 'asc' }
        });
        const { horarioPorUsuario, guardiaIds } = await loadShiftData(weekStart);
        const ahora = new Date();
        const data = operadores.map(op => {
            const h = horarioPorUsuario.get(op.id);
            const horario = h ? { dias: h.dias, inicio: h.hora_inicio, fin: h.hora_fin } : DEFAULT_SCHEDULE;
            const deGuardia = guardiaIds.has(op.id);
            return {
                ...op, horario, horarioPersonalizado: Boolean(h), deGuardia,
                turno: getShiftStatus({ estadoOperativo: op.estado_operativo, horario, deGuardia }, ahora)
            };
        });
        return res.json({ semana: weekStart.toISOString(), operadores: data });
    } catch (error) {
        console.error('Error al obtener turnos:', error);
        return res.status(500).json({ error: 'Error al obtener turnos' });
    }
}

async function setGuardia(req, res) {
    try {
        const weekStart = resolveWeek(req.body.semana);
        if (!weekStart) return res.status(400).json({ error: 'Fecha inválida (use AAAA-MM-DD)' });
        const ids = req.body.operatorIds;
        if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id.trim())) {
            return res.status(400).json({ error: 'operatorIds debe ser una lista de ids' });
        }
        const unique = [...new Set(ids)];
        const validos = await prisma.user.findMany({ where: { id: { in: unique }, activo: true, ...ATIENDE_WHERE, ...personaWhere(req.user) }, select: { id: true, nombre: true } });
        if (validos.length !== unique.length) {
            return res.status(400).json({ error: areaScope(req.user) ? 'Solo puedes poner de guardia a personas de tu área' : 'Solo los operadores pueden estar de guardia' });
        }

        // El jefe solo reemplaza la guardia de su área; las demás áreas quedan igual
        const deSuArea = areaScope(req.user) ? { user: { area_designada: areaScope(req.user) } } : {};
        await prisma.$transaction([
            prisma.guardiaSemanal.deleteMany({ where: { semana_inicio: weekStart, ...deSuArea } }),
            prisma.guardiaSemanal.createMany({ data: unique.map(userId => ({ userId, semana_inicio: weekStart })) })
        ]);
        const nombres = validos.map(v => v.nombre || v.id).join(', ') || 'nadie';
        await audit(req, 'GUARDIA_DEFINIDA', `Semana del ${formatWeek(weekStart)}: ${nombres}`);
        return res.json({ ok: true, semana: weekStart.toISOString(), operatorIds: unique });
    } catch (error) {
        console.error('Error al definir guardia:', error);
        return res.status(500).json({ error: 'Error al definir la guardia' });
    }
}

async function setHorario(req, res) {
    try {
        const operatorId = String(req.params.operatorId || '').trim();
        if (!operatorId) return res.status(400).json({ error: 'Operador inválido' });
        const operador = await prisma.user.findFirst({ where: { id: operatorId, activo: true, ...ATIENDE_WHERE, ...personaWhere(req.user) }, select: { id: true, nombre: true } });
        if (!operador) return res.status(404).json({ error: 'Operador no encontrado' });
        const { error, horario } = validateSchedule(req.body);
        if (error) return res.status(400).json({ error });
        const data = { dias: horario.dias, hora_inicio: horario.inicio, hora_fin: horario.fin };
        await prisma.horarioOperador.upsert({ where: { userId: operatorId }, create: { userId: operatorId, ...data }, update: data });
        await audit(req, 'HORARIO_EDITADO', `${operador.nombre || operatorId}: ${horario.dias.map(d => DIAS[d]).join(' ')} · ${horario.inicio}–${horario.fin}`);
        return res.json({ ok: true, horario });
    } catch (error) {
        console.error('Error al guardar horario:', error);
        return res.status(500).json({ error: 'Error al guardar el horario' });
    }
}

// Gestión de Turno (rediseño, IMPLEMENTACION.md §3.3)
async function renderTurno(req, res) {
    if (req.user.rol === 'OPERADOR') return res.redirect(302, '/');
    try {
        const weekStart = resolveWeek(req.query.semana) || getWeekStart(new Date());
        const ahora = new Date();
        const semanaActual = getWeekStart(ahora);
        const [operadores, elegida, actual, activos] = await Promise.all([
            prisma.user.findMany({
                where: { activo: true, ...ATIENDE_WHERE, ...personaWhere(req.user) },
                select: { id: true, nombre: true, email: true, area_designada: true, estado_operativo: true },
                orderBy: { nombre: 'asc' }
            }),
            loadShiftData(weekStart),
            loadShiftData(semanaActual),
            prisma.ticket.count({ where: { estado_actual: { in: ACTIVE_STATES }, ...ticketWhere(req.user) } })
        ]);
        const tablero = buildShiftBoard({
            operators: operadores,
            horarios: actual.horarioPorUsuario,
            guardiaSemana: elegida.guardiaIds,
            guardiaActual: actual.guardiaIds,
            weekStart,
            now: ahora
        });
        return res.render('turno', { titulo: 'Gestión de Turno', currentUser: req.user, tablero, activos });
    } catch (error) {
        console.error('Error al cargar Gestión de Turno:', error);
        return res.status(500).send('Error en el servidor');
    }
}

module.exports = { getTurnos, setGuardia, setHorario, loadShiftData, renderTurno };
