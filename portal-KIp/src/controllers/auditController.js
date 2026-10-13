const prisma = require('../config/prisma');
const { getDayBounds, ACTIVE_STATES } = require('../services/metricsService');
const { parseAuditQuery, dateRange, buildAuditView, toCsv } = require('../services/auditViewService');

// Registro de Auditoría con los filtros de la consulta (usuario, acción, fecha, texto)
async function loadAudit(query) {
    const filtros = parseAuditQuery(query);
    const where = {};
    const rango = dateRange(filtros.fecha);
    if (rango) where.createdAt = rango;
    if (filtros.usuario === 'sistema') where.userId = null;
    else if (filtros.usuario) where.userId = filtros.usuario;
    if (filtros.accion) where.accion = filtros.accion;

    const [logs, hoyLogs, usuarios] = await Promise.all([
        prisma.auditLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: filtros.limite + 1,
            include: {
                ticket: { select: { codigo_incidencia: true } },
                user: { select: { nombre: true, email: true } }
            }
        }),
        prisma.auditLog.findMany({
            where: { createdAt: { gte: getDayBounds().start } },
            select: { accion: true, userId: true }
        }),
        prisma.user.findMany({ select: { id: true, nombre: true, email: true }, orderBy: { nombre: 'asc' } })
    ]);
    const hayMas = logs.length > filtros.limite;
    return buildAuditView({ logs: logs.slice(0, filtros.limite), hoyLogs, usuarios, filtros, hayMas });
}

async function getAuditLogs(req, res) {
    try {
        const [vista, activos] = await Promise.all([
            loadAudit(req.query),
            prisma.ticket.count({ where: { estado_actual: { in: ACTIVE_STATES } } })
        ]);
        return res.render('auditoria', { titulo: 'Auditoría', currentUser: req.user, vista, activos });
    } catch (error) {
        console.error('Error al cargar Auditoría:', error);
        return res.status(500).send('Error interno del servidor');
    }
}

// Descarga del registro filtrado en CSV (abre en Excel)
async function exportAuditCsv(req, res) {
    try {
        const vista = await loadAudit({ ...req.query, limite: 1000 });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="auditoria-${vista.filtros.fecha}.csv"`);
        return res.send(toCsv(vista));
    } catch (error) {
        console.error('Error al exportar Auditoría:', error);
        return res.status(500).send('No se pudo exportar el registro');
    }
}

module.exports = { getAuditLogs, exportAuditCsv, loadAudit };
