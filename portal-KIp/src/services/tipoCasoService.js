'use strict';

/**
 * Tipos de caso (casos comunes) y su nivel de dificultad. Funciones puras: sin
 * base de datos (ver scripts/test-tipos-caso.js).
 *
 * Cada área tiene un catálogo de casos comunes (tabla TipoCaso) con un nivel de
 * dificultad del 1 (más sencillo) al 4 (muy complejo), un tiempo de resolución
 * estimado, la frecuencia con que se presenta y de quién depende. Los puntos de
 * un ticket salen de su nivel (N1=2, N2=4, N3=8, N4=10) y suman a la carga del
 * operador y del área; la prioridad (P1/P2/P3) ya no da puntos, solo marca la
 * urgencia y el orden de la cola.
 */

const { isActiveArea, isValidSubgrupo, AREA_NAMES, subgrupoName } = require('./areaCatalog');
const { getResolutionMinutes, formatMinutes } = require('./metricsService');

const NIVELES = Object.freeze([1, 2, 3, 4]);
const NIVEL_PUNTOS = Object.freeze({ 1: 2, 2: 4, 3: 8, 4: 10 });
const NIVEL_NOMBRE = Object.freeze({ 1: 'Sencillo', 2: 'Moderado', 3: 'Complejo', 4: 'Muy complejo' });
const FRECUENCIAS = Object.freeze(['ALTA', 'MEDIA', 'BAJA']);
// Prioridad (urgencia) que toma el ticket al clasificarse con este tipo, si aún no tiene
const PRIORIDADES_TIPO = Object.freeze(['P1', 'P2', 'P3']);
const FRECUENCIA_NOMBRE = Object.freeze({ ALTA: 'Alta', MEDIA: 'Media', BAJA: 'Baja' });
const LIMITES = Object.freeze({ nombre: [3, 120], minutos: [1, 7 * 24 * 60], dependencias: 200 });

const DAY_MS = 24 * 60 * 60 * 1000;

const esNivel = n => NIVELES.includes(n);
/** Puntos de carga de un nivel de dificultad (0 si no hay nivel). */
const puntosDeNivel = nivel => NIVEL_PUNTOS[nivel] || 0;
/** Nivel de un ticket (el guardado, o el de su tipo de caso); null si aún no se clasificó. */
const nivelDeTicket = t => (esNivel(t?.nivel) ? t.nivel : esNivel(t?.tipo_caso?.nivel) ? t.tipo_caso.nivel : null);

const texto = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/**
 * Valida un tipo de caso para crear (`parcial` false) o editar (`parcial` true).
 * Devuelve { data } con los campos de la tabla o { error }.
 */
function validarTipoCaso(body, { parcial = false } = {}) {
    const b = body && typeof body === 'object' ? body : {};
    const data = {};
    const has = k => b[k] !== undefined;

    if (!parcial || has('nombre')) {
        const nombre = texto(b.nombre);
        if (nombre.length < LIMITES.nombre[0] || nombre.length > LIMITES.nombre[1]) return { error: `El nombre debe tener entre ${LIMITES.nombre[0]} y ${LIMITES.nombre[1]} caracteres` };
        data.nombre = nombre;
    }
    if (!parcial || has('area')) {
        if (!isActiveArea(b.area)) return { error: 'Área no válida' };
        data.area_codigo = b.area;
    }
    if (has('subgrupo') || !parcial) {
        const sg = texto(b.subgrupo) || null;
        if (sg && !isValidSubgrupo(sg, b.area)) return { error: 'El subgrupo no es de esa área o está desactivado' };
        data.subgrupo_id = sg;
    }
    if (!parcial || has('nivel')) {
        const nivel = Number(b.nivel);
        if (!esNivel(nivel)) return { error: 'El nivel debe ser 1, 2, 3 o 4' };
        data.nivel = nivel;
    }
    if (has('minutos') || !parcial) {
        if (b.minutos === null || b.minutos === '' || b.minutos === undefined) data.minutos_estimados = null;
        else {
            const m = Number(b.minutos);
            if (!Number.isInteger(m) || m < LIMITES.minutos[0] || m > LIMITES.minutos[1]) return { error: 'El tiempo estimado debe ser un número entero de minutos (1 a 10080)' };
            data.minutos_estimados = m;
        }
    }
    if (has('frecuencia') || !parcial) {
        const f = texto(b.frecuencia).toUpperCase() || null;
        if (f && !FRECUENCIAS.includes(f)) return { error: 'La frecuencia debe ser Alta, Media o Baja' };
        data.frecuencia = f;
    }
    if (has('dependencias') || !parcial) {
        const d = texto(b.dependencias);
        if (d.length > LIMITES.dependencias) return { error: `Las dependencias no pueden superar ${LIMITES.dependencias} caracteres` };
        data.dependencias = d || null;
    }
    if (has('prioridad') || !parcial) {
        const p = texto(b.prioridad).toUpperCase() || null;
        if (p && !PRIORIDADES_TIPO.includes(p)) return { error: 'La prioridad debe ser P1, P2 o P3' };
        data.prioridad = p;
    }
    if (has('activo')) {
        if (typeof b.activo !== 'boolean') return { error: 'Valor de activo no válido' };
        data.activo = b.activo;
    }
    if (parcial && !Object.keys(data).length) return { error: 'No hay cambios para guardar' };
    return { data };
}

/** Tipo de caso como lo usan las vistas. */
function tipoCasoVista(t) {
    return {
        id: t.id,
        nombre: t.nombre,
        area: t.area_codigo,
        areaNombre: AREA_NAMES[t.area_codigo] || t.area_codigo,
        subgrupo: t.subgrupo_id || '',
        subgrupoNombre: subgrupoName(t.subgrupo_id),
        nivel: t.nivel,
        puntos: puntosDeNivel(t.nivel),
        minutos: t.minutos_estimados ?? null,
        frecuencia: t.frecuencia || '',
        dependencias: t.dependencias || '',
        prioridad: t.prioridad || '',
        activo: t.activo !== false
    };
}

/** Campos de tipo de caso de una fila de ticket (cola del coordinador y panel del operador). */
function tipoCasoDeTicket(t) {
    const nivel = nivelDeTicket(t);
    return {
        tipoCaso: t?.tipo_caso?.nombre || (nivel ? 'Otro' : ''),
        tipoCasoId: t?.tipo_caso_id || '',
        nivel,
        minutosEstimados: t?.tipo_caso?.minutos_estimados ?? null
    };
}

/**
 * Clasificación que llega al tomar o editar un ticket: { tipoCasoId } de un tipo
 * del catálogo, o { nivel } para "Otro" (caso que no está en el catálogo).
 * `tipo` es la fila de TipoCaso ya cargada (o null). Devuelve los campos del
 * ticket en { data: { tipo_caso_id, nivel, puntos_complejidad }, nombre, prioridad } o { error };
 * La prioridad es la del tipo (P1/P2/P3 o null) para el ticket que aún no tiene.
 */
function clasificar({ tipoCasoId, nivel, tipo, area }) {
    if (tipoCasoId) {
        if (!tipo || tipo.id !== tipoCasoId) return { error: 'Tipo de caso no encontrado' };
        if (tipo.activo === false) return { error: 'Ese tipo de caso está desactivado' };
        if (area && tipo.area_codigo !== area) return { error: 'Ese tipo de caso es de otra área' };
        return { data: { tipo_caso_id: tipo.id, nivel: tipo.nivel, puntos_complejidad: puntosDeNivel(tipo.nivel) }, nombre: tipo.nombre, prioridad: PRIORIDADES_TIPO.includes(tipo.prioridad) ? tipo.prioridad : null };
    }
    const n = Number(nivel);
    if (!esNivel(n)) return { error: 'Elige el tipo de caso, o "Otro" con su nivel (1 a 4)' };
    return { data: { tipo_caso_id: null, nivel: n, puntos_complejidad: puntosDeNivel(n) }, nombre: 'Otro', prioridad: null };
}

const inRange = (value, range) => {
    if (!value) return false;
    const t = new Date(value).getTime();
    return t >= range.start.getTime() && t < range.end.getTime();
};
const round1 = n => Math.round(n * 10) / 10;

/**
 * Casos comunes de un periodo: por tipo de caso, cuántas veces llegó (ocurrencia
 * y tasa por día), cuántos se resolvieron, sus puntos y el tiempo promedio real
 * (desde la llegada) frente al estimado del catálogo. Los "Otro" se agrupan por
 * área y nivel; los tickets sin clasificar se cuentan aparte.
 *
 * @param {Array}  p.tickets  tickets con createdAt, resueltoEn/fecha_cierre, nivel,
 *                            tipo_caso_id y tipo_caso { nombre, nivel, minutos_estimados, frecuencia }
 * @param {object} p.range    getPeriodBounds()
 */
function buildCasosComunes({ tickets, range }) {
    const dias = Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / DAY_MS));
    const llegados = (tickets || []).filter(t => inRange(t.createdAt, range));
    const grupos = new Map();
    let sinClasificar = 0;
    llegados.forEach(t => {
        const nivel = nivelDeTicket(t);
        if (!nivel) { sinClasificar++; return; }
        // Los "Otro" se agrupan por área y nivel (no son el mismo caso entre áreas)
        const clave = t.tipo_caso_id ? `t:${t.tipo_caso_id}` : `n:${t.area_designada}:${nivel}`;
        if (!grupos.has(clave)) {
            grupos.set(clave, {
                tipoId: t.tipo_caso_id || null,
                nombre: t.tipo_caso?.nombre || `Otro (nivel ${nivel})`,
                area: AREA_NAMES[t.area_designada] || t.area_designada || '',
                nivel,
                minutosEstimados: t.tipo_caso?.minutos_estimados ?? null,
                frecuencia: FRECUENCIA_NOMBRE[t.tipo_caso?.frecuencia] || '',
                tickets: []
            });
        }
        grupos.get(clave).tickets.push(t);
    });
    const clasificados = llegados.length - sinClasificar;
    const filas = [...grupos.values()].map(g => {
        const tiempos = g.tickets.map(getResolutionMinutes).filter(m => m !== null);
        const promedio = tiempos.length ? round1(tiempos.reduce((s, m) => s + m, 0) / tiempos.length) : null;
        return {
            tipoId: g.tipoId,
            nombre: g.nombre,
            area: g.area,
            nivel: g.nivel,
            puntosNivel: puntosDeNivel(g.nivel),
            ocurrencias: g.tickets.length,
            porDia: round1(g.tickets.length / dias),
            participacion: clasificados ? Math.round((g.tickets.length / clasificados) * 1000) / 1000 : 0,
            resueltos: tiempos.length,
            puntos: g.tickets.reduce((s, t) => s + (t.puntos_complejidad || 0), 0),
            frecuencia: g.frecuencia,
            minutosEstimados: g.minutosEstimados,
            estimado: g.minutosEstimados ? formatMinutes(g.minutosEstimados) : 'N/A',
            tiempoPromedioMin: promedio,
            tiempoPromedio: formatMinutes(promedio),
            sobreEstimado: Boolean(promedio !== null && g.minutosEstimados && promedio > g.minutosEstimados)
        };
    }).sort((a, b) => (b.ocurrencias - a.ocurrencias) || (b.nivel - a.nivel) || a.nombre.localeCompare(b.nombre));
    return { dias, recibidos: llegados.length, clasificados, sinClasificar, filas };
}

module.exports = {
    NIVELES, NIVEL_PUNTOS, NIVEL_NOMBRE, FRECUENCIAS, FRECUENCIA_NOMBRE, LIMITES,
    puntosDeNivel, nivelDeTicket, validarTipoCaso, tipoCasoVista, tipoCasoDeTicket, clasificar, buildCasosComunes
};
