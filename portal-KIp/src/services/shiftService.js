'use strict';

/**
 * Turnos y guardias (spec §3). Funciones puras, sin base de datos.
 *
 * - Turno normal: por defecto lunes a viernes de 8:00 a 17:00 (Caracas); cada
 *   operador puede tener su propio horario.
 * - Guardia: la define el coordinador por semana (lunes a domingo). El operador
 *   de guardia NO aparece como "Disponible" en la jornada normal: aparece como
 *   "De guardia" (o "En casa de guardia" los fines de semana, que trabaja remoto).
 *   Puede recibir tickets igualmente.
 */

const { UTC_OFFSET_HOURS, getPeriodBounds } = require('./metricsService');

const HOUR_MS = 3600000;

const DEFAULT_SCHEDULE = { dias: [1, 2, 3, 4, 5], inicio: '08:00', fin: '17:00' };

// Ventana de guardia (confirmada por el usuario): entre semana de
// 17:00 a 00:00; en fin de semana el guardia cubre de 8:00 a 00:00 desde casa.
const GUARDIA_WEEKDAY = { inicio: '17:00', fin: '24:00' };
const GUARDIA_WEEKEND = { inicio: '08:00', fin: '24:00' };

const STATUS = {
    EN_TURNO: 'En turno',
    DE_GUARDIA: 'De guardia',
    EN_CASA_GUARDIA: 'En casa de guardia',
    FUERA_DE_TURNO: 'Fuera de turno',
    AUSENTE: 'Ausente'
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMinutes(hhmm) {
    if (hhmm === '24:00') return 24 * 60;
    const m = TIME_RE.exec(hhmm || '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Valida y normaliza un horario { dias, inicio, fin }. Devuelve { error } o { horario }. */
function validateSchedule(input) {
    const dias = input && input.dias;
    if (!Array.isArray(dias) || dias.length === 0 || dias.some(d => !Number.isInteger(d) || d < 0 || d > 6)) {
        return { error: 'Los días deben ser una lista de números del 0 (domingo) al 6 (sábado)' };
    }
    const inicio = input.inicio;
    const fin = input.fin;
    if (!TIME_RE.test(inicio || '') || !TIME_RE.test(fin || '')) return { error: 'La hora debe tener formato HH:MM' };
    if (toMinutes(inicio) >= toMinutes(fin)) return { error: 'La hora de inicio debe ser anterior a la de fin' };
    return { horario: { dias: [...new Set(dias)].sort((a, b) => a - b), inicio, fin } };
}

/** Día de la semana (0 = domingo) y minutos desde medianoche en Caracas. */
function caracasClock(now) {
    const local = new Date(new Date(now).getTime() + UTC_OFFSET_HOURS * HOUR_MS);
    return { dow: local.getUTCDay(), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/** Inicio (lunes 00:00 Caracas) de la semana que contiene `reference`. */
function getWeekStart(reference = new Date()) {
    return getPeriodBounds('semana', null, reference).start;
}

const within = (minutes, win) => minutes >= toMinutes(win.inicio) && minutes < toMinutes(win.fin);

/**
 * Estado de turno de un operador en un instante.
 * @param {object} p
 * @param {string} p.estadoOperativo  DISPONIBLE | EN_TERRENO | AUSENTE (lo marca el propio operador)
 * @param {object} [p.horario]        { dias, inicio, fin }; por defecto lunes a viernes 8-17
 * @param {boolean} [p.deGuardia]     ¿está de guardia esta semana?
 * @returns {{ codigo, etiqueta, enTurno, deGuardia, disponible }}
 */
function getShiftStatus({ estadoOperativo, horario, deGuardia = false }, now = new Date()) {
    const out = (codigo, flags = {}) => ({
        codigo, etiqueta: STATUS[codigo], enTurno: false, deGuardia: Boolean(deGuardia), disponible: false, ...flags
    });
    if (estadoOperativo === 'AUSENTE') return out('AUSENTE');

    const { dow, minutes } = caracasClock(now);
    const schedule = horario && Array.isArray(horario.dias) ? horario : DEFAULT_SCHEDULE;
    const inNormalShift = schedule.dias.includes(dow) && within(minutes, { inicio: schedule.inicio, fin: schedule.fin });

    if (deGuardia) {
        const weekend = dow === 0 || dow === 6;
        const guardiaWindow = weekend ? GUARDIA_WEEKEND : GUARDIA_WEEKDAY;
        if (weekend && within(minutes, guardiaWindow)) return out('EN_CASA_GUARDIA', { enTurno: true });
        if (inNormalShift || within(minutes, guardiaWindow)) return out('DE_GUARDIA', { enTurno: true });
        return out('FUERA_DE_TURNO');
    }
    if (inNormalShift) return out('EN_TURNO', { enTurno: true, disponible: estadoOperativo === 'DISPONIBLE' });
    return out('FUERA_DE_TURNO');
}

module.exports = {
    DEFAULT_SCHEDULE, GUARDIA_WEEKDAY, GUARDIA_WEEKEND, STATUS,
    validateSchedule, getShiftStatus, getWeekStart, caracasClock
};
