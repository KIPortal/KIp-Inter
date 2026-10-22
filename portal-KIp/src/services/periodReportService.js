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
    getResolutionMinutes,
    getBusinessResolutionMinutes,
    formatMinutes,
    computeOverload
} = require('./metricsService');

// Catálogo vivo de áreas (tabla Area); arranca con las 7 originales
const { AREAS, AREA_NAMES } = require('./areaCatalog');
const { prioridadDe } = require('./rulesService');
const { buildCasosComunes, nivelDeTicket } = require('./tipoCasoService');

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

/**
 * Prioridad (urgencia) de un ticket para el reporte: 'P1', 'P2', 'P3' o 'Sin prioridad'.
 * Los puntos ya no la indican (salen del nivel del tipo de caso); ver rulesService.prioridadDe.
 */
function priorityOfTicket(t) {
    const p = prioridadDe(t);
    return p === 'SP' ? 'Sin prioridad' : p;
}

/** Estado de carga de un operador según las reglas de sobrecarga (spec §7). */
function loadStatus(estadoOperativo, carga) {
    if (estadoOperativo === 'AUSENTE') return 'Ausente';
    if (carga && carga.sobrecarga) return 'Sobrecarga';
    if (carga && carga.comparable) return 'Normal';
    return 'Sin comparación';
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

/** Puntos de los tickets resueltos y cuántos hubo por prioridad. */
function pointsSummary(resolved) {
    const puntos = resolved.reduce((sum, t) => sum + (t.puntos_complejidad || 0), 0);
    const count = p => resolved.filter(t => priorityOfTicket(t) === p).length;
    return {
        puntos,
        ptsPorTicket: resolved.length ? Math.round((puntos / resolved.length) * 10) / 10 : 0,
        p1: count('P1'), p2: count('P2'), p3: count('P3'), sinPrioridad: count('Sin prioridad')
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
        ...pointsSummary(resolved),
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
        puntos: totals.puntos,
        ptsPorTicket: totals.ptsPorTicket,
        ...timeMetrics(totals._resolved)
    };

    // (el bloque por área se arma después de calcular la sobrecarga)

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
            estadoOperativo: o.estado_operativo,
            asignados: counts.asignados,
            resueltos: counts.resueltos,
            puntos: counts.puntos,
            ptsPorTicket: counts.ptsPorTicket,
            p1: counts.p1, p2: counts.p2, p3: counts.p3, sinPrioridad: counts.sinPrioridad,
            activos: withLoad.find(w => w.id === o.id)?.cargaActual ?? 0,
            ...timeMetrics(counts._resolved),
            indiceCarga: carga.comparable ? Math.round(carga.indiceCarga * 100) / 100 : null,
            sobrecarga: Boolean(carga.sobrecarga),
            estadoCarga: loadStatus(o.estado_operativo, carga)
        };
    }).sort((x, y) => y.puntos - x.puntos || y.resueltos - x.resueltos || x.nombre.localeCompare(y.nombre));

    // --- Por área (balance de carga) ---
    const areaCodes = areaFilter ? [areaFilter] : AREAS;
    const totalPuntos = areaCodes.reduce((sum, code) => sum + volumeCounts(allTickets.filter(t => t.area_designada === code), range).puntos, 0);
    const porArea = areaCodes.map(code => {
        const counts = volumeCounts(allTickets.filter(t => t.area_designada === code), range);
        const ops = (operators || []).filter(o => o.area_designada === code);
        const flagged = ops.filter(o => overload.get(o.id)?.sobrecarga).length;
        const comparable = ops.filter(o => overload.get(o.id)?.comparable).length;
        return {
            area: code,
            nombre: AREA_NAMES[code],
            operadores: ops.length,
            creados: counts.creados,
            asignados: counts.asignados,
            resueltos: counts.resueltos,
            cerrados: counts.cerrados,
            activos: counts.activos,
            puntos: counts.puntos,
            participacion: totalPuntos ? Math.round((counts.puntos / totalPuntos) * 1000) / 1000 : 0,
            ...timeMetrics(counts._resolved),
            sobrecargados: flagged,
            estadoCarga: ops.length === 0 ? 'Sin operadores' : flagged > 0 ? 'Sobrecarga' : comparable === 0 ? 'Sin comparación' : 'Normal'
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
            prioridad: priorityOfTicket(t),
            puntos: t.puntos_complejidad || 0,
            nivel: nivelDeTicket(t),
            tipoCaso: t.tipo_caso?.nombre || (nivelDeTicket(t) ? 'Otro' : ''),
            operador: t.asignado_a?.nombre || 'Sin asignar',
            estado: STATE_NAMES[t.estado_actual] || t.estado_actual,
            llegada: t.createdAt || null,
            asignacion: t.fecha_asignacion || null,
            resolucion: t.resueltoEn || null,
            cierre: t.fecha_cierre || null,
            duracionTotalMin: toMinutes(getResolutionMinutes(t)),
            duracionHorarioMin: toMinutes(getBusinessResolutionMinutes(t)),
            remitente: t.remitente || null
        }));

    // --- Casos comunes: ocurrencia, puntos y tiempo real frente al estimado, por tipo de caso ---
    const casosComunes = buildCasosComunes({ tickets: scoped, range });

    return { resumen, porArea, porOperador, flujoHorario, detalle, casosComunes, lecturas: buildInsights({ resumen, porArea, porOperador, flujoHorario, casosComunes, tickets: scoped }) };
}

/** Lecturas clave en lenguaje llano para el coordinador (también se muestran en el Excel). */
function buildInsights({ resumen, porArea, porOperador, flujoHorario, casosComunes, tickets }) {
    const out = [];
    const pico = flujoHorario.reduce((best, h) => (h.recibidos > best.recibidos ? h : best), { recibidos: 0 });
    if (pico.recibidos > 0) out.push(`Hora pico de llegada: ${pico.etiqueta} (${pico.recibidos} ${pico.recibidos === 1 ? 'ticket' : 'tickets'}).`);
    const topArea = porArea.filter(a => a.puntos > 0).sort((a, b) => b.puntos - a.puntos)[0];
    if (topArea) out.push(`Área con más trabajo resuelto: ${topArea.nombre} (${topArea.puntos} pts, ${Math.round(topArea.participacion * 1000) / 10}% del total).`);
    const lenta = porArea.filter(a => a.tiempoTotalMin !== null).sort((a, b) => b.tiempoTotalMin - a.tiempoTotalMin)[0];
    if (lenta) out.push(`Mayor tiempo de solución promedio: ${lenta.nombre} (${lenta.tiempoTotal}).`);
    const topOp = porOperador.filter(o => o.resueltos > 0)[0];
    if (topOp) out.push(`Más puntos resueltos: ${topOp.nombre} (${topOp.puntos} pts en ${topOp.resueltos} tickets).`);
    const comun = (casosComunes?.filas || []).find(f => f.tipoId);
    if (comun) out.push(`Caso más común: ${comun.nombre} (${comun.ocurrencias} ${comun.ocurrencias === 1 ? 'vez' : 'veces'}, nivel ${comun.nivel}).`);
    const lentos = (casosComunes?.filas || []).filter(f => f.sobreEstimado).map(f => f.nombre);
    if (lentos.length) out.push(`Tardan más de lo estimado: ${lentos.slice(0, 3).join(', ')}${lentos.length > 3 ? ` y ${lentos.length - 3} más` : ''}.`);
    const sobre = porOperador.filter(o => o.sobrecarga).map(o => o.nombre);
    if (sobre.length) out.push(`Operadores en sobrecarga ahora: ${sobre.join(', ')}.`);
    const sinAsignar = tickets.filter(t => ACTIVE_STATES.includes(t.estado_actual) && !t.asignado_a).length;
    if (sinAsignar > 0) out.push(`Tickets activos sin asignar: ${sinAsignar}.`);
    if (resumen.resueltos === 0 && resumen.creados > 0) out.push('Se recibieron tickets pero ninguno se resolvió en el periodo.');
    if (out.length === 0) out.push('Sin actividad en el periodo seleccionado.');
    return out;
}

module.exports = { buildPeriodReport, priorityOfTicket, AREAS, AREA_NAMES, STATE_NAMES };
