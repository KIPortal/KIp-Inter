'use strict';

/**
 * Cálculos de métricas del portal.
 *
 * Son funciones puras: no consultan la base de datos, así que se pueden probar
 * sin conexión (ver scripts/test-metrics.js). Las definiciones siguen
 * docs/especificacion-metricas.md.
 */

// Venezuela usa UTC-4 todo el año (sin horario de verano). Se fija de forma
// explícita para que "hoy" y las horas del día no dependan de la zona horaria
// del servidor (en producción suele ser UTC).
const UTC_OFFSET_HOURS = -4;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// Un ticket está "activo" (pendiente) mientras no esté cerrado.
const ACTIVE_STATES = ['NUEVO', 'EN_PROGRESO', 'EN_PAUSA', 'EN_ESPERA_TERCEROS'];

// Sobrecarga: un operador se marca cuando sus tickets activos superan 1.5 veces
// el promedio de su área y además tiene al menos 3, para no alertar por 1 o 2
// tickets cuando el promedio del área es casi cero.
const OVERLOAD_RATIO = 1.5;
const OVERLOAD_MIN_ACTIVE = 3;

/**
 * Inicio (inclusivo) y fin (exclusivo) del día calendario de Caracas que
 * contiene a `reference`, expresados como instantes absolutos.
 */
function getDayBounds(reference = new Date()) {
    const offsetMs = UTC_OFFSET_HOURS * HOUR_MS;
    const local = new Date(new Date(reference).getTime() + offsetMs);
    const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offsetMs;
    return { start: new Date(start), end: new Date(start + DAY_MS) };
}

/** Hora del día (0-23) en Caracas para un instante dado. */
function getHourOfDay(date) {
    return new Date(new Date(date).getTime() + UTC_OFFSET_HOURS * HOUR_MS).getUTCHours();
}

/**
 * Momento en que se cerró el ticket. Usa `resueltoEn` solo como respaldo de
 * `fecha_cierre` (hoy ambos campos se sellan juntos). No usa `updatedAt`: cualquier
 * edición posterior lo movería y falsearía "cerrados hoy".
 */
function getClosingDate(ticket) {
    return ticket?.fecha_cierre || ticket?.resueltoEn || null;
}

/**
 * Minutos entre que el ticket llegó (`createdAt`) y se cerró.
 * Devuelve null si falta alguna fecha o si el orden es imposible.
 */
function getResolutionMinutes(ticket) {
    const end = getClosingDate(ticket);
    if (!end || !ticket?.createdAt) return null;
    const minutes = (new Date(end).getTime() - new Date(ticket.createdAt).getTime()) / MINUTE_MS;
    return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

/** Promedio (suma de tiempos ÷ cantidad) en minutos; null si no hay datos. */
function averageResolutionMinutes(tickets) {
    let total = 0;
    let count = 0;
    for (const ticket of tickets || []) {
        const minutes = getResolutionMinutes(ticket);
        if (minutes === null) continue;
        total += minutes;
        count += 1;
    }
    return count > 0 ? total / count : null;
}

/** Texto legible: "45 min", "1.5 h" o "N/A". */
function formatMinutes(minutes) {
    if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return 'N/A';
    const rounded = Math.round(minutes);
    return rounded >= 60 ? `${(rounded / 60).toFixed(1)} h` : `${rounded} min`;
}

/**
 * Índice de carga de cada operador frente al promedio de tickets activos de su área.
 *
 * - Solo se compara dentro del mismo área.
 * - Los operadores ausentes no entran en el promedio (no pueden tomar trabajo).
 * - Si el área tiene un solo operador no hay con quién comparar: no hay índice
 *   ni alerta.
 *
 * @param {Array<{id: string, area_designada?: string, estado_operativo?: string, cargaActual: number}>} operators
 * @returns {Map<string, {comparable: boolean, promedioArea: number|null, indiceCarga: number|null, sobrecarga: boolean}>}
 */
function computeOverload(operators) {
    const byArea = new Map();
    for (const operator of operators || []) {
        const area = operator.area_designada || 'GENERAL';
        if (!byArea.has(area)) byArea.set(area, []);
        byArea.get(area).push(operator);
    }

    const result = new Map();
    for (const group of byArea.values()) {
        const present = group.filter(operator => operator.estado_operativo !== 'AUSENTE');
        const reference = present.length > 0 ? present : group;
        const comparable = reference.length >= 2;
        const average = reference.reduce((sum, operator) => sum + (operator.cargaActual || 0), 0) / reference.length;

        for (const operator of group) {
            if (!comparable) {
                result.set(operator.id, { comparable: false, promedioArea: null, indiceCarga: null, sobrecarga: false });
                continue;
            }
            const load = operator.cargaActual || 0;
            const index = average > 0 ? load / average : 0;
            result.set(operator.id, {
                comparable: true,
                promedioArea: Math.round(average * 100) / 100,
                indiceCarga: Math.round(index * 100) / 100,
                sobrecarga: load >= OVERLOAD_MIN_ACTIVE && index > OVERLOAD_RATIO
            });
        }
    }
    return result;
}

module.exports = {
    UTC_OFFSET_HOURS,
    ACTIVE_STATES,
    OVERLOAD_RATIO,
    OVERLOAD_MIN_ACTIVE,
    getDayBounds,
    getHourOfDay,
    getClosingDate,
    getResolutionMinutes,
    averageResolutionMinutes,
    formatMinutes,
    computeOverload
};
