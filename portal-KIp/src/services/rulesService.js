'use strict';

/**
 * Reglas de alerta y de asignación (IMPLEMENTACION.md §3.4 y §4). Hoy son los
 * valores acordados con el coordinador; la Fase 6 (Administración) las guarda
 * en la base y `mergeRules` combina lo guardado con estos valores por defecto.
 */

const DEFAULT_RULES = Object.freeze({
    // Sobrecarga: activos > multiplicador × promedio del área, con un mínimo de activos
    sobrecarga: Object.freeze({ multiplicador: 1.5, minimo: 3 }),
    // Antigüedad máxima (minutos) sin asignar o sin movimiento, por prioridad
    antiguedad: Object.freeze({ P1: 60, P2: 120, P3: 240, SP: 30 }),
    // Asignación sugerida
    sugerencia: Object.freeze({
        guardiaAntesMin: 30,     // los de guardia entran solo si su guardia empieza en menos de esto
        permitirOtraArea: true   // si nadie está disponible, se puede pedir sugerencia de otra área
    })
});

const POINTS_TO_KEY = { 8: 'P1', 5: 'P2', 1: 'P3' };

const positive = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);

/** Combina reglas guardadas (parciales o con datos inválidos) con las de por defecto. */
function mergeRules(saved) {
    const s = saved && typeof saved === 'object' ? saved : {};
    const d = DEFAULT_RULES;
    const sc = s.sobrecarga || {};
    const an = s.antiguedad || {};
    const su = s.sugerencia || {};
    return {
        sobrecarga: { multiplicador: positive(sc.multiplicador, d.sobrecarga.multiplicador), minimo: Math.round(positive(sc.minimo, d.sobrecarga.minimo)) },
        antiguedad: {
            P1: Math.round(positive(an.P1, d.antiguedad.P1)),
            P2: Math.round(positive(an.P2, d.antiguedad.P2)),
            P3: Math.round(positive(an.P3, d.antiguedad.P3)),
            SP: Math.round(positive(an.SP, d.antiguedad.SP))
        },
        sugerencia: {
            guardiaAntesMin: Math.round(positive(su.guardiaAntesMin, d.sugerencia.guardiaAntesMin)),
            permitirOtraArea: typeof su.permitirOtraArea === 'boolean' ? su.permitirOtraArea : d.sugerencia.permitirOtraArea
        }
    };
}

/** Minutos de antigüedad permitidos para unos puntos de prioridad. */
function ageLimitFor(points, rules = DEFAULT_RULES) {
    return rules.antiguedad[POINTS_TO_KEY[points] || 'SP'];
}

module.exports = { DEFAULT_RULES, mergeRules, ageLimitFor, POINTS_TO_KEY };
