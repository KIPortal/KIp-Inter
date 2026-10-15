const prisma = require('../config/prisma');
const { areaScope, ticketWhere } = require('../services/roleService');
const {
    ACTIVE_STATES,
    getPeriodBounds
} = require('../services/metricsService');
const { buildPeriodReport, AREAS: REPORT_AREAS, AREA_NAMES } = require('../services/periodReportService');
const { buildReportView } = require('../services/reportViewService');
const { isActiveArea } = require('../services/areaCatalog');
const { buildWorkbook } = require('../services/excelExportService');
const { loadConfig } = require('../services/configService');
const { loadReport, cerrarJornada, listarJornadas, excelDeJornada } = require('../services/jornadaRegistroService');
const { auditUserId } = require('../services/auditViewService');

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

// Periodos ya terminados se arman con el registro de jornadas si están todos sus días;
// ?fuente=vivo fuerza los datos en vivo.
async function loadPeriodReport(query) {
    const parsed = parsePeriodQuery(query);
    if (parsed.error) return parsed;
    const { range, area } = parsed;
    return loadReport(prisma, { range, area, forzarVivo: query.fuente === 'vivo' });
}

// El jefe de área solo ve el reporte de su área
const consulta = req => (areaScope(req.user) ? { ...req.query, area: areaScope(req.user) } : req.query);

async function getPeriodData(req, res) {
    try {
        const result = await loadPeriodReport(consulta(req));
        if (result.error) return res.status(400).json({ success: false, error: result.error });
        return res.json({ success: true, ...result.report });
    } catch (error) {
        console.error('Error al generar el reporte por periodo:', error);
        return res.status(500).json({ success: false, error: 'No se pudo generar el reporte' });
    }
}

async function downloadExcel(req, res) {
    try {
        const result = await loadPeriodReport(consulta(req));
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
        const query = { ...consulta(req), periodo: periodo === 'especifica' ? 'jornada' : periodo };
        const result = await loadPeriodReport(query);
        if (result.error) return res.redirect(302, '/reportes');
        const [activos, config] = await Promise.all([
            prisma.ticket.count({ where: { estado_actual: { in: ACTIVE_STATES }, ...ticketWhere(req.user) } }),
            loadConfig(prisma)
        ]);
        const vista = buildReportView(result.report, {
            periodo: query.periodo,
            fecha: typeof req.query.fecha === 'string' && req.query.fecha ? req.query.fecha : null,
            area: typeof query.area === 'string' && query.area ? query.area : null,
            metas: config.reglas.metas,
            fuente: result.fuente
        });
        const catalogo = areaScope(req.user) ? [areaScope(req.user)] : REPORT_AREAS;
        return res.render('reportes', { titulo: 'Reportes', currentUser: req.user, vista, areasCatalogo: catalogo.map(c => ({ codigo: c, nombre: AREA_NAMES[c] + (isActiveArea(c) ? '' : ' (desactivada)') })), activos });
    } catch (error) {
        console.error('Error al cargar Reportes:', error);
        return res.status(500).send('Error en el servidor');
    }
}

// --- Registro de jornadas ---

const nombreDe = user => user?.nombre || user?.email || null;

// POST /reportes/jornadas/cerrar { fecha?, reemplazar? } — guarda la foto y el Excel del día
async function cerrarJornadaManual(req, res) {
    try {
        const fecha = typeof req.body?.fecha === 'string' && req.body.fecha.trim() ? req.body.fecha.trim() : undefined;
        const reemplazar = req.body?.reemplazar === true || req.body?.reemplazar === 'true';
        const r = await cerrarJornada(prisma, { fecha, origen: 'MANUAL', cerradoPor: nombreDe(req.user), reemplazar });
        if (r.error) return res.status(400).json({ success: false, error: r.error });
        if (r.existe) return res.status(409).json({ success: false, existe: true, fecha: r.fecha, error: `La jornada ${r.fecha} ya está registrada. ¿Reemplazarla con los datos de ahora?` });
        try {
            await prisma.auditLog.create({ data: { accion: 'JORNADA_CERRADA', userId: auditUserId(req), detalles: `Jornada ${r.fecha}${r.reemplazado ? ' (reemplazada)' : ''}: ${r.resumen.creados} recibidos, ${r.resumen.resueltos} resueltos, ${r.resumen.activos} activos` } });
        } catch (e) {
            console.error('No se pudo registrar auditoría:', e.message);
        }
        return res.json({ success: true, fecha: r.fecha, reemplazado: r.reemplazado, excelGuardado: Boolean(r.archivo) });
    } catch (error) {
        console.error('Error al cerrar la jornada:', error);
        return res.status(500).json({ success: false, error: 'No se pudo registrar la jornada' });
    }
}

// GET /reportes/jornadas?desde=&hasta= — jornadas registradas
async function getJornadas(req, res) {
    try {
        const jornadas = await listarJornadas(prisma, { desde: req.query.desde, hasta: req.query.hasta, limite: req.query.limite });
        return res.json({ success: true, jornadas });
    } catch (error) {
        console.error('Error al listar jornadas:', error);
        return res.status(500).json({ success: false, error: 'No se pudieron listar las jornadas' });
    }
}

// GET /reportes/jornadas/:fecha/excel — Excel guardado de ese día (el jefe recibe solo su área)
async function downloadJornadaExcel(req, res) {
    try {
        const r = await excelDeJornada(prisma, req.params.fecha, { area: areaScope(req.user), generadoPor: nombreDe(req.user) || '' });
        if (r.error) return res.status(400).json({ success: false, error: r.error });
        if (r.noExiste) return res.status(404).json({ success: false, error: 'Esa jornada no está registrada' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${r.filename}"`);
        return res.send(r.buffer);
    } catch (error) {
        console.error('Error al descargar el Excel de la jornada:', error);
        return res.status(500).json({ success: false, error: 'No se pudo entregar el Excel' });
    }
}

module.exports = { getPeriodData, downloadExcel, parsePeriodQuery, renderReportes, cerrarJornadaManual, getJornadas, downloadJornadaExcel };
