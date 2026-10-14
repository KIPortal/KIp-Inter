'use strict';

const prisma = require('../config/prisma');
const { ATIENDE_WHERE, personaWhere, ticketWhere, areaScope } = require('../services/roleService');
const { validateSchedule, getShiftStatus, getWeekStart, DEFAULT_SCHEDULE, weekDates, validateGuardPlan } = require('../services/shiftService');
const { parseCaracasDate, ACTIVE_STATES, getDayBounds } = require('../services/metricsService');
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

const DAY_MS = 24 * 3600 * 1000;

/**
 * Carga horarios y guardias; tolera que las tablas aún no existan (migración pendiente).
 * - guardiaIds: quién está de guardia HOY (para el estado actual).
 * - guardiaPorDia: fecha (AAAA-MM-DD) → ids de guardia, para la semana `weekStart`.
 */
async function loadShiftData(weekStart, now = new Date()) {
    const vacio = { horarioPorUsuario: new Map(), guardiaIds: new Set(), guardiaPorDia: new Map(weekDates(weekStart).map(f => [f, new Set()])) };
    try {
        const hoy = getDayBounds(now).start;
        const finSemana = new Date(new Date(weekStart).getTime() + 7 * DAY_MS);
        const [horarios, guardias] = await Promise.all([
            prisma.horarioOperador.findMany(),
            prisma.guardiaDia.findMany({ where: { OR: [{ fecha: { gte: weekStart, lt: finSemana } }, { fecha: hoy }] } })
        ]);
        const guardiaPorDia = vacio.guardiaPorDia;
        guardias.forEach(g => {
            const f = formatCaracasDate(g.fecha);
            if (guardiaPorDia.has(f)) guardiaPorDia.get(f).add(g.userId);
        });
        return {
            horarioPorUsuario: new Map(horarios.map(h => [h.userId, h])),
            guardiaIds: new Set(guardias.filter(g => new Date(g.fecha).getTime() === hoy.getTime()).map(g => g.userId)),
            guardiaPorDia
        };
    } catch (error) {
        console.error('Turnos no disponibles (¿migración pendiente?):', error.message);
        return vacio;
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
        const ahora = new Date();
        const { horarioPorUsuario, guardiaIds, guardiaPorDia } = await loadShiftData(weekStart, ahora);
        const data = operadores.map(op => {
            const h = horarioPorUsuario.get(op.id);
            const horario = h ? { dias: h.dias, inicio: h.hora_inicio, fin: h.hora_fin } : DEFAULT_SCHEDULE;
            const deGuardia = guardiaIds.has(op.id);
            return {
                ...op, horario, horarioPersonalizado: Boolean(h), deGuardia,
                guardiaDias: [...guardiaPorDia].filter(([, ids]) => ids.has(op.id)).map(([f]) => f),
                turno: getShiftStatus({ estadoOperativo: op.estado_operativo, horario, deGuardia }, ahora)
            };
        });
        return res.json({ semana: weekStart.toISOString(), operadores: data });
    } catch (error) {
        console.error('Error al obtener turnos:', error);
        return res.status(500).json({ error: 'Error al obtener turnos' });
    }
}

// Guardia por día de una semana: { semana, dias: { 'AAAA-MM-DD': [ids] } }
// (o { semana, operatorIds } para poner a esas personas los 7 días).
async function setGuardia(req, res) {
    try {
        const weekStart = resolveWeek(req.body.semana);
        if (!weekStart) return res.status(400).json({ error: 'Fecha inválida (use AAAA-MM-DD)' });
        const fechas = weekDates(weekStart);
        let dias = req.body.dias;
        if (dias === undefined && Array.isArray(req.body.operatorIds)) dias = Object.fromEntries(fechas.map(f => [f, req.body.operatorIds]));
        const { error, plan, ids } = validateGuardPlan(dias, weekStart);
        if (error) return res.status(400).json({ error });

        const validos = await prisma.user.findMany({ where: { id: { in: ids }, activo: true, ...ATIENDE_WHERE, ...personaWhere(req.user) }, select: { id: true, nombre: true } });
        if (validos.length !== ids.length) {
            return res.status(400).json({ error: areaScope(req.user) ? 'Solo puedes poner de guardia a personas de tu área' : 'Solo quien atiende tickets puede estar de guardia' });
        }

        // El jefe solo reemplaza la guardia de su área; las demás áreas quedan igual
        const deSuArea = areaScope(req.user) ? { user: { area_designada: areaScope(req.user) } } : {};
        const finSemana = new Date(weekStart.getTime() + 7 * DAY_MS);
        const filas = Object.entries(plan).flatMap(([f, lista]) => lista.map(userId => ({ userId, fecha: parseCaracasDate(f) })));
        await prisma.$transaction([
            prisma.guardiaDia.deleteMany({ where: { fecha: { gte: weekStart, lt: finSemana }, ...deSuArea } }),
            prisma.guardiaDia.createMany({ data: filas, skipDuplicates: true })
        ]);
        const nombre = new Map(validos.map(v => [v.id, v.nombre || v.id]));
        const DIA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const detalle = fechas.map(f => {
            const dow = new Date(f + 'T12:00:00Z').getUTCDay();
            return `${DIA[dow]} ${Number(f.slice(8))}: ${(plan[f] || []).map(id => nombre.get(id)).join(', ') || 'nadie'}`;
        }).join('; ');
        await audit(req, 'GUARDIA_DEFINIDA', `Semana del ${formatWeek(weekStart)}${areaScope(req.user) ? ' (' + areaScope(req.user) + ')' : ''}. ${detalle}`);
        return res.json({ ok: true, semana: weekStart.toISOString(), dias: plan });
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
        const [operadores, guardias, activos] = await Promise.all([
            prisma.user.findMany({
                where: { activo: true, ...ATIENDE_WHERE, ...personaWhere(req.user) },
                select: { id: true, nombre: true, email: true, area_designada: true, estado_operativo: true },
                orderBy: { nombre: 'asc' }
            }),
            loadShiftData(weekStart, ahora),
            prisma.ticket.count({ where: { estado_actual: { in: ACTIVE_STATES }, ...ticketWhere(req.user) } })
        ]);
        const tablero = buildShiftBoard({
            operators: operadores,
            horarios: guardias.horarioPorUsuario,
            guardiaPorDia: guardias.guardiaPorDia,
            guardiaActual: guardias.guardiaIds,
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
