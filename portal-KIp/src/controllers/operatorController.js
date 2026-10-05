const prisma = require('../config/prisma');

const VALID_OPERATOR_STATES = new Set(['DISPONIBLE', 'EN_TERRENO', 'AUSENTE']);

async function updateStatus(req, res) {
    const { estadoOperativo } = req.body || {};

    if (!VALID_OPERATOR_STATES.has(estadoOperativo)) {
        return res.status(400).json({ success: false, error: 'Estado operativo no válido' });
    }
    if (req.params.operatorId !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Solo puedes actualizar tu propio estado operativo' });
    }

    try {
        const updatedOperator = await prisma.user.update({
            where: { id: req.user.id },
            data: { estado_operativo: estadoOperativo },
            select: { id: true, estado_operativo: true }
        });
        return res.json({ success: true, operador: updatedOperator });
    } catch (error) {
        console.error('Error al actualizar estado del operador:', error);
        return res.status(500).json({ success: false, error: 'No se pudo actualizar el estado operativo' });
    }
}

module.exports = { updateStatus };