'use strict';

/**
 * Avisos del coordinador: tickets que un operador dejó en RESUELTO y esperan
 * que el coordinador (o el jefe de su área) los revise y los cierre.
 * Función pura; la consulta está en src/routes/avisosRoutes.js.
 */

const { formatAge } = require('./dashboardService');
const { AREA_NAMES } = require('./periodReportService');

const MAX_AVISOS = 30;

/** Lista para la campana: el más reciente primero. */
function buildPorCerrar(tickets = [], now = new Date()) {
    const nowMs = new Date(now).getTime();
    return tickets
        .filter(t => t.estado_actual === 'RESUELTO')
        .map(t => {
            const cuando = t.resueltoEn || t.updatedAt;
            const min = cuando ? Math.max(0, (nowMs - new Date(cuando).getTime()) / 60000) : null;
            return {
                codigo: t.codigo_incidencia,
                asunto: t.asunto || '',
                operador: t.asignado_a?.nombre || 'Sin operador',
                area: AREA_NAMES[t.area_designada] || t.area_designada || 'General',
                resueltoEn: cuando ? new Date(cuando).toISOString() : null,
                hace: min === null ? '' : (min < 1 ? 'Ahora' : 'Hace ' + formatAge(min))
            };
        })
        .sort((a, b) => String(b.resueltoEn).localeCompare(String(a.resueltoEn)))
        .slice(0, MAX_AVISOS);
}

module.exports = { buildPorCerrar, MAX_AVISOS };
