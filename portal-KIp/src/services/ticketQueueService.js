'use strict';

/**
 * Cola de tickets del coordinador (IMPLEMENTACION.md §3.2). Funciones puras:
 * reciben tickets, operadores y el traspaso ya cargados y devuelven lo que
 * dibuja la vista. Sin base de datos (ver scripts/test-ticket-queue.js).
 */

const {
    ACTIVE_STATES,
    UTC_OFFSET_HOURS,
    getDayBounds,
    getClosingDate,
    computeOverload
} = require('./metricsService');
const { AREA_NAMES } = require('./periodReportService');
const { activeAreas, allSubgrupos, subgrupoName } = require('./areaCatalog');
const { estadosVeLista } = require('./estadosVeService');
const { agingTickets, formatAge } = require('./dashboardService');
const { DEFAULT_RULES, overloadOptions } = require('./rulesService');
const { normalizeOperator, buildSuggestions, eligibility } = require('./assignmentService');
const { fotoUrl } = require('./profileService');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const PRIORITY_BY_POINTS = { 8: 'P1', 5: 'P2', 1: 'P3' };
const ORIGIN_NAMES = { CORREO: 'Correo', LLAMADA: 'Llamada', JEFATURA: 'Jefatura', COORDINADOR: 'Coordinador' };

const time = value => (value ? new Date(value).getTime() : NaN);
const priorityOf = points => PRIORITY_BY_POINTS[points] || 'SP';

function initials(nombre) {
    return String(nombre || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';
}

function shiftGroup(turno) {
    const codigo = turno?.codigo;
    if (codigo === 'DE_GUARDIA' || codigo === 'EN_CASA_GUARDIA') return 'guardia';
    if (codigo === 'EN_TURNO') return 'turno';
    return 'fuera';
}

/** Días calendario de Caracas entre la llegada y hoy (0 = hoy, 1 = ayer…). */
function daysAgo(createdAt, now) {
    const hoy = getDayBounds(now).start.getTime();
    const t = time(createdAt);
    if (!Number.isFinite(t)) return null;
    return t >= hoy ? 0 : Math.ceil((hoy - t) / DAY_MS);
}

/** Primer 08:00 de Caracas posterior a `instant`: ahí vence un traspaso. */
function handoffExpiry(instant) {
    const t = time(instant);
    const local = new Date(t + UTC_OFFSET_HOURS * HOUR_MS);
    let ocho = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 8) - UTC_OFFSET_HOURS * HOUR_MS;
    if (ocho <= t) ocho += DAY_MS;
    return new Date(ocho);
}


/**
 * Vista del traspaso vigente: pendientes (no resueltos ni cerrados) y vigencia.
 * @param {object|null} traspaso con tickets: [{ ticket: { codigo_incidencia, estado_actual, eliminado_en } }]
 */
function buildHandoffView(traspaso, now = new Date()) {
    if (!traspaso) return null;
    const pendientes = (traspaso.tickets || [])
        .map(tt => tt.ticket)
        .filter(t => t && !t.eliminado_en && !['RESUELTO', 'CERRADO'].includes(t.estado_actual))
        .map(t => t.codigo_incidencia);
    const vence = handoffExpiry(traspaso.createdAt);
    const vigente = !traspaso.cerrado_en && pendientes.length > 0 && time(now) < vence.getTime();
    return {
        id: traspaso.id,
        nota: traspaso.nota,
        autor: traspaso.creado_por?.nombre || 'Coordinador',
        creadoEn: new Date(traspaso.createdAt).toISOString(),
        venceEn: vence.toISOString(),
        total: (traspaso.tickets || []).length,
        pendientes,
        vigente
    };
}

/**
 * @param {object} p
 * @param {Array} p.tickets    tickets no eliminados con asignado_a, creado_por y adjuntos
 * @param {Array} p.operators  operadores con { id, nombre, area_designada, estado_operativo, turno, tickets_asignados }
 * @param {Date}  [p.now]
 * @param {object} [p.rules]  reglas de rulesService (antigüedad, sobrecarga, sugerencia)
 */
function buildQueue({ tickets = [], operators = [], now = new Date(), rules = DEFAULT_RULES } = {}) {
    const nowMs = time(now);
    const hoy = getDayBounds(now);
    const enHoy = v => { const t = time(v); return Number.isFinite(t) && t >= hoy.start.getTime() && t < hoy.end.getTime(); };

    // Antigüedad: misma regla que el Dashboard (P1 1 h, P2 2 h, P3 4 h, sin prioridad 30 min)
    const atrasos = new Map(agingTickets(tickets, now, rules).map(a => [a.codigo, a]));

    // Cola: activos, resueltos sin cerrar y cerrados hoy
    const visibles = tickets.filter(t =>
        ACTIVE_STATES.includes(t.estado_actual) || t.estado_actual === 'RESUELTO' ||
        (t.estado_actual === 'CERRADO' && enHoy(t.fecha_cierre || getClosingDate(t))));

    const filas = visibles.map(t => {
        const atraso = atrasos.get(t.codigo_incidencia);
        const ultimo = Math.max(time(t.updatedAt) || 0, time(t.fecha_asignacion) || 0, time(t.createdAt) || 0);
        return {
            codigo: t.codigo_incidencia,
            asunto: t.asunto,
            descripcion: t.descripcion || '',
            remitente: t.remitente || '',
            origen: ORIGIN_NAMES[t.origen_ingesta] || t.origen_ingesta || '',
            area: t.area_designada || 'GENERAL',
            areaNombre: AREA_NAMES[t.area_designada] || t.area_designada || 'General',
            estadoVe: t.estado_ve || '',
            subgrupo: t.subgrupo_id || '',
            subgrupoNombre: subgrupoName(t.subgrupo_id),
            prioridad: priorityOf(t.puntos_complejidad),
            sugerida: priorityOf(t.puntos_complejidad) === 'SP' ? (t.prioridad_sugerida || null) : null,
            puntos: t.puntos_complejidad || 0,
            estado: t.estado_actual,
            operador: t.asignado_a ? { id: t.asignado_a.id, nombre: t.asignado_a.nombre, iniciales: initials(t.asignado_a.nombre), foto: fotoUrl(t.asignado_a.foto) } : null,
            creadoPor: t.creado_por?.nombre || (t.origen_ingesta === 'CORREO' ? 'Buzón compartido' : 'Coordinador'),
            llegada: new Date(t.createdAt).toISOString(),
            edadMin: Math.max(0, Math.round((nowMs - time(t.createdAt)) / MINUTE_MS)),
            inmovilMin: ultimo ? Math.max(0, Math.round((nowMs - ultimo) / MINUTE_MS)) : null,
            diasAtras: daysAgo(t.createdAt, now),
            alerta: atraso
                ? `${atraso.sinAsignar ? 'Sin asignar' : 'Sin movimiento'} más de ${formatAge(atraso.limite)}`
                : null,
            adjuntos: (t.adjuntos || []).map(a => ({ nombre: a.nombre_original, ruta: a.ruta, peso: a.peso || null }))
        };
    });

    // Operadores: carga activa, estado de turno y sobrecarga (1.5× el promedio del área, mínimo 3)
    const carga = new Map(operators.map(o => [o.id, (o.tickets_asignados || []).length]));
    const overload = computeOverload(operators.map(o => ({
        id: o.id, area_designada: o.area_designada, estado_operativo: o.estado_operativo, cargaActual: carga.get(o.id)
    })), overloadOptions(rules));
    const operadores = operators.map(o => {
        const ov = overload.get(o.id) || {};
        const norm = normalizeOperator(o, carga.get(o.id) || 0, ov.sobrecarga);
        return {
            elegible: eligibility(norm, now, rules),
            deGuardia: norm.deGuardia,
            disponible: norm.disponible,
            id: o.id,
            nombre: o.nombre,
            iniciales: initials(o.nombre),
            foto: fotoUrl(o.foto),
            area: o.area_designada || 'GENERAL',
            areaNombre: AREA_NAMES[o.area_designada] || o.area_designada || 'General',
            subgrupo: o.subgrupo_id || '',
            subgrupoNombre: subgrupoName(o.subgrupo_id),
            estado: { grupo: shiftGroup(o.turno), etiqueta: o.turno?.etiqueta || 'Fuera de turno' },
            carga: carga.get(o.id) || 0,
            sobrecarga: Boolean(ov.sobrecarga),
            promedioArea: ov.promedioArea ?? null
        };
    }).sort((a, b) => a.nombre.localeCompare(b.nombre));

    const areas = activeAreas();
    // Sugerencia por área (§4) y cola de espera: sin asignar y nadie disponible en su área
    const sug = buildSuggestions({
        operadores: operadores.map(o => normalizeOperator(o)),
        areas: areas.map(a => a.codigo),
        tickets,
        now,
        rules
    });
    const enCola = new Set(sug.enCola);
    filas.forEach(f => { f.enCola = enCola.has(f.codigo); });

    // Tarjetas fijas: total de la operación, no cambian con los filtros
    const activos = tickets.filter(t => ACTIVE_STATES.includes(t.estado_actual));
    const resumen = {
        activos: activos.length,
        sinAsignar: activos.filter(t => !t.asignado_a_id).length,
        criticosSinAsignar: tickets.filter(t => !t.asignado_a_id && t.estado_actual !== 'CERRADO' && (t.puntos_complejidad || 0) >= 5).length,
        pausaEspera: tickets.filter(t => ['EN_PAUSA', 'EN_ESPERA_TERCEROS'].includes(t.estado_actual)).length,
        resueltosSinCerrar: tickets.filter(t => t.estado_actual === 'RESUELTO').length,
        creadosHoy: tickets.filter(t => enHoy(t.createdAt)).length,
        cerradosHoy: filas.filter(f => f.estado === 'CERRADO').length,
        enCola: enCola.size
    };

    // Cada área con sus subgrupos activos (para filtrar y elegir en los formularios)
    const conSubgrupos = areas.map(a => ({ ...a, subgrupos: allSubgrupos().filter(g => g.area === a.codigo && g.activo).map(g => ({ id: g.id, nombre: g.nombre })) }));
    return { tickets: filas, operadores, areas: conSubgrupos, estadosVe: estadosVeLista(), sugeridos: sug.porArea, otraArea: sug.otraArea, resumen, reglas: rules };
}

/**
 * Filtro de Prisma con los tickets que la cola puede mostrar: los no cerrados
 * y los cerrados hoy. Los cerrados de otros días se descartaban en buildQueue.
 */
function ventanaCola(now = new Date()) {
    const desde = getDayBounds(now).start;
    return {
        OR: [
            { estado_actual: { not: 'CERRADO' } },
            { createdAt: { gte: desde } },
            { resueltoEn: { gte: desde } },
            { fecha_cierre: { gte: desde } }
        ]
    };
}

module.exports = { buildQueue, ventanaCola, buildHandoffView, handoffExpiry, priorityOf, daysAgo };
