'use strict';

/**
 * El jefe de área solo actúa sobre su área: los tickets que toca (por código),
 * el área que les pone y la persona a la que se los asigna deben ser de su área
 * (los tickets del área General, sin clasificar, también los puede tomar).
 * Para coordinador y gerente no limita nada.
 */

const prisma = require('../config/prisma');
const { areaScope, areasVisibles } = require('../services/roleService');

const codigosDe = req => {
    const b = req.body || {};
    return [req.params.ticketCode, b.ticketCode, ...(Array.isArray(b.ticketCodes) ? b.ticketCodes : [])]
        .filter(c => typeof c === 'string' && c.trim())
        .map(c => c.trim());
};

async function limitarAlArea(req, res, next) {
    const areas = areasVisibles(req.user);
    if (!areas) return next();
    const negar = error => res.status(403).json({ success: false, error });
    try {
        const b = req.body || {};
        const pedidas = [b.areaDesignada, b.area_designada].filter(a => typeof a === 'string' && a);
        if (pedidas.some(a => !areas.includes(a))) return negar('Solo puedes usar tu área');

        if (typeof b.operatorId === 'string' && b.operatorId.trim()) {
            const op = await prisma.user.findUnique({ where: { id: b.operatorId.trim() }, select: { area_designada: true } });
            if (op && op.area_designada !== areaScope(req.user)) return negar('Solo puedes asignar a personas de tu área');
        }

        const codigos = codigosDe(req);
        if (codigos.length) {
            const tickets = await prisma.ticket.findMany({
                where: { ...prisma.INCLUDE_DELETED, codigo_incidencia: { in: codigos } },
                select: { area_designada: true }
            });
            if (tickets.some(t => !areas.includes(t.area_designada || 'GENERAL'))) return negar('Ese ticket es de otra área');
        }
        return next();
    } catch (error) {
        console.error('Error al validar el área del jefe:', error);
        return res.status(500).json({ success: false, error: 'Error en el servidor' });
    }
}

module.exports = { limitarAlArea };
