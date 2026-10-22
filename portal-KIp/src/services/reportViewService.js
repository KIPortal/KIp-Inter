'use strict';

/**
 * Vista de Reportes (IMPLEMENTACION.md §3.5): arma lo que dibuja la pantalla a
 * partir de buildPeriodReport (el mismo reporte que se exporta a Excel).
 * Funciones puras (ver scripts/test-report-view.js).
 */

const { formatCaracasDate, parseCaracasDate, UTC_OFFSET_HOURS } = require('./metricsService');
const { AREA_NAMES } = require('./periodReportService');
const { DEFAULT_RULES } = require('./rulesService');

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

const diaCorto = iso => { const [, m, d] = ymd(iso); return `${d} ${MESES_CORTO[m - 1]}`; };
function horaCaracas(value) {
    const t = new Date(new Date(value).getTime() + UTC_OFFSET_HOURS * 3600000);
    return `${diaCorto(t.toISOString().slice(0, 10))} ${t.toISOString().slice(11, 16)}`;
}
const ORIGEN_TXT = { AUTOMATICO: 'cierre automático', MANUAL: 'cierre manual', RECUPERADO: 'recuperado al arrancar' };

/**
 * De dónde salen las cifras (registro de jornadas o en vivo) y qué puede hacer el
 * supervisor: guardar la jornada del día que mira o descargar su Excel guardado.
 * @param {object|null} fuente  chooseSource() + registro { fecha, cerradoEn, origen, tieneExcel }
 */
function sourceView(fuente, periodo, desde) {
    const f = fuente || { tipo: 'vivo', faltan: [], guardados: [], dias: 1, terminado: false, registro: null };
    const dia = periodo === 'jornada' ? desde : null;
    const reg = f.registro || null;
    let texto;
    if (f.tipo === 'registro') {
        texto = dia && reg
            ? `Registro del cierre · guardado ${horaCaracas(reg.cerradoEn)} (${ORIGEN_TXT[reg.origen] || 'cierre'})`
            : `Registro de ${f.dias} ${f.dias === 1 ? 'jornada' : 'jornadas'} guardadas`;
    } else if (f.faltan && f.faltan.length) {
        const lista = f.faltan.slice(0, 4).map(diaCorto).join(', ') + (f.faltan.length > 4 ? '…' : '');
        texto = `En vivo · ${f.faltan.length === 1 ? 'falta registrar' : `faltan ${f.faltan.length} días por registrar`}: ${lista}`;
    } else {
        texto = f.terminado ? 'En vivo' : `En vivo${f.guardados && f.guardados.length ? ` · ${f.guardados.length} de ${f.dias} días ya registrados` : ''}`;
    }
    return {
        tipo: f.tipo,
        texto,
        dia,
        guardado: Boolean(dia && reg),
        faltan: f.faltan || [],
        excel: dia && reg ? `/reportes/jornadas/${dia}/excel` : null
    };
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
function buildReportView(report, { periodo, fecha = null, area = null, now = new Date(), metas = DEFAULT_RULES.metas, fuente = report.fuente || null } = {}) {
    const r = report.resumen;
    const nav = navigation(periodo, r.desde, now);
    // Ámbar si no cumple la meta (Administración → Metas de Reportes)
    const bajoMeta = p => p !== null && p < metas.resueltoPct;
    const sobreMeta = h => h !== null && h > metas.promedioHoras;
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
    // Carga ahora: activos por operador, en escala relativa a la área más cargada.
    // El color sigue la regla de sobrecarga (no hay una capacidad fija por operador).
    areas.forEach(a => { a.porOperador = a.operadores > 0 ? a.activos / a.operadores : null; });
    const maxPorOperador = Math.max(0, ...areas.map(a => a.porOperador || 0));
    areas.forEach(a => {
        a.ancho = Math.round((a.casos / maxCasos) * 100);
        a.pctBajoMeta = bajoMeta(a.pct);
        a.promSobreMeta = sobreMeta(a.promedioHoras);
        a.cargaAncho = maxPorOperador > 0 && a.porOperador ? Math.round((a.porOperador / maxPorOperador) * 100) : 0;
        a.cargaTono = a.estadoCarga === 'Sobrecarga' ? 'red' : a.estadoCarga === 'Normal' ? 'blue' : 'gray';
    });
    operadores.forEach(o => {
        o.pctBajoMeta = bajoMeta(o.pct);
        o.promSobreMeta = sobreMeta(o.promedioHoras);
    });

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
            areasSobrecarga: areas.filter(a => a.sobrecargados > 0).length,
            pctBajoMeta: bajoMeta(pct(r.resueltos, r.creados)),
            promSobreMeta: sobreMeta(horas(r.tiempoTotalMin))
        },
        metas,
        fuente: sourceView(fuente, periodo, r.desde),
        areas,
        operadores,
        topResueltos,
        topCarga,
        lecturas: report.lecturas,
        flujo: report.flujoHorario.map(h => h.recibidos),
        casos: casosView(report.casosComunes)
    };
}

/** Casos comunes: barras relativas al tipo que más llegó y aviso si tarda más de lo estimado. */
function casosView(cc) {
    const c = cc || { dias: 1, recibidos: 0, clasificados: 0, sinClasificar: 0, filas: [] };
    const max = Math.max(1, ...c.filas.map(f => f.ocurrencias));
    return {
        dias: c.dias,
        recibidos: c.recibidos,
        clasificados: c.clasificados,
        sinClasificar: c.sinClasificar,
        filas: c.filas.map(f => ({
            ...f,
            ancho: Math.round((f.ocurrencias / max) * 100),
            pct: Math.round(f.participacion * 1000) / 10,
            promedioHoras: horas(f.tiempoPromedioMin),
            estimadoHoras: horas(f.minutosEstimados)
        }))
    };
}

module.exports = { buildReportView, navigation, periodLabel, sourceView };
