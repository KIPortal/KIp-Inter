const express = require('express');
const prisma = require('../config/prisma');
const requireAuth = require('../middlewares/requireAuth');
const { authorizeSupervisor, ticketWhere } = require('../services/roleService');
const { loadConfig } = require('../services/configService');
const { buildPorCerrar, MAX_AVISOS } = require('../services/closeNoticeService');

const router = express.Router();

// Campana del coordinador: tickets resueltos que esperan revisión y cierre (en su alcance)
router.get('/coordinador', requireAuth, authorizeSupervisor, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
        const config = await loadConfig(prisma);
        const activo = config.avisos.resuelto?.[0] !== false;
        if (!activo) return res.json({ success: true, activo, porCerrar: [] });
        const tickets = await prisma.ticket.findMany({
            where: { estado_actual: 'RESUELTO', ...ticketWhere(req.user) },
            select: { codigo_incidencia: true, asunto: true, area_designada: true, resueltoEn: true, updatedAt: true, estado_actual: true, asignado_a: { select: { nombre: true } } },
            orderBy: { updatedAt: 'desc' },
            take: MAX_AVISOS
        });
        res.json({ success: true, activo, porCerrar: buildPorCerrar(tickets) });
    } catch (error) {
        console.error('Error al cargar avisos del coordinador:', error.message);
        res.status(500).json({ success: false, error: 'No se pudieron cargar los avisos' });
    }
});

module.exports = router;
