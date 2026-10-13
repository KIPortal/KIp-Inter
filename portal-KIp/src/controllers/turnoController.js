'use strict';

const prisma = require('../config/prisma');
const { validateSchedule, getShiftStatus, getWeekStart, DEFAULT_SCHEDULE } = require('../services/shiftService');
const { parseCaracasDate } = require('../services/metricsService');

async function audit(req, accion, detalles) {
    try {
        await prisma.auditLog.create({ data: { accion, userId: req.user?.id || null, detalles } });
    } catch (e) {
        console.error('No se pudo registrar auditoría:', e.message);
    }
}

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
            where: { rol: 'OPERADOR' },
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
        const validos = await prisma.user.findMany({ where: { id: { in: unique }, rol: 'OPERADOR' }, select: { id: true } });
        if (validos.length !== unique.length) return res.status(400).json({ error: 'Solo los operadores pueden estar de guardia' });

        await prisma.$transaction([
            prisma.guardiaSemanal.deleteMany({ where: { semana_inicio: weekStart } }),
            prisma.guardiaSemanal.createMany({ data: unique.map(userId => ({ userId, semana_inicio: weekStart })) })
        ]);
        await audit(req, 'GUARDIA_DEFINIDA', `Semana ${weekStart.toISOString().slice(0, 10)}: operadores [${unique.join(', ')}]`);
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
        const operador = await prisma.user.findFirst({ where: { id: operatorId, rol: 'OPERADOR' }, select: { id: true } });
        if (!operador) return res.status(404).json({ error: 'Operador no encontrado' });
        const { error, horario } = validateSchedule(req.body);
        if (error) return res.status(400).json({ error });
        const data = { dias: horario.dias, hora_inicio: horario.inicio, hora_fin: horario.fin };
        await prisma.horarioOperador.upsert({ where: { userId: operatorId }, create: { userId: operatorId, ...data }, update: data });
        await audit(req, 'HORARIO_EDITADO', `Operador ${operatorId}: días ${horario.dias.join(',')} ${horario.inicio}-${horario.fin}`);
        return res.json({ ok: true, horario });
    } catch (error) {
        console.error('Error al guardar horario:', error);
        return res.status(500).json({ error: 'Error al guardar el horario' });
    }
}

module.exports = { getTurnos, setGuardia, setHorario, loadShiftData };
