'use strict';

/**
 * Vista de Reportes (IMPLEMENTACION.md §3.5): arma lo que dibuja la pantalla a
 * partir de buildPeriodReport (el mismo reporte que se exporta a Excel).
 * Funciones puras (ver scripts/test-report-view.js).
 */

const { formatCaracasDate, parseCaracasDate } = require('./metricsService');
const { AREA_NAMES } = require('./periodReportService');

const DAY_MS = 24 * 3600 * 1000;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const ymd = iso => iso.split('-').map(Number);
const shiftDays = (iso, n) => formatCaracasDate(new Date(parseCaracasDate(iso).getTime() + n * DAY_MS));
function shiftMonth(iso, n) {
    const [y, m] = ymd(iso);
    const total = y * 12 + (m - 1) + n;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

/** Etiqueta corta del periodo: "Martes 13 oct", "12 – 18 oct 2026", "Octubre 2026". */
function periodLabel(periodo, desde, hasta) {
    const [y1, m1, d1] = ymd(desde);
    const [y2, m2, d2] = ymd(hasta);
    if (periodo === 'mes') return `${MESES[m1 - 1].charAt(0).toUpperCase()}${MESES[m1 - 1].slice(1)} ${y1}`;
    if (periodo === 'semana') {
        const ini = m1 === m2 ? `${d1}` : `${d1} ${MESES_CORTO[m1 - 1]}${y1 !== y2 ? ' ' + y1 : ''}`;
        return `${ini} – ${d2} ${MESES_CORTO[m2 - 1]} ${y2}`;
    }
    return `${d1} ${MESES_CORTO[m1 - 1]} ${y1}`;
}

/**
 * Navegación: periodo anterior y siguiente (no se avanza más allá de hoy).
 * Jornada y fecha específica se mueven de a un día; semana de a 7; mes de a uno.
 */
function navigation(periodo, desde, now = new Date()) {
    const hoy = formatCaracasDate(now);
    let anterior, siguiente;
    if (periodo === 'mes') { anterior = shiftMonth(desde, -1); siguiente = shiftMonth(desde, 1); }
    else if (periodo === 'semana') { anterior = shiftDays(desde, -7); siguiente = shiftDays(desde, 7); }
    else { anterior = shiftDays(desde, -1); siguiente = shiftDays(desde, 1); }
    return { anterior, siguiente: siguiente > hoy ? null : siguiente };
}

const pct = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : null);
const horas = min => (min === null || min === undefined ? null : Math.round((min / 60) * 10) / 10);

/**
 * @param {object} report  salida de buildPeriodReport
 * @param {object} q       { periodo, fecha, area }
 */
function buildReportView(report, { periodo, fecha = null, area = null, now = new Date() } = {}) {
    const r = report.resumen;
    const nav = navigation(periodo, r.desde, now);
    const areas = report.porArea.map(a => ({
        codigo: a.area,
        nombre: a.nombre,
        operadores: a.operadores,
        casos: a.creados,
        resueltos: a.resueltos,
        pct: pct(a.resueltos, a.creados),
        promedioHoras: horas(a.tiempoTotalMin),
        activos: a.activos,
        puntos: a.puntos,
        sobrecargados: a.sobrecargados,
        estadoCarga: a.estadoCarga
    }));
    const operadores = report.porOperador.map(o => ({
        id: o.id,
        nombre: o.nombre,
        iniciales: String(o.nombre || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join(''),
        area: o.area,
        areaNombre: o.areaNombre,
        casos: o.asignados,
        resueltos: o.resueltos,
        pct: pct(o.resueltos, o.asignados),
        promedioHoras: horas(o.tiempoTotalMin),
        puntos: o.puntos,
        p1: o.p1, p2: o.p2, p3: o.p3,
        activos: o.activos,
        indiceCarga: o.indiceCarga,
        sobrecarga: o.sobrecarga,
        estadoCarga: o.estadoCarga
    }));
    const maxCasos = Math.max(1, ...areas.map(a => a.casos));
    areas.forEach(a => { a.ancho = Math.round((a.casos / maxCasos) * 100); });

    const topResueltos = operadores.filter(o => o.resueltos > 0)
        .sort((a, b) => (b.resueltos - a.resueltos) || (b.puntos - a.puntos)).slice(0, 5);
    const topCarga = operadores.filter(o => o.indiceCarga !== null && o.activos > 0)
        .sort((a, b) => (b.indiceCarga - a.indiceCarga) || (b.activos - a.activos)).slice(0, 5);

    return {
        periodo,
        fecha,
        area,
        areaNombre: area ? AREA_NAMES[area] : null,
        rango: r.etiqueta,
        etiqueta: periodLabel(periodo, r.desde, r.hasta),
        nav,
        kpis: {
            casos: r.creados,
            resueltos: r.resueltos,
            pctResueltos: pct(r.resueltos, r.creados),
            promedioHoras: horas(r.tiempoTotalMin),
            promedioHorarioHoras: horas(r.tiempoHorarioMin),
            puntos: r.puntos,
            activos: r.activos,
            areasSobrecarga: areas.filter(a => a.sobrecargados > 0).length
        },
        areas,
        operadores,
        topResueltos,
        topCarga,
        lecturas: report.lecturas,
        flujo: report.flujoHorario.map(h => h.recibidos)
    };
}

module.exports = { buildReportView, navigation, periodLabel };
