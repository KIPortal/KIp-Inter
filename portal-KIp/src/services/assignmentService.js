'use strict';

/**
 * Asignación sugerida y cola de espera (IMPLEMENTACION.md §4). Funciones puras.
 *
 * - Solo se sugiere a quien está en turno y disponible.
 * - Los de guardia entran durante su guardia, o si su guardia empieza dentro
 *   de `sugerencia.guardiaAntesMin` minutos (30 por defecto).
 * - Nunca a quien está en sobrecarga. Entre los elegibles, el de menor carga.
 * - Si nadie es elegible, el ticket queda "en cola de espera" (se avisa al
 *   coordinador en el Dashboard) y se puede pedir sugerencia de otra área.
 * - Nunca se asigna solo: la sugerencia la confirma el coordinador.
 */

const { UTC_OFFSET_HOURS, ACTIVE_STATES } = require('./metricsService');
const { GUARDIA_WEEKDAY, GUARDIA_WEEKEND } = require('./shiftService');
const { DEFAULT_RULES } = require('./rulesService');

const HOUR_MS = 3600 * 1000;
const toMinutes = hhmm => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + m;
};

/** Ventana de guardia de hoy (Caracas) y minutos que faltan para que empiece. */
function guardWindow(now = new Date()) {
    const local = new Date(new Date(now).getTime() + UTC_OFFSET_HOURS * HOUR_MS);
    const dow = local.getUTCDay();
    const minutos = local.getUTCHours() * 60 + local.getUTCMinutes();
    const win = dow === 0 || dow === 6 ? GUARDIA_WEEKEND : GUARDIA_WEEKDAY;
    const inicio = toMinutes(win.inicio);
    const fin = toMinutes(win.fin);
    return { inicio: win.inicio, dentro: minutos >= inicio && minutos < fin, faltan: inicio - minutos };
}

/**
 * Forma común de un operador para sugerir, desde los operadores del controlador
 * (con `turno` y `deGuardia`) o desde las vistas ya calculadas.
 */
function normalizeOperator(o, carga, sobrecarga) {
    return {
        id: o.id,
        nombre: o.nombre,
        area: o.area_designada || o.area || 'GENERAL',
        carga: carga ?? o.carga ?? (o.tickets_asignados || []).length,
        sobrecarga: Boolean(sobrecarga ?? o.sobrecarga),
        deGuardia: Boolean(o.deGuardia ?? o.turno?.deGuardia),
        disponible: Boolean(o.disponible ?? o.turno?.disponible),
        ausente: (o.estado_operativo || '') === 'AUSENTE' || o.turno?.codigo === 'AUSENTE'
    };
}

/** ¿Se le puede sugerir un ticket ahora? Devuelve { elegible, motivo }. */
function eligibility(op, now = new Date(), rules = DEFAULT_RULES) {
    if (op.ausente) return { elegible: false, motivo: 'Ausente' };
    if (op.sobrecarga) return { elegible: false, motivo: 'Sobrecarga' };
    if (op.deGuardia) {
        const g = guardWindow(now);
        if (g.dentro) return { elegible: true, motivo: 'De guardia' };
        if (g.faltan > 0 && g.faltan <= rules.sugerencia.guardiaAntesMin) return { elegible: true, motivo: `Su guardia empieza en ${g.faltan} min` };
        return { elegible: false, motivo: `De guardia desde las ${g.inicio}` };
    }
    if (op.disponible) return { elegible: true, motivo: 'En turno' };
    return { elegible: false, motivo: 'No está disponible' };
}

const byLoad = (a, b) => (a.carga - b.carga) || a.nombre.localeCompare(b.nombre);

/**
 * Mejor operador para un área (o fuera de ella con `otraArea`).
 * @returns {{ id: string, motivo: string } | null}
 */
function suggest(operadores, area, now = new Date(), rules = DEFAULT_RULES, { otraArea = false } = {}) {
    const candidatos = operadores
        .filter(o => (otraArea ? o.area !== area : o.area === area))
        .map(o => ({ o, e: eligibility(o, now, rules) }))
        .filter(x => x.e.elegible)
        .sort((a, b) => byLoad(a.o, b.o));
    if (!candidatos.length) return null;
    const { o, e } = candidatos[0];
    return { id: o.id, motivo: `${e.motivo}, sin sobrecarga y con la menor carga${otraArea ? ' (otra área)' : ''}` };
}

/**
 * Sugerencias por área y cola de espera.
 * @param {Array} operadores  forma de normalizeOperator
 * @param {Array<string>} areas  códigos de área
 * @param {Array} tickets  con { codigo_incidencia, area_designada, estado_actual, asignado_a_id }
 * @returns {{ porArea: Object, otraArea: Object, enCola: Array<string> }}
 */
function buildSuggestions({ operadores = [], areas = [], tickets = [], now = new Date(), rules = DEFAULT_RULES } = {}) {
    const porArea = {};
    const otraArea = {};
    areas.forEach(area => {
        porArea[area] = suggest(operadores, area, now, rules);
        otraArea[area] = !porArea[area] && rules.sugerencia.permitirOtraArea
            ? suggest(operadores, area, now, rules, { otraArea: true })
            : null;
    });
    const enCola = tickets
        .filter(t => ACTIVE_STATES.includes(t.estado_actual) && !t.asignado_a_id && !porArea[t.area_designada || 'GENERAL'])
        .map(t => t.codigo_incidencia);
    return { porArea, otraArea, enCola };
}

module.exports = { guardWindow, normalizeOperator, eligibility, suggest, buildSuggestions };
