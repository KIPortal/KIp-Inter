'use strict';

/**
 * Alta y edición de usuarios desde Administración. Validación pura
 * (ver scripts/test-admin-usuarios.js).
 *
 * Nota: mientras no se fusione feat/seguridad-login, la clave se guarda tal cual
 * (igual que scripts/crear-admin.js). Por eso solo se aceptan claves temporales
 * y nunca se escriben en Auditoría.
 */

const { AREA_NAMES, isActiveArea } = require('./areaCatalog');

const ROLES = ['OPERADOR', 'COORDINADOR'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_CLAVE = 8;

/**
 * @param {object} input  { nombre, email, rol, area, clave }
 * @param {object} opts   { nuevo: boolean } — al crear, la clave es obligatoria
 * @returns {{ error: string } | { datos: object }}
 */
function validateUser(input, { nuevo = false } = {}) {
    const b = input && typeof input === 'object' ? input : {};
    const datos = {};
    const str = v => (typeof v === 'string' ? v.trim() : '');

    if (nuevo || b.nombre !== undefined) {
        const nombre = str(b.nombre).replace(/\s+/g, ' ');
        if (nombre.length < 3 || nombre.length > 80) return { error: 'El nombre debe tener entre 3 y 80 caracteres' };
        datos.nombre = nombre;
    }
    if (nuevo || b.email !== undefined) {
        const email = str(b.email).toLowerCase();
        if (!EMAIL_RE.test(email) || email.length > 120) return { error: 'El correo no es válido' };
        datos.email = email;
    }
    if (nuevo || b.rol !== undefined) {
        const rol = str(b.rol) || 'OPERADOR';
        if (!ROLES.includes(rol)) return { error: 'Rol no válido' };
        datos.rol = rol;
    }
    if (nuevo || b.area !== undefined) {
        const area = str(b.area) || 'GENERAL';
        if (!isActiveArea(area)) return { error: 'Área no válida o desactivada' };
        datos.area_designada = area;
    }
    if (nuevo || (b.clave !== undefined && b.clave !== '')) {
        const clave = typeof b.clave === 'string' ? b.clave : '';
        if (clave.length < MIN_CLAVE || clave.length > 72) return { error: `La clave temporal debe tener al menos ${MIN_CLAVE} caracteres` };
        datos.clave = clave;
    }
    if (b.atiende !== undefined) {
        if (typeof b.atiende !== 'boolean') return { error: 'Valor de "atiende tickets" no válido' };
        datos.atiende_tickets = b.atiende;
    }
    if (!nuevo && b.activo !== undefined) {
        if (typeof b.activo !== 'boolean') return { error: 'Valor de activo no válido' };
        datos.activo = b.activo;
    }
    if (!nuevo && Object.keys(datos).length === 0) return { error: 'No hay cambios para guardar' };
    return { datos };
}

/** Texto para Auditoría (sin la clave). */
function describeUser(antes, datos) {
    const ROL = { OPERADOR: 'operador', COORDINADOR: 'coordinador' };
    if (!antes) {
        return `${datos.nombre} (${datos.email}) · ${ROL[datos.rol]}${datos.atiende_tickets ? ' que atiende tickets' : ''} · ${AREA_NAMES[datos.area_designada] || datos.area_designada}`;
    }
    const cambios = [];
    if (datos.nombre && datos.nombre !== antes.nombre) cambios.push(`nombre: ${antes.nombre} → ${datos.nombre}`);
    if (datos.email && datos.email !== antes.email) cambios.push(`correo: ${antes.email} → ${datos.email}`);
    if (datos.rol && datos.rol !== antes.rol) cambios.push(`rol: ${ROL[antes.rol]} → ${ROL[datos.rol]}`);
    if (datos.area_designada && datos.area_designada !== antes.area_designada) {
        cambios.push(`área: ${AREA_NAMES[antes.area_designada] || antes.area_designada} → ${AREA_NAMES[datos.area_designada]}`);
    }
    if (datos.atiende_tickets === true && antes.atiende_tickets !== true) cambios.push('atiende tickets');
    if (datos.atiende_tickets === false && antes.atiende_tickets === true) cambios.push('ya no atiende tickets');
    if (datos.clave) cambios.push('clave temporal cambiada');
    if (datos.activo === false && antes.activo !== false) cambios.push('desactivado');
    if (datos.activo === true && antes.activo === false) cambios.push('reactivado');
    return `${antes.nombre}: ${cambios.join(', ') || 'sin cambios'}`;
}

module.exports = { validateUser, describeUser, ROLES, MIN_CLAVE };
