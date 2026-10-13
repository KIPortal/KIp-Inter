'use strict';

/**
 * Configuración de Administración (IMPLEMENTACION.md §3.4): reglas, avisos y
 * plantillas. Funciones puras (por defecto, saneo y resumen de cambios) y una
 * carga desde la base que tolera que la tabla aún no exista.
 */

const { DEFAULT_RULES, mergeRules } = require('./rulesService');

// Avisos dentro del portal: evento → [coordinador, operadores del área, de guardia]
// null = no aplica a ese destinatario.
const EVENTOS = Object.freeze([
    { clave: 'p1', nombre: 'P1 nuevo', desc: 'Llega un ticket con prioridad P1' },
    { clave: 'cola', nombre: 'Ticket en cola de espera', desc: 'Nadie del área está disponible para atenderlo' },
    { clave: 'antiguedad', nombre: 'Antigüedad superada', desc: 'Un ticket pasa el tiempo de su prioridad' },
    { clave: 'sobrecarga', nombre: 'Sobrecarga', desc: 'Un operador supera la regla de sobrecarga' },
    { clave: 'traspaso', nombre: 'Traspaso a guardia', desc: 'El coordinador traspasa pendientes con su nota' }
]);
const DESTINATARIOS = Object.freeze(['Coordinador', 'Operadores del área', 'De guardia']);

const DEFAULT_AVISOS = Object.freeze({
    p1: [true, false, true],
    cola: [true, null, null],
    antiguedad: [true, true, null],
    sobrecarga: [true, false, null],
    traspaso: [null, null, true]
});

const DEFAULT_PLANTILLAS = Object.freeze({
    traspaso: ['Sin novedades pendientes', 'Quedan P1 abiertos, revisar primero', 'Esperando respuesta de proveedor', 'Vigilar enlaces con saturación'],
    cierre: ['Servicio restablecido', 'Resuelto por el operador', 'Falla del proveedor resuelta', 'Duplicado de otro ticket']
});

const MAX_PLANTILLAS = 12;
const MAX_TEXTO = 120;

function mergeAvisos(saved) {
    const s = saved && typeof saved === 'object' ? saved : {};
    const out = {};
    for (const ev of EVENTOS) {
        const base = DEFAULT_AVISOS[ev.clave];
        const fila = Array.isArray(s[ev.clave]) ? s[ev.clave] : [];
        // Las celdas que no aplican (null) no se pueden encender
        out[ev.clave] = base.map((def, i) => (def === null ? null : (typeof fila[i] === 'boolean' ? fila[i] : def)));
    }
    return out;
}

function cleanList(list, fallback) {
    if (!Array.isArray(list)) return [...fallback];
    const vistos = new Set();
    return list
        .filter(t => typeof t === 'string')
        .map(t => t.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO))
        .filter(t => t.length >= 3 && !vistos.has(t.toLowerCase()) && vistos.add(t.toLowerCase()))
        .slice(0, MAX_PLANTILLAS);
}

function mergePlantillas(saved) {
    const s = saved && typeof saved === 'object' ? saved : {};
    return {
        traspaso: cleanList(s.traspaso, DEFAULT_PLANTILLAS.traspaso),
        cierre: cleanList(s.cierre, DEFAULT_PLANTILLAS.cierre)
    };
}

/** Configuración completa y saneada a partir de lo guardado (o de nada). */
function mergeConfig(saved = {}) {
    return {
        reglas: mergeRules(saved.reglas),
        avisos: mergeAvisos(saved.avisos),
        plantillas: mergePlantillas(saved.plantillas)
    };
}

const fmtMin = m => (m < 60 ? `${m} min` : `${String(Math.round(m / 6) / 10).replace('.', ',')} h`);
const onOff = b => (b ? 'activada' : 'apagada');

/** Lista legible de lo que cambió, para Auditoría. */
function describeChanges(antes, despues) {
    const cambios = [];
    const ra = antes.reglas, rd = despues.reglas;
    if (ra.sobrecarga.activa !== rd.sobrecarga.activa) cambios.push(`Sobrecarga ${onOff(rd.sobrecarga.activa)}`);
    if (ra.sobrecarga.multiplicador !== rd.sobrecarga.multiplicador || ra.sobrecarga.minimo !== rd.sobrecarga.minimo) {
        cambios.push(`Sobrecarga: ${String(rd.sobrecarga.multiplicador).replace('.', ',')}× y mínimo ${rd.sobrecarga.minimo}`);
    }
    if (ra.antiguedad.activa !== rd.antiguedad.activa) cambios.push(`Antigüedad ${onOff(rd.antiguedad.activa)}`);
    ['P1', 'P2', 'P3', 'SP'].forEach(k => {
        if (ra.antiguedad[k] !== rd.antiguedad[k]) cambios.push(`Antigüedad ${k === 'SP' ? 'sin prioridad' : k}: ${fmtMin(rd.antiguedad[k])}`);
    });
    if (ra.sugerencia.incluirGuardia !== rd.sugerencia.incluirGuardia) cambios.push(`Guardia por entrar en la sugerencia: ${rd.sugerencia.incluirGuardia ? 'sí' : 'no'}`);
    if (ra.sugerencia.guardiaAntesMin !== rd.sugerencia.guardiaAntesMin) cambios.push(`Guardia por entrar: menos de ${fmtMin(rd.sugerencia.guardiaAntesMin)}`);
    if (ra.sugerencia.permitirOtraArea !== rd.sugerencia.permitirOtraArea) cambios.push(`Sugerir otra área: ${rd.sugerencia.permitirOtraArea ? 'sí' : 'no'}`);
    if (ra.metas.resueltoPct !== rd.metas.resueltoPct) cambios.push(`Meta de resueltos: ${rd.metas.resueltoPct} %`);
    if (ra.metas.promedioHoras !== rd.metas.promedioHoras) cambios.push(`Meta de promedio: ${String(rd.metas.promedioHoras).replace('.', ',')} h`);
    EVENTOS.forEach(ev => {
        despues.avisos[ev.clave].forEach((v, i) => {
            if (v !== null && v !== antes.avisos[ev.clave][i]) cambios.push(`Aviso «${ev.nombre}» a ${DESTINATARIOS[i].toLowerCase()}: ${v ? 'sí' : 'no'}`);
        });
    });
    ['traspaso', 'cierre'].forEach(tipo => {
        const a = antes.plantillas[tipo], d = despues.plantillas[tipo];
        if (JSON.stringify(a) !== JSON.stringify(d)) cambios.push(`Plantillas de ${tipo}: ${d.length}`);
    });
    return cambios;
}

/**
 * Vista previa de las reglas con los datos de hoy: quién quedaría en sobrecarga
 * y qué tickets superarían la antigüedad. Usa los mismos cálculos del portal.
 */
function previewRules({ operators = [], tickets = [], rules, now = new Date() }) {
    const { computeOverload } = require('./metricsService');
    const { agingTickets, formatAge } = require('./dashboardService');
    const { overloadOptions } = require('./rulesService');
    const { AREA_NAMES } = require('./periodReportService');
    const r = mergeRules(rules);
    const carga = o => (o.tickets_asignados || []).length;
    const ov = computeOverload(operators.map(o => ({ id: o.id, area_designada: o.area_designada, estado_operativo: o.estado_operativo, cargaActual: carga(o) })), overloadOptions(r));
    const sobrecarga = operators.filter(o => ov.get(o.id)?.sobrecarga).map(o => {
        const x = ov.get(o.id);
        return {
            nombre: o.nombre,
            area: AREA_NAMES[o.area_designada] || o.area_designada,
            carga: carga(o),
            promedio: Math.round(x.promedioArea * 10) / 10,
            indice: Math.round(x.indiceCarga * 10) / 10
        };
    });
    const antiguedad = agingTickets(tickets, now, r).map(a => ({
        codigo: a.codigo,
        prioridad: a.prioridad,
        detalle: `${formatAge(a.minutos)} ${a.sinAsignar ? 'sin asignar' : 'sin movimiento'}`
    }));
    return { sobrecarga, antiguedad };
}

/** Lee la configuración guardada; si la tabla no existe aún, usa los valores por defecto. */
async function loadConfig(prisma) {
    try {
        const filas = await prisma.configuracion.findMany();
        const saved = {};
        filas.forEach(f => { saved[f.clave] = f.valor; });
        return mergeConfig(saved);
    } catch (error) {
        console.error('Configuración no disponible (¿migración pendiente?):', error.message);
        return mergeConfig({});
    }
}

module.exports = {
    EVENTOS, DESTINATARIOS, DEFAULT_AVISOS, DEFAULT_PLANTILLAS, DEFAULT_RULES, MAX_PLANTILLAS, MAX_TEXTO,
    mergeConfig, mergeAvisos, mergePlantillas, describeChanges, loadConfig, previewRules
};
