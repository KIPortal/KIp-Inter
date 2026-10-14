'use strict';

/**
 * Contactos: cómo ubicar a cada persona del departamento (correo, teléfono o
 * extensión y si está en turno o de guardia). Lógica pura; la usa
 * contactController y la prueba scripts/test-roles.js.
 */

const { AREA_NAMES, AREAS } = require('./areaCatalog');

const ROL_TXT = { GERENTE: 'Gerente', JEFE: 'Jefe de área', COORDINADOR: 'Coordinador', OPERADOR: 'Operador' };
const ORDEN_ROL = { GERENTE: 0, JEFE: 1, COORDINADOR: 2, OPERADOR: 3 };

const iniciales = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();

/** Enlace tel: con solo dígitos, + y la extensión como pausa (",") */
function telHref(tel) {
    if (!tel) return null;
    const [base, ext] = String(tel).split(/\s*(?:ext|x)\.?\s*/i);
    const num = base.replace(/[^0-9+]/g, '');
    if (!num) return null;
    return 'tel:' + num + (ext ? ',' + ext.replace(/[^0-9]/g, '') : '');
}

/**
 * @param {object} p
 * @param {Array} p.usuarios   activos: { id, nombre, email, rol, area_designada, telefono, atiende_tickets }
 * @param {Map}   p.turnoPorId id → { etiqueta, codigo } (solo quienes atienden tickets)
 * @param {string} p.yoId
 */
function buildContacts({ usuarios = [], turnoPorId = new Map(), yoId = null } = {}) {
    const grupos = new Map();
    const orden = ['__GERENCIA', ...AREAS];
    usuarios.forEach(u => {
        const clave = u.rol === 'GERENTE' ? '__GERENCIA' : (u.area_designada || 'GENERAL');
        if (!grupos.has(clave)) {
            grupos.set(clave, { codigo: clave, nombre: clave === '__GERENCIA' ? 'Gerencia' : (AREA_NAMES[clave] || clave), personas: [] });
        }
        const t = turnoPorId.get(u.id);
        const grupo = !t ? null : t.codigo === 'EN_TURNO' ? 'turno' : (t.codigo === 'DE_GUARDIA' || t.codigo === 'EN_CASA_GUARDIA') ? 'guardia' : 'fuera';
        grupos.get(clave).personas.push({
            id: u.id,
            nombre: u.nombre,
            iniciales: iniciales(u.nombre),
            rol: u.rol,
            rolTxt: ROL_TXT[u.rol] || u.rol,
            email: u.email,
            telefono: u.telefono || '',
            tel: telHref(u.telefono),
            estado: t ? { etiqueta: t.etiqueta || 'Fuera de turno', grupo } : null,
            esYo: u.id === yoId
        });
    });
    const lista = [...grupos.values()].sort((a, b) => {
        const ia = orden.indexOf(a.codigo), ib = orden.indexOf(b.codigo);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.nombre.localeCompare(b.nombre, 'es');
    });
    lista.forEach(g => g.personas.sort((a, b) => (ORDEN_ROL[a.rol] ?? 9) - (ORDEN_ROL[b.rol] ?? 9) || a.nombre.localeCompare(b.nombre, 'es')));
    const yo = usuarios.find(u => u.id === yoId);
    return {
        grupos: lista,
        total: usuarios.length,
        sinTelefono: usuarios.filter(u => !u.telefono).length,
        yo: yo ? { telefono: yo.telefono || '' } : null
    };
}

module.exports = { buildContacts, telHref, ROL_TXT };
