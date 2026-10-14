'use strict';

/**
 * Estados de Venezuela (códigos ISO 3166-2:VE sin guion) para ubicar cada ticket
 * en el mapa del Dashboard. El estado es opcional: un ticket sin estado no
 * aparece en el mapa.
 */

const ESTADOS_VE = {
    VEZ: 'Amazonas',
    VEB: 'Anzoátegui',
    VEC: 'Apure',
    VED: 'Aragua',
    VEE: 'Barinas',
    VEF: 'Bolívar',
    VEG: 'Carabobo',
    VEH: 'Cojedes',
    VEY: 'Delta Amacuro',
    VEA: 'Distrito Capital',
    VEI: 'Falcón',
    VEJ: 'Guárico',
    VEX: 'La Guaira',
    VEK: 'Lara',
    VEL: 'Mérida',
    VEM: 'Miranda',
    VEN: 'Monagas',
    VEO: 'Nueva Esparta',
    VEP: 'Portuguesa',
    VER: 'Sucre',
    VES: 'Táchira',
    VET: 'Trujillo',
    VEU: 'Yaracuy',
    VEV: 'Zulia',
    VEW: 'Dependencias Federales'
};

const isEstadoVe = codigo => typeof codigo === 'string' && Object.hasOwn(ESTADOS_VE, codigo);

/** Lista ordenada por nombre, para combos. */
const estadosVeLista = () => Object.entries(ESTADOS_VE)
    .map(([codigo, nombre]) => ({ codigo, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

/**
 * Valida el valor recibido del cliente: texto vacío o null = sin estado.
 * @returns {{ error: string } | { valor: string|null }}
 */
function parseEstadoVe(valor) {
    if (valor === undefined || valor === null || valor === '') return { valor: null };
    if (!isEstadoVe(valor)) return { error: 'Estado de Venezuela no válido' };
    return { valor };
}

module.exports = { ESTADOS_VE, isEstadoVe, estadosVeLista, parseEstadoVe };
