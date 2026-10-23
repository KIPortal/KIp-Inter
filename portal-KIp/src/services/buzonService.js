'use strict';

/**
 * Buzones de correo (tabla Buzon). Funciones puras: sin base de datos ni Graph
 * (ver scripts/test-buzones.js).
 *
 * Cada buzón crea sus tickets en un área y, si se elige, un subgrupo (p. ej. el
 * de FTTx/Soporte cae en Entrantes de Soporte). La respuesta desde el portal sale
 * por el buzón donde llegó el ticket. Se configuran en Administración → Buzones;
 * se desactivan, no se borran. Sin buzones en la tabla, la ingesta usa
 * GRAPH_NOC_MAILBOX del .env y todo entra a General.
 */

const { isActiveArea, isValidSubgrupo, AREA_NAMES, subgrupoName } = require('./areaCatalog');

const MAX_CORREO = 180;
const MAX_ERROR = 300;
const CORREO_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

const texto = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const esBool = v => v === true || v === false;

/** Correo de buzón normalizado (minúsculas, sin espacios) o null si no es válido. */
function normalizarCorreo(v) {
    const c = texto(v).toLowerCase();
    return c && c.length <= MAX_CORREO && CORREO_RE.test(c) ? c : null;
}

/**
 * Valida un buzón para crear (`parcial` false) o editar (`parcial` true).
 * El correo solo se da al crear. Al cambiar de área el subgrupo se vuelve a
 * validar (y queda vacío si no se manda). Devuelve { data } o { error }.
 */
function validarBuzon(body, { parcial = false } = {}) {
    const b = body && typeof body === 'object' ? body : {};
    const data = {};
    const has = k => b[k] !== undefined;

    if (!parcial) {
        const correo = normalizarCorreo(b.correo);
        if (!correo) return { error: 'Escribe un correo válido para el buzón' };
        data.correo = correo;
    }
    if (!parcial || has('area')) {
        if (!isActiveArea(b.area)) return { error: 'Área no válida' };
        data.area_codigo = b.area;
    }
    if (!parcial || has('subgrupo') || has('area')) {
        const sg = texto(b.subgrupo) || null;
        if (sg && !isValidSubgrupo(sg, b.area)) return { error: 'El subgrupo no es de esa área o está desactivado' };
        data.subgrupo_id = sg;
    }
    if (has('soloLectura') || !parcial) {
        if (has('soloLectura') && !esBool(b.soloLectura)) return { error: 'Solo lectura no válido' };
        data.solo_lectura = b.soloLectura === true;
    }
    if (parcial && has('activo')) {
        if (!esBool(b.activo)) return { error: 'Estado no válido' };
        data.activo = b.activo;
    }
    return { data };
}

/**
 * Área y subgrupo donde caen los tickets nuevos de un buzón. Si su área se
 * desactivó caen en General; si su subgrupo se desactivó, en el área sin subgrupo.
 */
function destinoDeBuzon(buzon) {
    const area = buzon && isActiveArea(buzon.area_codigo) ? buzon.area_codigo : 'GENERAL';
    const subgrupo = buzon && area === buzon.area_codigo && buzon.subgrupo_id && isValidSubgrupo(buzon.subgrupo_id, area)
        ? buzon.subgrupo_id : null;
    return { area_designada: area, subgrupo_id: subgrupo };
}

/**
 * Buzón (activo) desde el que se responde un ticket: el suyo; si no tiene o se
 * desactivó, uno de su área (primero el de su subgrupo, luego el del área sin
 * subgrupo, luego cualquiera del área). null si ninguno sirve.
 */
function buzonParaResponder(ticket, buzones) {
    const activos = (buzones || []).filter(b => b && b.activo !== false);
    if (!ticket || !activos.length) return null;
    const propio = ticket.buzon_id && activos.find(b => b.id === ticket.buzon_id);
    if (propio) return propio;
    const delArea = activos.filter(b => b.area_codigo === ticket.area_designada);
    return (ticket.subgrupo_id && delArea.find(b => b.subgrupo_id === ticket.subgrupo_id))
        || delArea.find(b => !b.subgrupo_id)
        || delArea[0]
        || null;
}

/** Texto corto de un error de Graph para guardarlo en el buzón. */
function textoError(error) {
    if (!error) return null;
    const t = texto(String(error.message || error)).split(/(?<=\.)\s/)[0];
    return t.slice(0, MAX_ERROR) || 'Error desconocido';
}

/** Lo que dibuja Administración. `sesion`: true/false en modo de prueba (¿inició sesión?), null con el secreto de TI. */
function buzonVista(b, { sesion = null } = {}) {
    return {
        id: b.id,
        correo: b.correo,
        area: b.area_codigo,
        areaNombre: AREA_NAMES[b.area_codigo] || b.area_codigo,
        subgrupo: b.subgrupo_id || '',
        subgrupoNombre: subgrupoName(b.subgrupo_id),
        activo: b.activo !== false,
        soloLectura: b.solo_lectura === true,
        ultimaRevision: b.ultima_revision ? new Date(b.ultima_revision).toISOString() : null,
        ultimoError: b.ultimo_error || null,
        sesion
    };
}

/** Detalle para Auditoría de lo que cambió en un buzón. */
function describirBuzon(d) {
    return [
        d.correo !== undefined ? d.correo : '',
        d.area_codigo !== undefined ? `área: ${AREA_NAMES[d.area_codigo] || d.area_codigo}` : '',
        d.subgrupo_id !== undefined ? `subgrupo: ${subgrupoName(d.subgrupo_id) || '-'}` : '',
        d.solo_lectura !== undefined ? (d.solo_lectura ? 'solo lectura' : 'lee y responde') : '',
        d.activo !== undefined ? (d.activo ? 'reactivado' : 'desactivado') : ''
    ].filter(Boolean).join(', ');
}

module.exports = {
    MAX_CORREO,
    normalizarCorreo,
    validarBuzon,
    destinoDeBuzon,
    buzonParaResponder,
    textoError,
    buzonVista,
    describirBuzon
};
