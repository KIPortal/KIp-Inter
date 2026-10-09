const prisma = require('../config/prisma');

async function getAuditLogs(req, res) {
    try {
        const rawLogs = await prisma.auditLog.findMany({
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: {
                ticket: { select: { codigo_incidencia: true } },
                user: { select: { nombre: true, email: true } }
            }
        });

        const logs = rawLogs.map(log => ({
            id: log.id,
            fecha: log.createdAt ? new Date(log.createdAt).toLocaleString('es-ES') : (log.fecha || '-'),
            usuario: log.user ? (log.user.nombre || log.user.email) : (log.usuario || 'Sistema (Graph API)'),
            accion: log.accion,
            ticket: log.ticket ? log.ticket.codigo_incidencia : (typeof log.ticket === 'string' ? log.ticket : '-'),
            detalles: log.detalles
        }));
        
        res.render('audit', {
            titulo: 'NOC Portal - Auditoría',
            logs,
            currentUser: req.user
        });
    } catch (error) {
        console.error('Error fetching audit logs:', error);
        res.status(500).send('Error interno del servidor');
    }
}

module.exports = { getAuditLogs };

