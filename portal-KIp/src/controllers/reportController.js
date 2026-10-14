const prisma = require('../config/prisma');
const {
    ACTIVE_STATES,
    getPeriodBounds
} = require('../services/metricsService');
const { buildPeriodReport, AREAS: REPORT_AREAS, AREA_NAMES } = require('../services/periodReportService');
const { buildReportView } = require('../services/reportViewService');
const { isActiveArea } = require('../services/areaCatalog');
const { buildWorkbook } = require('../services/excelExportService');
const { loadConfig } = require('../services/configService');

function parsePeriodQuery(query = {}) {
    const periodo = typeof query.periodo === 'string' ? query.periodo.trim() : 'jornada';
    const fecha = typeof query.fecha === 'string' && query.fecha.trim() ? query.fecha.trim() : null;
    if (periodo === 'especifica' && !fecha) return { error: 'Falta la fecha para el periodo "especifica" (AAAA-MM-DD)' };
    const range = getPeriodBounds(periodo, fecha);
    if (!range) return { error: 'Periodo o fecha no válidos. Usa periodo=jornada|semana|mes|especifica y fecha=AAAA-MM-DD' };
    const area = typeof query.area === 'string' && query.area.trim() ? query.area.trim() : null;
    if (area && !REPORT_AREAS.includes(area)) return { error: 'Área no válida' };
    return { range, area };
}

async function loadPeriodReport(query) {
    const parsed = parsePeriodQuery(query);
    if (parsed.error) return parsed;
    const { range, area } = parsed;
    const [tickets, operators] = await Promise.all([prisma.ticket.findMany({
        where: {
            OR: [
                { createdAt: { gte: range.start, lt: range.end } },
                { fecha_asignacion: { gte: range.start, lt: range.end } },
                { resueltoEn: { gte: range.start, lt: range.end } },
                { fecha_cierre: { gte: range.start, lt: range.end } },
                { estado_actual: { in: ACTIVE_STATES } }
            ]
        },
        select: {
            codigo_incidencia: true, asunto: true, area_designada: true, estado_actual: true,
            puntos_complejidad: true, createdAt: true, fecha_asignacion: true, resueltoEn: true, fecha_cierre: true,
            asignado_a: { select: { id: true, nombre: true } }
        },
        orderBy: { createdAt: 'asc' }
    }), prisma.user.findMany({
        where: { rol: 'OPERADOR' },
        select: { id: true, nombre: true, area_designada: true, estado_operativo: true },
        orderBy: { nombre: 'asc' }
    })]);
    return { report: buildPeriodReport({ tickets, operators, range, area }), range };
}

async function getPeriodData(req, res) {
    try {
        const result = await loadPeriodReport(req.query);
        if (result.error) return res.status(400).json({ success: false, error: result.error });
        return res.json({ success: true, ...result.report });
    } catch (error) {
        console.error('Error al generar el reporte por periodo:', error);
        return res.status(500).json({ success: false, error: 'No se pudo generar el reporte' });
    }
}

async function downloadExcel(req, res) {
    try {
        const result = await loadPeriodReport(req.query);
        if (result.error) return res.status(400).json({ success: false, error: result.error });
        const buffer = await buildWorkbook(result.report, { generadoPor: req.user?.nombre || req.user?.email || '' });
        const filename = `reporte-${result.range.periodo}-${result.range.desde}${result.range.desde === result.range.hasta ? '' : `_${result.range.hasta}`}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(Buffer.from(buffer));
    } catch (error) {
        console.error('Error al exportar el reporte a Excel:', error);
        return res.status(500).json({ success: false, error: 'No se pudo generar el Excel' });
    }
}

// Reportes (rediseño, IMPLEMENTACION.md §3.5): mismo reporte por periodo que el Excel
async function renderReportes(req, res) {
    if (req.user?.rol === 'OPERADOR') return res.redirect(302, '/');
    try {
        const periodo = ['jornada', 'semana', 'mes', 'especifica'].includes(req.query.periodo) ? req.query.periodo : 'jornada';
        const query = { ...req.query, periodo: periodo === 'especifica' ? 'jornada' : periodo };
        const result = await loadPeriodReport(query);
        if (result.error) return res.redirect(302, '/reportes');
        const [activos, config] = await Promise.all([
            prisma.ticket.count({ where: { estado_actual: { in: ACTIVE_STATES } } }),
            loadConfig(prisma)
        ]);
        const vista = buildReportView(result.report, {
            periodo: query.periodo,
            fecha: typeof req.query.fecha === 'string' && req.query.fecha ? req.query.fecha : null,
            area: typeof req.query.area === 'string' && req.query.area ? req.query.area : null,
            metas: config.reglas.metas
        });
        return res.render('reportes', { titulo: 'Reportes', currentUser: req.user, vista, areasCatalogo: REPORT_AREAS.map(c => ({ codigo: c, nombre: AREA_NAMES[c] + (isActiveArea(c) ? '' : ' (desactivada)') })), activos });
    } catch (error) {
        console.error('Error al cargar Reportes:', error);
        return res.status(500).send('Error en el servidor');
    }
}

module.exports = { getPeriodData, downloadExcel, parsePeriodQuery, renderReportes };
