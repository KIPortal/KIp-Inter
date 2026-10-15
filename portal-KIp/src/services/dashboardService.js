'use strict';

/**
 * Dashboard General del coordinador (IMPLEMENTACION.md §3.1). Funciones puras:
 * reciben los tickets y operadores ya cargados y devuelven lo que dibuja la
 * vista. No consultan la base de datos (ver scripts/test-dashboard.js).
 */

const {
    ACTIVE_STATES,
    UTC_OFFSET_HOURS,
    getDayBounds,
    getHourOfDay,
    getClosingDate,
    getResolutionMinutes,
    getPeriodBounds,
    computeOverload
} = require('./metricsService');
const { AREA_NAMES } = require('./periodReportService');
const { DEFAULT_RULES, ageLimitFor, overloadOptions } = require('./rulesService');
const { buildSuggestions, normalizeOperator } = require('./assignmentService');
const { ESTADOS_VE } = require('./estadosVeService');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

// Jornada normal (Caracas) para el anillo de "Estado del turno"
const JORNADA = { inicio: 8, fin: 17 };

// Antigüedad por defecto (minutos) según puntos; las reglas vigentes vienen de rulesService.
const AGE_LIMIT_MINUTES = { 8: DEFAULT_RULES.antiguedad.P1, 5: DEFAULT_RULES.antiguedad.P2, 1: DEFAULT_RULES.antiguedad.P3, 0: DEFAULT_RULES.antiguedad.SP };

const PRIORITY_LABEL = { 8: 'P1', 5: 'P2', 1: 'P3', 0: 'Sin prioridad' };

const time = value => (value ? new Date(value).getTime() : NaN);
const inRange = (value, range) => {
    const t = time(value);
    return Number.isFinite(t) && t >= range.start.getTime() && t < range.end.getTime();
};
const round1 = n => Math.round(n * 10) / 10;

function initials(nombre) {
    return String(nombre || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';
}

/** "45 min", "1 h 12" o "3 h". */
function formatAge(minutes) {
    const m = Math.max(0, Math.round(minutes));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${h} h ${String(rest).padStart(2, '0')}` : `${h} h`;
}

/** Grupo de turno para la tarjeta "Estado del turno". */
function shiftGroup(turno) {
    const codigo = turno?.codigo;
    if (codigo === 'DE_GUARDIA' || codigo === 'EN_CASA_GUARDIA') return 'guardia';
    if (codigo === 'EN_TURNO') return 'turno';
    return 'fuera';
}

/**
 * Tickets sin asignar, o asignados pero sin movimiento, que superan la
 * antigüedad máxima de su prioridad. En pausa o en espera de terceros no
 * cuentan: están detenidos a propósito.
 */
function agingTickets(tickets, now, rules = DEFAULT_RULES) {
    if (!rules.antiguedad.activa) return [];
    const nowMs = time(now);
    const out = [];
    for (const t of tickets) {
        if (!['NUEVO', 'EN_PROGRESO'].includes(t.estado_actual)) continue;
        const puntos = AGE_LIMIT_MINUTES[t.puntos_complejidad] !== undefined ? t.puntos_complejidad : 0;
        const limite = ageLimitFor(puntos, rules);
        const sinAsignar = !t.asignado_a_id;
        const desde = sinAsignar
            ? time(t.createdAt)
            : Math.max(time(t.updatedAt) || 0, time(t.fecha_asignacion) || 0, time(t.createdAt) || 0);
        if (!Number.isFinite(desde) || desde <= 0) continue;
        const minutos = (nowMs - desde) / MINUTE_MS;
        if (minutos > limite) {
            out.push({ codigo: t.codigo_incidencia, prioridad: PRIORITY_LABEL[puntos], puntos, sinAsignar, minutos, limite });
        }
    }
    // Primero los de mayor prioridad y, dentro, los más atrasados
    return out.sort((a, b) => (b.puntos - a.puntos) || ((b.minutos / b.limite) - (a.minutos / a.limite)));
}

/** Avance de la jornada 08:00–17:00 de hoy (Caracas). */
function jornadaStatus(now) {
    const local = new Date(time(now) + UTC_OFFSET_HOURS * HOUR_MS);
    const dow = local.getUTCDay();
    const minutos = local.getUTCHours() * 60 + local.getUTCMinutes();
    const ini = JORNADA.inicio * 60;
    const fin = JORNADA.fin * 60;
    const finDeSemana = dow === 0 || dow === 6;
    let porcentaje;
    let detalle;
    if (finDeSemana) {
        porcentaje = 0;
        detalle = 'Fin de semana · guardia desde casa';
    } else if (minutos < ini) {
        porcentaje = 0;
        detalle = `Empieza en ${formatAge(ini - minutos)}`;
    } else if (minutos >= fin) {
        porcentaje = 100;
        detalle = 'Jornada terminada';
    } else {
        porcentaje = Math.round((minutos - ini) / (fin - ini) * 100);
        detalle = `Faltan ${formatAge(fin - minutos)}`;
    }
    return { porcentaje, detalle, horario: '08:00 – 17:00', finDeSemana };
}

/**
 * Distribución territorial: cantidad de tickets activos por estado de
 * Venezuela (para evaluar la carga por estado). Los tickets sin estado no entran al mapa (se cuentan aparte).
 * @returns {{ estados: object, ranking: Array, totalActivos: number, sinEstado: number, resumen: string }}
 */
function buildTerritorialMap(activos) {
    const estados = {};
    for (const [codigo, nombre] of Object.entries(ESTADOS_VE)) estados[codigo] = { codigo, nombre, activos: 0, porcentaje: 0 };
    let sinEstado = 0;
    for (const t of activos) {
        if (estados[t.estado_ve]) estados[t.estado_ve].activos += 1;
        else sinEstado += 1;
    }
    const totalActivos = Object.values(estados).reduce((a, e) => a + e.activos, 0);
    Object.values(estados).forEach(e => { e.porcentaje = totalActivos ? Math.round(e.activos / totalActivos * 100) : 0; });
    const ranking = Object.values(estados).filter(e => e.activos > 0)
        .sort((a, b) => (b.activos - a.activos) || a.nombre.localeCompare(b.nombre, 'es'));
    return {
        estados,
        ranking: ranking.slice(0, 7),
        totalActivos,
        sinEstado,
        resumen: ranking.length
            ? 'Más incidencias: ' + ranking.slice(0, 3).map(e => `${e.nombre} ${e.activos}`).join(' · ')
            : 'Ningún ticket activo tiene estado asignado'
    };
}

/**
 * @param {object} p
 * @param {Array} p.tickets     tickets no eliminados (con asignado_a_id, puntos_complejidad, fechas)
 * @param {Array} p.operators   operadores con { id, nombre, area_designada, estado_operativo, turno, tickets_asignados }
 * @param {Date}  [p.now]
 * @param {string} [p.periodo]  'jornada' (hoy) o 'semana' (lunes a domingo); afecta resueltos, resolución y ranking
 * @param {object} [p.rules]    reglas de rulesService (antigüedad, sobrecarga, sugerencia)
 */
function buildCoordinatorPanel({ tickets = [], operators = [], now = new Date(), periodo = 'jornada', rules = DEFAULT_RULES } = {}) {
    const periodoValido = periodo === 'semana' ? 'semana' : 'jornada';
    const hoy = getDayBounds(now);
    const rango = getPeriodBounds(periodoValido, null, now);
    const nowMs = time(now);

    const activos = tickets.filter(t => ACTIVE_STATES.includes(t.estado_actual));
    const creadosHoy = tickets.filter(t => inRange(t.createdAt, hoy));
    const creados24h = tickets.filter(t => {
        const c = time(t.createdAt);
        return Number.isFinite(c) && c > nowMs - 24 * HOUR_MS && c <= nowMs;
    });
    const resueltosEn = range => tickets.filter(t =>
        ['RESUELTO', 'CERRADO'].includes(t.estado_actual) && inRange(getClosingDate(t), range));
    const resueltosHoy = resueltosEn(hoy);
    const resueltosPeriodo = resueltosEn(rango);

    // Críticos sin asignar: misma regla que el contador anterior (P1 y P2, sin cerrar)
    const criticos = tickets
        .filter(t => !t.asignado_a_id && t.estado_actual !== 'CERRADO' && (t.puntos_complejidad || 0) >= 5)
        .sort((a, b) => time(a.createdAt) - time(b.createdAt));
    const masAntiguo = criticos[0];

    const kpis = {
        activos: activos.length,
        sinAsignar: activos.filter(t => !t.asignado_a_id).length,
        creadosHoy: creadosHoy.length,
        creados24h: creados24h.length,
        resueltosHoy: resueltosHoy.length,
        pendientesCierre: tickets.filter(t => t.estado_actual === 'RESUELTO').length,
        criticosSinAsignar: criticos.length,
        criticoMasAntiguo: masAntiguo
            ? { codigo: masAntiguo.codigo_incidencia, edad: formatAge((nowMs - time(masAntiguo.createdAt)) / MINUTE_MS) }
            : null
    };

    // ----- Sobrecarga e índice de carga (spec: 1.5× el promedio del área, mínimo 3)
    const carga = new Map(operators.map(o => [o.id, (o.tickets_asignados || []).length]));
    const overload = computeOverload(operators.map(o => ({
        id: o.id, area_designada: o.area_designada, estado_operativo: o.estado_operativo, cargaActual: carga.get(o.id)
    })), overloadOptions(rules));

    // ----- Cola de espera: sin asignar y nadie disponible en su área (§4)
    const sugerencias = buildSuggestions({
        operadores: operators.map(o => normalizeOperator(o, carga.get(o.id) || 0, overload.get(o.id)?.sobrecarga)),
        areas: [...new Set([...Object.keys(AREA_NAMES), ...tickets.map(t => t.area_designada || 'GENERAL')])],
        tickets,
        now,
        rules
    });
    kpis.enCola = sugerencias.enCola.length;

    // ----- Resueltos del periodo por operador
    const porOperador = new Map();
    for (const t of resueltosPeriodo) {
        if (!t.asignado_a_id) continue;
        const acc = porOperador.get(t.asignado_a_id) || { resueltos: 0, puntos: 0, p1: 0, p2: 0, p3: 0, tickets: [] };
        const pts = t.puntos_complejidad || 0;
        acc.resueltos += 1;
        acc.puntos += pts;
        if (pts === 8) acc.p1 += 1;
        else if (pts === 5) acc.p2 += 1;
        else if (pts === 1) acc.p3 += 1;
        acc.tickets.push(t);
        porOperador.set(t.asignado_a_id, acc);
    }
    const avgHours = list => {
        const mins = list.map(getResolutionMinutes).filter(m => m !== null);
        return mins.length ? round1(mins.reduce((a, b) => a + b, 0) / mins.length / 60) : null;
    };

    const operadores = operators.map(o => {
        const r = porOperador.get(o.id) || { resueltos: 0, puntos: 0, p1: 0, p2: 0, p3: 0, tickets: [] };
        const ov = overload.get(o.id) || {};
        return {
            id: o.id,
            nombre: o.nombre,
            iniciales: initials(o.nombre),
            area: o.area_designada || 'GENERAL',
            areaNombre: AREA_NAMES[o.area_designada] || o.area_designada || 'General',
            estado: { grupo: shiftGroup(o.turno), etiqueta: o.turno?.etiqueta || 'Fuera de turno' },
            carga: carga.get(o.id) || 0,
            resueltos: r.resueltos,
            puntos: r.puntos,
            p1: r.p1, p2: r.p2, p3: r.p3,
            promedioHoras: avgHours(r.tickets),
            indiceCarga: ov.indiceCarga ?? null,
            sobrecarga: Boolean(ov.sobrecarga)
        };
    });

    // ----- Carga por área: saturación = puntos abiertos ÷ capacidad de quienes están en turno.
    // Capacidad = personas en turno o de guardia (no ausentes) × puntos por persona (Reglas).
    // Un ticket sin prioridad pesa como P3: es trabajo aunque aún no tenga puntos.
    const puntosPorPersona = (rules.capacidad || DEFAULT_RULES.capacidad).puntosPorPersona;
    const pesoTicket = t => (t.puntos_complejidad > 0 ? t.puntos_complejidad : 1);
    const areaCodes = new Set([
        ...tickets.filter(t => ACTIVE_STATES.includes(t.estado_actual) || inRange(t.createdAt, hoy)).map(t => t.area_designada || 'GENERAL'),
        ...operators.map(o => o.area_designada || 'GENERAL')
    ]);
    const areas = [...areaCodes].map(codigo => {
        const deArea = t => (t.area_designada || 'GENERAL') === codigo;
        const abiertos = activos.filter(deArea);
        const recibidosHoy = creadosHoy.filter(deArea).length;
        const arrastrados = abiertos.filter(t => !inRange(t.createdAt, hoy)).length;
        const total = recibidosHoy + arrastrados;
        const resueltosArea = resueltosPeriodo.filter(deArea);
        const ops = operadores.filter(o => o.area === codigo);
        const personas = operators.filter(o => (o.area_designada || 'GENERAL') === codigo
            && o.estado_operativo !== 'AUSENTE' && shiftGroup(o.turno) !== 'fuera').length;
        const puntos = abiertos.reduce((acc, t) => acc + pesoTicket(t), 0);
        const capacidad = personas * puntosPorPersona;
        return {
            codigo,
            nombre: AREA_NAMES[codigo] || codigo,
            abiertos: abiertos.length,
            sinAsignar: abiertos.filter(t => !t.asignado_a_id).length,
            total,
            puntos,
            personas,
            capacidad,
            // Sin nadie en turno, cualquier abierto satura el área
            porcentaje: capacidad ? Math.round(puntos / capacidad * 100) : (puntos ? 100 : 0),
            resueltos: resueltosArea.length,
            promedioHoras: avgHours(resueltosArea),
            operadores: ops
        };
    }).sort((a, b) => (b.porcentaje - a.porcentaje) || (b.abiertos - a.abiertos) || a.nombre.localeCompare(b.nombre));

    const resolucion = {
        promedioHoras: avgHours(resueltosPeriodo),
        areas: areas.filter(a => a.promedioHoras !== null)
            .map(a => ({ codigo: a.codigo, nombre: a.nombre, horas: a.promedioHoras }))
            .sort((a, b) => b.horas - a.horas)
    };

    // ----- Alertas: cola de espera, sobrecarga y antigüedad
    const alertas = [];
    if (sugerencias.enCola.length) {
        const enCola = tickets.filter(t => sugerencias.enCola.includes(t.codigo_incidencia));
        const areasCola = [...new Set(enCola.map(t => AREA_NAMES[t.area_designada] || t.area_designada))];
        const codigos = enCola.slice(0, 2).map(t => t.codigo_incidencia).join(' y ') + (enCola.length > 2 ? ` y ${enCola.length - 2} más` : '');
        alertas.push({
            tipo: 'cola',
            titulo: `En cola de espera · ${enCola.length} ${enCola.length === 1 ? 'ticket' : 'tickets'}`,
            detalle: `${codigos} · nadie disponible en`,
            valor: areasCola.join(', '),
            nivel: 'rojo'
        });
    }
    operadores.filter(o => o.sobrecarga).sort((a, b) => b.indiceCarga - a.indiceCarga).forEach(o => {
        const ov = overload.get(o.id);
        alertas.push({
            tipo: 'sobrecarga',
            titulo: `${o.nombre} · sobrecarga`,
            detalle: `${o.carga} activos · promedio del área ${String(round1(ov.promedioArea)).replace('.', ',')} · índice`,
            valor: String(round1(ov.indiceCarga)).replace('.', ','),
            nivel: 'rojo'
        });
    });
    const atrasados = agingTickets(tickets, now, rules);
    atrasados.forEach(a => {
        alertas.push({
            tipo: 'antiguedad',
            titulo: `${a.codigo} · ${a.puntos ? a.prioridad + ' ' : 'sin prioridad, '}${a.sinAsignar ? 'sin asignar' : 'sin movimiento'}`,
            detalle: `${a.sinAsignar ? 'Sin asignar desde la llegada' : 'Sin movimiento desde hace'} ·`,
            valor: formatAge(a.minutos),
            nivel: a.puntos === 8 ? 'rojo' : 'ambar'
        });
    });

    // ----- Estado del turno
    const grupos = ['turno', 'guardia', 'fuera'].map(clave => ({
        clave,
        etiqueta: { turno: 'En turno', guardia: 'De guardia', fuera: 'Fuera de turno' }[clave],
        personas: operadores.filter(o => o.estado.grupo === clave)
            .map(o => ({ nombre: o.nombre, iniciales: o.iniciales, area: o.areaNombre }))
    }));

    // ----- Flujo por hora de hoy: creados, cerrados (resueltos) y asignados
    const flujo = { creados: new Array(24).fill(0), cerrados: new Array(24).fill(0), asignados: new Array(24).fill(0) };
    creadosHoy.forEach(t => { flujo.creados[getHourOfDay(t.createdAt)]++; });
    resueltosHoy.forEach(t => { flujo.cerrados[getHourOfDay(getClosingDate(t))]++; });
    tickets.forEach(t => { if (inRange(t.fecha_asignacion, hoy)) flujo.asignados[getHourOfDay(t.fecha_asignacion)]++; });
    flujo.horaActual = getHourOfDay(now);

    // ----- Ranking por puntos del periodo
    const ranking = operadores
        .filter(o => o.puntos > 0 || o.resueltos > 0)
        .sort((a, b) => (b.puntos - a.puntos) || (b.resueltos - a.resueltos) || a.nombre.localeCompare(b.nombre))
        .slice(0, 7);

    return {
        periodo: periodoValido,
        periodoEtiqueta: periodoValido === 'semana' ? 'Esta semana' : 'Hoy',
        kpis,
        areas,
        resolucion,
        alertas,
        turno: { jornada: jornadaStatus(now), grupos },
        flujo,
        ranking,
        mapa: buildTerritorialMap(activos)
    };
}

module.exports = { buildCoordinatorPanel, buildTerritorialMap, agingTickets, jornadaStatus, formatAge, AGE_LIMIT_MINUTES };
