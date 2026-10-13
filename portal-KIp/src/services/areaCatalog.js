'use strict';

/**
 * Catálogo de áreas. Antes era un enum fijo en la base; ahora es la tabla Area
 * (Administración puede crear, renombrar y desactivar).
 *
 * `AREA_NAMES` (código → nombre) y `AREAS` (códigos) son objetos vivos: se
 * actualizan en el mismo lugar al recargar, así los servicios que los importan
 * ven siempre el catálogo vigente. Arrancan con las 7 áreas originales, que es
 * también lo que ven las pruebas sin base de datos.
 */

const DEFAULT_AREAS = Object.freeze([
    ['GENERAL', 'General'],
    ['REDES_FTTH', 'Redes FTTH'],
    ['TRAFICO_INALAMBRICO', 'Tráfico Inalámbrico'],
    ['WAN', 'WAN'],
    ['GRANDES_CLIENTES', 'Grandes Clientes'],
    ['SEGURIDAD', 'Seguridad'],
    ['TELEFONIA', 'Telefonía']
]);

const AREA_NAMES = {};          // todas, incluidas las desactivadas (para el historial)
const AREAS = [];               // códigos de todas, en orden
const ACTIVE = new Set();       // códigos que se pueden elegir
const CACHE_MS = 60 * 1000;
let cargadoEn = 0;

/** Reemplaza el catálogo: [{ codigo, nombre, activa }] en orden. */
function setAreas(list) {
    Object.keys(AREA_NAMES).forEach(k => { delete AREA_NAMES[k]; });
    AREAS.length = 0;
    ACTIVE.clear();
    list.forEach(a => {
        AREA_NAMES[a.codigo] = a.nombre;
        AREAS.push(a.codigo);
        if (a.activa !== false) ACTIVE.add(a.codigo);
    });
}
setAreas(DEFAULT_AREAS.map(([codigo, nombre]) => ({ codigo, nombre, activa: true })));

/** Recarga desde la tabla Area (con caché). Si la tabla no existe aún, deja el catálogo como está. */
async function refreshAreas(prisma, { force = false } = {}) {
    if (!force && Date.now() - cargadoEn < CACHE_MS) return;
    try {
        const filas = await prisma.area.findMany({ orderBy: [{ orden: 'asc' }, { nombre: 'asc' }] });
        if (filas.length) setAreas(filas);
        cargadoEn = Date.now();
    } catch (error) {
        cargadoEn = Date.now(); // no reintentar en cada petición
        console.error('Áreas no disponibles (¿migración pendiente?):', error.message);
    }
}

const isActiveArea = codigo => ACTIVE.has(codigo);
const areaName = codigo => AREA_NAMES[codigo] || codigo || 'General';
/** Áreas para elegir en formularios y filtros. */
const activeAreas = () => AREAS.filter(c => ACTIVE.has(c)).map(codigo => ({ codigo, nombre: AREA_NAMES[codigo] }));
/** Todas, con su estado (Administración). */
const allAreas = () => AREAS.map(codigo => ({ codigo, nombre: AREA_NAMES[codigo], activa: ACTIVE.has(codigo) }));

/** "Centro de Datos Norte" → "CENTRO_DE_DATOS_NORTE" (sin tildes ni símbolos). */
function codeFromName(nombre) {
    return String(nombre || '')
        .normalize('NFD').replace(/\p{Diacritic}/gu, '')
        .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
        .slice(0, 40);
}

/** Valida el nombre de un área nueva o renombrada. Devuelve { error } o { nombre, codigo }. */
function validateAreaName(nombre) {
    const limpio = String(nombre || '').replace(/\s+/g, ' ').trim();
    if (limpio.length < 2 || limpio.length > 60) return { error: 'El nombre del área debe tener entre 2 y 60 caracteres' };
    const codigo = codeFromName(limpio);
    if (!codigo) return { error: 'El nombre del área debe tener letras o números' };
    return { nombre: limpio, codigo };
}

module.exports = {
    validateAreaName,
    DEFAULT_AREAS, AREA_NAMES, AREAS, setAreas, refreshAreas,
    isActiveArea, areaName, activeAreas, allAreas, codeFromName
};
