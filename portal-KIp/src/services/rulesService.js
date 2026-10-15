'use strict';

/**
 * Reglas de alerta y de asignación (IMPLEMENTACION.md §3.4 y §4). Los valores
 * por defecto son los acordados con el coordinador; Administración los guarda
 * en la tabla Configuracion (clave 'reglas') y `mergeRules` los combina.
 */

const DEFAULT_RULES = Object.freeze({
    // Sobrecarga: activos > multiplicador × promedio del área, con un mínimo de activos
    sobrecarga: Object.freeze({ activa: true, multiplicador: 1.5, minimo: 3 }),
    // Antigüedad máxima (minutos) sin asignar o sin movimiento, por prioridad
    antiguedad: Object.freeze({ activa: true, P1: 60, P2: 120, P3: 240, SP: 30 }),
    // Asignación sugerida
    sugerencia: Object.freeze({
        incluirGuardia: true,    // incluir a quien está por entrar de guardia…
        guardiaAntesMin: 30,     // …si su guardia empieza en menos de esto
        permitirOtraArea: true   // si nadie está disponible, se puede pedir sugerencia de otra área
    }),
    // Metas de Reportes: ámbar si el % resuelto queda por debajo o el promedio por encima
    metas: Object.freeze({ resueltoPct: 93, promedioHoras: 4 }),
    // Saturación por área: puntos abiertos que aguanta cada persona en turno (16 = dos P1)
    capacidad: Object.freeze({ puntosPorPersona: 16 }),
    // Prioridad sugerida a los tickets de correo: palabras clave del asunto, el cuerpo o el
    // remitente (p. ej. "@cliente.com"). Gana la prioridad más alta que coincida.
    palabrasPrioridad: Object.freeze({
        P1: Object.freeze(['caída', 'caido', 'corte', 'sin servicio', 'fuera de servicio', 'down', 'urgente']),
        P2: Object.freeze(['degradación', 'intermitencia', 'intermitente', 'lentitud', 'latencia', 'pérdida de paquetes']),
        P3: Object.freeze(['consulta', 'solicitud', 'información', 'reporte'])
    })
});

// Límites de los pasos que ofrece Administración
const LIMITS = Object.freeze({
    multiplicador: [1.1, 3],
    minimo: [1, 10],
    antiguedad: [5, 24 * 60],
    guardiaAntesMin: [5, 240],
    resueltoPct: [50, 100],
    promedioHoras: [0.5, 72],
    puntosPorPersona: [4, 80],
    palabras: 40,          // palabras clave por prioridad
    palabraLargo: 40       // caracteres por palabra clave
});

const PRIORIDADES = Object.freeze(['P1', 'P2', 'P3']);

const POINTS_TO_KEY = { 8: 'P1', 5: 'P2', 1: 'P3' };

function num(value, fallback, [min, max], decimals = 0) {
    const n = Number(value);
    if (value === null || value === '' || !Number.isFinite(n) || n <= 0) return fallback;
    const f = 10 ** decimals;
    return Math.min(max, Math.max(min, Math.round(n * f) / f));
}
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

/** Combina reglas guardadas (parciales o con datos inválidos) con las de por defecto. */
function mergeRules(saved) {
    const s = saved && typeof saved === 'object' ? saved : {};
    const d = DEFAULT_RULES;
    const sc = s.sobrecarga || {};
    const an = s.antiguedad || {};
    const su = s.sugerencia || {};
    const me = s.metas || {};
    const ca = s.capacidad || {};
    const pp = s.palabrasPrioridad && typeof s.palabrasPrioridad === 'object' ? s.palabrasPrioridad : {};
    return {
        sobrecarga: {
            activa: bool(sc.activa, d.sobrecarga.activa),
            multiplicador: num(sc.multiplicador, d.sobrecarga.multiplicador, LIMITS.multiplicador, 1),
            minimo: num(sc.minimo, d.sobrecarga.minimo, LIMITS.minimo)
        },
        antiguedad: {
            activa: bool(an.activa, d.antiguedad.activa),
            P1: num(an.P1, d.antiguedad.P1, LIMITS.antiguedad),
            P2: num(an.P2, d.antiguedad.P2, LIMITS.antiguedad),
            P3: num(an.P3, d.antiguedad.P3, LIMITS.antiguedad),
            SP: num(an.SP, d.antiguedad.SP, LIMITS.antiguedad)
        },
        sugerencia: {
            incluirGuardia: bool(su.incluirGuardia, d.sugerencia.incluirGuardia),
            guardiaAntesMin: num(su.guardiaAntesMin, d.sugerencia.guardiaAntesMin, LIMITS.guardiaAntesMin),
            permitirOtraArea: bool(su.permitirOtraArea, d.sugerencia.permitirOtraArea)
        },
        metas: {
            resueltoPct: num(me.resueltoPct, d.metas.resueltoPct, LIMITS.resueltoPct),
            promedioHoras: num(me.promedioHoras, d.metas.promedioHoras, LIMITS.promedioHoras, 1)
        },
        capacidad: {
            puntosPorPersona: num(ca.puntosPorPersona, d.capacidad.puntosPorPersona, LIMITS.puntosPorPersona)
        },
        palabrasPrioridad: Object.fromEntries(PRIORIDADES.map(k => [k, palabras(pp[k], d.palabrasPrioridad[k])]))
    };
}

/** Lista de palabras clave limpia (sin vacías ni repetidas); sin lista guardada, la de por defecto. */
function palabras(value, fallback) {
    if (!Array.isArray(value)) return [...fallback];
    const out = [];
    value.forEach(v => {
        const w = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, LIMITS.palabraLargo) : '';
        if (w && !out.some(x => normalizar(x) === normalizar(w))) out.push(w);
    });
    return out.slice(0, LIMITS.palabras);
}

const normalizar = texto => String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Prioridad sugerida para un texto (asunto + cuerpo + remitente de un correo).
 * Sin tildes ni mayúsculas, por palabra o frase completa; gana la más alta que coincida. null si ninguna coincide.
 */
function sugerirPrioridad(texto, rules = DEFAULT_RULES) {
    const t = normalizar(texto);
    if (!t) return null;
    const lista = (rules.palabrasPrioridad || DEFAULT_RULES.palabrasPrioridad);
    return PRIORIDADES.find(k => (lista[k] || []).some(w => {
        const n = normalizar(w);
        if (!n) return false;
        // Palabra o frase completa: "down" no coincide con "download"
        const i = t.indexOf(n);
        for (let j = i; j !== -1; j = t.indexOf(n, j + 1)) {
            const antes = j === 0 ? '' : t[j - 1];
            const despues = t[j + n.length] || '';
            const bordeIni = !/[a-z0-9]/.test(n[0]) || !/[a-z0-9]/.test(antes);
            const bordeFin = !/[a-z0-9]/.test(n[n.length - 1]) || !/[a-z0-9]/.test(despues);
            if (bordeIni && bordeFin) return true;
        }
        return false;
    })) || null;
}

/** Minutos de antigüedad permitidos para unos puntos de prioridad. */
function ageLimitFor(points, rules = DEFAULT_RULES) {
    return rules.antiguedad[POINTS_TO_KEY[points] || 'SP'];
}

/** Umbrales para computeOverload; con la alerta apagada nadie queda en sobrecarga. */
function overloadOptions(rules = DEFAULT_RULES) {
    return rules.sobrecarga.activa
        ? { ratio: rules.sobrecarga.multiplicador, minimo: rules.sobrecarga.minimo }
        : { ratio: Infinity, minimo: Infinity };
}

module.exports = { DEFAULT_RULES, LIMITS, PRIORIDADES, mergeRules, ageLimitFor, overloadOptions, sugerirPrioridad, POINTS_TO_KEY };
