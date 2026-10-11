'use strict';

/**
 * Reporte por periodo (spec §6, §8 y §11). Funciones puras: reciben tickets y
 * operadores ya cargados y devuelven los indicadores. No consultan la base de
 * datos, así que se prueban sin conexión (scripts/test-period-report.js).
 */

const {
    ACTIVE_STATES,
    getHourOfDay,
    getClosingDate,
    averageResolutionMinutes,
    averageBusinessMinutes,
    formatMinutes,
    computeOverload
} = require('./metricsService');

const AREAS = [
    'GENERAL', 'REDES_FTTH', 'TRAFICO_INALAMBRICO', 'WAN',
    'GRANDES_CLIENTES', 'SEGURIDAD', 'TELEFONIA'
];

const AREA_NAMES = {
    GENERAL: 'General',
    REDES_FTTH: 'Redes FTTH',
    TRAFICO_INALAMBRICO: 'Tráfico Inalámbrico',
    WAN: 'WAN',
    GRANDES_CLIENTES: 'Grandes Clientes',
    SEGURIDAD: 'Seguridad',
    TELEFONIA: 'Telefonía'
};

const STATE_NAMES = {
    NUEVO: 'Nuevo',
    EN_PROGRESO: 'En progreso',
    EN_PAUSA: 'En pausa',
    EN_ESPERA_TERCEROS: 'En espera de terceros',
    RESUELTO: 'Resuelto',
    CERRADO: 'Cerrado'
};

const inRange = (value, range) => {
    if (!value) return false;
    const t = new Date(value).getTime();
    return t >= range.start.getTime() && t < range.end.getTime();
};

/** Prioridad a partir de los puntos asignados por el coordinador (P1=8, P2=5, P3=1). */
function priorityFromPoints(points) {
    if (points >= 8) return 'P1';
    if (points >= 5) return 'P2';
    if (points >= 1) return 'P3';
    return 'Sin prioridad';
}

const toMinutes = value => (value === null || value === undefined ? null : Math.round(value * 10) / 10);

function timeMetrics(resolved) {
    const total = toMinutes(averageResolutionMinutes(resolved));
    const horario = toMinutes(averageBusinessMinutes(resolved));
    return {
        tiempoTotalMin: total,
        tiempoTotal: formatMinutes(total),
        tiempoHorarioMin: horario,
        tiempoHorario: formatMinutes(horario)
    };
}

function volumeCounts(tickets, range) {
    const resolved = tickets.filter(t => inRange(getClosingDate(t), range));
    return {
        creados: tickets.filter(t => inRange(t.createdAt, range)).length,
        asignados: tickets.filter(t => inRange(t.fecha_asignacion, range)).length,
        resueltos: tickets.filter(t => inRange(t.resueltoEn || t.fecha_cierre, range)).length,
        cerrados: tickets.filter(t => inRange(t.fecha_cierre, range)).length,
        activos: tickets.filter(t => ACTIVE_STATES.includes(t.estado_actual)).length,
        _resolved: resolved
    };
}

/**
 * @param {object} input
 * @param {Array}  input.tickets    Tickets (no eliminados) con createdAt, fecha_asignacion,
 *                                  resueltoEn, fecha_cierre, estado_actual, area_designada,
 *                                  puntos_complejidad y asignado_a { id, nombre }.
 *                                  Debe incluir los del periodo y todos los activos.
 * @param {Array}  input.operators  Operadores { id, nombre, area_designada, estado_operativo }.
 * @param {object} input.range      Resultado de getPeriodBounds().
 * @param {string} [input.area]     Código de área para filtrar (todas si falta).
 */
function buildPeriodReport({ tickets, operators, range, area }) {
    const areaFilter = area && AREAS.includes(area) ? area : null;
    const allTickets = (tickets || []).filter(Boolean);
    const scoped = areaFilter ? allTickets.filter(t => t.area_designada === areaFilter) : allTickets;
    const scopedOperators = (operators || []).filter(o => !areaFilter || o.area_designada === areaFilter);

    // --- Resumen ---
    const totals = volumeCounts(scoped, range);
    const resumen = {
        periodo: range.periodo,
        desde: range.desde,
        hasta: range.hasta,
        etiqueta: range.etiqueta,
        area: areaFilter ? AREA_NAMES[areaFilter] : 'Todas',
        creados: totals.creados,
        asignados: totals.asignados,
        resueltos: totals.resueltos,
        cerrados: totals.cerrados,
        activos: totals.activos,
        ...timeMetrics(totals._resolved)
    };

    // --- Por área ---
    const porArea = (areaFilter ? [areaFilter] : AREAS).map(code => {
        const ofArea = allTickets.filter(t => t.area_designada === code);
        const counts = volumeCounts(ofArea, range);
        return {
            area: code,
            nombre: AREA_NAMES[code],
            creados: counts.creados,
            asignados: counts.asignados,
            resueltos: counts.resueltos,
            cerrados: counts.cerrados,
            activos: counts.activos,
            ...timeMetrics(counts._resolved)
        };
    });

    // --- Por operador (carga actual con las reglas de sobrecarga de §7) ---
    const withLoad = scopedOperators.map(o => ({
        id: o.id,
        area_designada: o.area_designada,
        estado_operativo: o.estado_operativo,
        cargaActual: scoped.filter(t => t.asignado_a?.id === o.id && ACTIVE_STATES.includes(t.estado_actual)).length
    }));
    // La sobrecarga se compara siempre contra su área completa, aunque se filtre
    const overloadBase = (operators || []).map(o => ({
        id: o.id,
        area_designada: o.area_designada,
        estado_operativo: o.estado_operativo,
        cargaActual: allTickets.filter(t => t.asignado_a?.id === o.id && ACTIVE_STATES.includes(t.estado_actual)).length
    }));
    const overload = computeOverload(overloadBase);
    const porOperador = scopedOperators.map(o => {
        const mine = allTickets.filter(t => t.asignado_a?.id === o.id);
        const counts = volumeCounts(mine, range);
        const carga = overload.get(o.id) || {};
        return {
            id: o.id,
            nombre: o.nombre,
            area: o.area_designada,
            areaNombre: AREA_NAMES[o.area_designada] || o.area_designada,
            asignados: counts.asignados,
            resueltos: counts.resueltos,
            activos: withLoad.find(w => w.id === o.id)?.cargaActual ?? 0,
            ...timeMetrics(counts._resolved),
            indiceCarga: carga.comparable ? Math.round(carga.indiceCarga * 100) / 100 : null,
            sobrecarga: Boolean(carga.sobrecarga)
        };
    });

    // --- Flujo horario: tickets recibidos por hora del día (Caracas) en el periodo ---
    const recibidosPorHora = new Array(24).fill(0);
    scoped.filter(t => inRange(t.createdAt, range)).forEach(t => { recibidosPorHora[getHourOfDay(t.createdAt)]++; });
    const flujoHorario = recibidosPorHora.map((recibidos, hora) => ({
        hora,
        etiqueta: `${String(hora).padStart(2, '0')}:00`,
        recibidos
    }));

    // --- Detalle: tickets con algún evento en el periodo, o activos ---
    const detalle = scoped
        .filter(t => inRange(t.createdAt, range) || inRange(t.fecha_asignacion, range)
            || inRange(t.resueltoEn, range) || inRange(t.fecha_cierre, range)
            || ACTIVE_STATES.includes(t.estado_actual))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .map(t => ({
            codigo: t.codigo_incidencia,
            asunto: t.asunto,
            area: AREA_NAMES[t.area_designada] || t.area_designada,
            prioridad: priorityFromPoints(t.puntos_complejidad || 0),
            puntos: t.puntos_complejidad || 0,
            operador: t.asignado_a?.nombre || 'Sin asignar',
            estado: STATE_NAMES[t.estado_actual] || t.estado_actual,
            llegada: t.createdAt || null,
            asignacion: t.fecha_asignacion || null,
            resolucion: t.resueltoEn || null,
            cierre: t.fecha_cierre || null
        }));

    return { resumen, porArea, porOperador, flujoHorario, detalle };
}

module.exports = { buildPeriodReport, priorityFromPoints, AREAS, AREA_NAMES, STATE_NAMES };
