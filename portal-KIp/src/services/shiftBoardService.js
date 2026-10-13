'use strict';

/**
 * Tablero de Gestión de Turno (IMPLEMENTACION.md §3.3). Función pura: recibe
 * operadores, horarios y guardias ya cargados y devuelve lo que dibuja la vista.
 * Sin base de datos (ver scripts/test-turno.js).
 */

const { formatCaracasDate, UTC_OFFSET_HOURS } = require('./metricsService');
const { getShiftStatus, getWeekStart, DEFAULT_SCHEDULE, GUARDIA_WEEKDAY, GUARDIA_WEEKEND } = require('./shiftService');
const { AREA_NAMES } = require('./periodReportService');

const DAY_MS = 24 * 3600 * 1000;
const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function initials(nombre) {
    return String(nombre || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';
}

/** Grupo visible del estado actual. */
function stateGroup(codigo) {
    if (codigo === 'EN_TURNO') return 'turno';
    if (codigo === 'DE_GUARDIA' || codigo === 'EN_CASA_GUARDIA') return 'guardia';
    return 'fuera';
}

/** Días de la semana elegida con la ventana de guardia de cada uno. */
function weekDays(weekStart, now = new Date()) {
    const hoy = formatCaracasDate(now);
    return Array.from({ length: 7 }, (_, i) => {
        const instante = new Date(new Date(weekStart).getTime() + i * DAY_MS);
        const iso = formatCaracasDate(instante);
        const local = new Date(instante.getTime() + UTC_OFFSET_HOURS * 3600 * 1000);
        const dow = local.getUTCDay();
        const finDeSemana = dow === 0 || dow === 6;
        const win = finDeSemana ? GUARDIA_WEEKEND : GUARDIA_WEEKDAY;
        return {
            fecha: iso,
            nombre: DIAS_CORTO[dow],
            numero: Number(iso.slice(8, 10)),
            horas: `${win.inicio}–${win.fin}`,
            tipo: finDeSemana ? 'Fin de semana · desde casa' : 'Entre semana',
            hoy: iso === hoy
        };
    });
}

/** "13 – 19 oct 2026" (o "29 sep – 5 oct 2026"). */
function weekLabel(weekStart) {
    const a = formatCaracasDate(weekStart);
    const b = formatCaracasDate(new Date(new Date(weekStart).getTime() + 6 * DAY_MS));
    const [ya, ma, da] = a.split('-').map(Number);
    const [yb, mb, db] = b.split('-').map(Number);
    const ini = ma === mb ? `${da}` : `${da} ${MESES[ma - 1]}${ya !== yb ? ' ' + ya : ''}`;
    return `${ini} – ${db} ${MESES[mb - 1]} ${yb}`;
}

/**
 * @param {object} p
 * @param {Array} p.operators          [{ id, nombre, email, area_designada, estado_operativo }]
 * @param {Map}   p.horarios           userId → { dias, hora_inicio, hora_fin }
 * @param {Set}   p.guardiaSemana      ids de guardia en la semana elegida
 * @param {Set}   p.guardiaActual      ids de guardia en la semana de hoy (para el estado actual)
 * @param {Date}  p.weekStart          lunes 00:00 Caracas de la semana elegida
 * @param {Date}  [p.now]
 */
function buildShiftBoard({ operators = [], horarios = new Map(), guardiaSemana = new Set(), guardiaActual = new Set(), weekStart, now = new Date() }) {
    const semana = weekStart || getWeekStart(now);
    const semanaActual = getWeekStart(now);

    const filas = operators.map(o => {
        const h = horarios.get(o.id);
        const horario = h ? { dias: h.dias, inicio: h.hora_inicio, fin: h.hora_fin } : { ...DEFAULT_SCHEDULE };
        const turno = getShiftStatus({ estadoOperativo: o.estado_operativo, horario, deGuardia: guardiaActual.has(o.id) }, now);
        return {
            id: o.id,
            nombre: o.nombre,
            email: o.email || '',
            iniciales: initials(o.nombre),
            area: o.area_designada || 'GENERAL',
            areaNombre: AREA_NAMES[o.area_designada] || o.area_designada || 'General',
            horario,
            horarioPersonalizado: Boolean(h),
            guardia: guardiaSemana.has(o.id),
            estado: { codigo: turno.codigo, etiqueta: turno.etiqueta, grupo: stateGroup(turno.codigo) }
        };
    }).sort((a, b) => a.nombre.localeCompare(b.nombre));

    const cuenta = g => filas.filter(f => f.estado.grupo === g).length;
    const areas = [...new Set(filas.map(f => f.area))]
        .map(codigo => ({ codigo, nombre: AREA_NAMES[codigo] || codigo }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre));

    return {
        semana: {
            inicio: formatCaracasDate(semana),
            anterior: formatCaracasDate(new Date(semana.getTime() - 7 * DAY_MS)),
            siguiente: formatCaracasDate(new Date(semana.getTime() + 7 * DAY_MS)),
            etiqueta: weekLabel(semana),
            esActual: semana.getTime() === semanaActual.getTime(),
            dias: weekDays(semana, now)
        },
        equipo: { total: filas.length, turno: cuenta('turno'), guardia: cuenta('guardia'), fuera: cuenta('fuera') },
        areas,
        operadores: filas
    };
}

module.exports = { buildShiftBoard, weekDays, weekLabel, stateGroup };
