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

// Sobrecarga: un operador se marca cuando los puntos de sus tickets activos
// superan 1.5 veces el promedio de su área y además tiene al menos 3 activos,
// para no alertar por 1 o 2 tickets cuando el promedio del área es casi cero.
const OVERLOAD_RATIO = 1.5;
const OVERLOAD_MIN_ACTIVE = 3;
// Un ticket activo aún sin clasificar pesa como nivel 1 (2 pts): es trabajo aunque no tenga puntos.
const PESO_SIN_CLASIFICAR = 2;

/** Puntos con que un ticket activo suma a la carga (los suyos, o 2 si aún no tiene). */
const pesoCarga = t => (t && t.puntos_complejidad > 0 ? t.puntos_complejidad : PESO_SIN_CLASIFICAR);
/** Puntos acumulados de una lista de tickets activos. */
const puntosActivos = tickets => (tickets || []).reduce((sum, t) => sum + pesoCarga(t), 0);

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
 * Momento en que terminó el trabajo: `resueltoEn` (lo sella el operador al
 * resolver) y, como respaldo, `fecha_cierre` (lo sella el coordinador al cerrar;
 * cubre cierres directos y datos antiguos). No usa `updatedAt`: cualquier
 * edición posterior lo movería y falsearía "cerrados hoy".
 */
function getClosingDate(ticket) {
    // Fin del trabajo = cuando el operador resolvió; si no hay, cuando se cerró
    return ticket?.resueltoEn || ticket?.fecha_cierre || null;
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
 * Índice de carga de cada operador: sus puntos activos acumulados frente al
 * promedio de puntos activos de su área.
 *
 * - Solo se compara dentro del mismo área.
 * - Los operadores ausentes no entran en el promedio (no pueden tomar trabajo).
 * - Si el área tiene un solo operador no hay con quién comparar: no hay índice
 *   ni alerta.
 *
 * - `cargaActual` son los puntos activos (`puntosActivos`) y `activos` cuántos
 *   tickets son; el mínimo se mide en tickets (sin `activos`, se usa `cargaActual`).
 *
 * @param {Array<{id: string, area_designada?: string, estado_operativo?: string, cargaActual: number, activos?: number}>} operators
 * @param {{ratio?: number, minimo?: number}} [opciones] umbrales (por defecto 1.5× y 3 activos)
 * @returns {Map<string, {comparable: boolean, promedioArea: number|null, indiceCarga: number|null, sobrecarga: boolean}>}
 */
function computeOverload(operators, { ratio = OVERLOAD_RATIO, minimo = OVERLOAD_MIN_ACTIVE } = {}) {
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
            const activos = operator.activos ?? load;
            const index = average > 0 ? load / average : 0;
            result.set(operator.id, {
                comparable: true,
                promedioArea: Math.round(average * 100) / 100,
                indiceCarga: Math.round(index * 100) / 100,
                sobrecarga: activos >= minimo && index > ratio
            });
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// Periodos de reporte (spec §8) y tiempo en horario (spec §6.2)
// ---------------------------------------------------------------------------

const PERIODS = ['jornada', 'semana', 'mes', 'especifica'];

// Horario de turno normal (spec §3). Mientras el horario no se guarde por
// operador, "tiempo en horario" cuenta lunes a viernes de 8:00 a 17:00 Caracas.
const BUSINESS_START_HOUR = 8;
const BUSINESS_END_HOUR = 17;
const BUSINESS_DAYS = [1, 2, 3, 4, 5]; // 0 = domingo

/** Convierte 'YYYY-MM-DD' (fecha de Caracas) en el instante de su medianoche; null si no es válida. */
function parseCaracasDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;
    const [, y, m, d] = match.map(Number);
    const utc = Date.UTC(y, m - 1, d);
    const check = new Date(utc);
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
    return new Date(utc - UTC_OFFSET_HOURS * HOUR_MS);
}

function formatCaracasDate(instant) {
    const local = new Date(new Date(instant).getTime() + UTC_OFFSET_HOURS * HOUR_MS);
    return local.toISOString().slice(0, 10);
}

/**
 * Rango [start, end) de un periodo alrededor de una fecha de Caracas.
 *  - jornada / especifica: el día completo (00:00 a 23:59).
 *  - semana: de lunes a domingo.
 *  - mes: del día 1 al último día.
 * `fecha` ('YYYY-MM-DD') es opcional; sin ella se usa `now`.
 * Devuelve { periodo, start, end, desde, hasta, etiqueta } o null si algo no es válido.
 */
function getPeriodBounds(periodo, fecha, now = new Date()) {
    if (!PERIODS.includes(periodo)) return null;
    let dayStart;
    if (fecha) {
        dayStart = parseCaracasDate(fecha);
        if (!dayStart) return null;
    } else {
        dayStart = getDayBounds(now).start;
    }
    let start = dayStart;
    let end = new Date(dayStart.getTime() + DAY_MS);

    if (periodo === 'semana') {
        const local = new Date(dayStart.getTime() + UTC_OFFSET_HOURS * HOUR_MS);
        const diasDesdeLunes = (local.getUTCDay() + 6) % 7;
        start = new Date(dayStart.getTime() - diasDesdeLunes * DAY_MS);
        end = new Date(start.getTime() + 7 * DAY_MS);
    } else if (periodo === 'mes') {
        const local = new Date(dayStart.getTime() + UTC_OFFSET_HOURS * HOUR_MS);
        const y = local.getUTCFullYear();
        const m = local.getUTCMonth();
        start = new Date(Date.UTC(y, m, 1) - UTC_OFFSET_HOURS * HOUR_MS);
        end = new Date(Date.UTC(y, m + 1, 1) - UTC_OFFSET_HOURS * HOUR_MS);
    }
    const desde = formatCaracasDate(start);
    const hasta = formatCaracasDate(new Date(end.getTime() - 1));
    const etiqueta = desde === hasta ? desde : `${desde} a ${hasta}`;
    return { periodo, start, end, desde, hasta, etiqueta };
}

/**
 * Minutos entre dos instantes que caen dentro del horario de turno
 * (lunes a viernes, 8:00 a 17:00 Caracas). Devuelve 0 si el orden es inválido.
 */
function businessMinutesBetween(from, to) {
    const a = new Date(from).getTime();
    const b = new Date(to).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
    let total = 0;
    let dayStart = getDayBounds(new Date(a)).start.getTime();
    while (dayStart < b) {
        const local = new Date(dayStart + UTC_OFFSET_HOURS * HOUR_MS);
        if (BUSINESS_DAYS.includes(local.getUTCDay())) {
            const winStart = dayStart + BUSINESS_START_HOUR * HOUR_MS;
            const winEnd = dayStart + BUSINESS_END_HOUR * HOUR_MS;
            const overlap = Math.min(b, winEnd) - Math.max(a, winStart);
            if (overlap > 0) total += overlap;
        }
        dayStart += DAY_MS;
    }
    return total / MINUTE_MS;
}

/** Tiempo en horario de un ticket resuelto (null si faltan fechas). */
function getBusinessResolutionMinutes(ticket) {
    const end = getClosingDate(ticket);
    if (!end || !ticket?.createdAt) return null;
    if (new Date(end).getTime() < new Date(ticket.createdAt).getTime()) return null;
    return businessMinutesBetween(ticket.createdAt, end);
}

/** Promedio del tiempo en horario; null si no hay tickets. */
function averageBusinessMinutes(tickets) {
    const values = (tickets || []).map(getBusinessResolutionMinutes).filter(v => v !== null);
    if (values.length === 0) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

module.exports = {
    PERIODS,
    parseCaracasDate,
    formatCaracasDate,
    getPeriodBounds,
    businessMinutesBetween,
    getBusinessResolutionMinutes,
    averageBusinessMinutes,
    UTC_OFFSET_HOURS,
    ACTIVE_STATES,
    OVERLOAD_RATIO,
    OVERLOAD_MIN_ACTIVE,
    pesoCarga,
    puntosActivos,
    getDayBounds,
    getHourOfDay,
    getClosingDate,
    getResolutionMinutes,
    averageResolutionMinutes,
    formatMinutes,
    computeOverload
};
