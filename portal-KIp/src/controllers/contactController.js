'use strict';

const prisma = require('../config/prisma');
const { buildContacts } = require('../services/contactService');
const { validatePhone } = require('../services/userAdminService');
const { auditUserId } = require('../services/auditViewService');
const { loadOperatorsWithShift } = require('./dashboardController');

// Contactos: todo el departamento (activos), visible para cualquier usuario
async function renderContactos(req, res) {
    try {
        const [usuarios, operadores] = await Promise.all([
            prisma.user.findMany({
                where: { activo: true },
                select: { id: true, nombre: true, email: true, rol: true, area_designada: true, telefono: true, foto: true },
                orderBy: { nombre: 'asc' }
            }),
            loadOperatorsWithShift(new Date())
        ]);
        const turnoPorId = new Map(operadores.map(o => [o.id, o.turno || {}]));
        const vista = buildContacts({ usuarios, turnoPorId, yoId: req.user?.id || null });
        return res.render('contactos', { titulo: 'Contactos', currentUser: req.user, vista });
    } catch (error) {
        console.error('Error al cargar Contactos:', error);
        return res.status(500).send('Error en el servidor');
    }
}

// Cada quien edita su propio teléfono o extensión
async function updateMyPhone(req, res) {
    const id = req.user?.id;
    if (!id || id.startsWith('temporary:')) return res.status(400).json({ success: false, error: 'El acceso de desarrollo no tiene usuario para guardar' });
    const tel = validatePhone(req.body?.telefono);
    if (tel.error) return res.status(400).json({ success: false, error: tel.error });
    try {
        await prisma.user.update({ where: { id }, data: { telefono: tel.telefono } });
        try {
            await prisma.auditLog.create({ data: { accion: 'USUARIO_EDITADO', userId: auditUserId(req), detalles: `${req.user.nombre || id}: ${tel.telefono ? 'teléfono: ' + tel.telefono : 'sin teléfono'}` } });
        } catch (e) {
            console.error('No se pudo registrar auditoría:', e.message);
        }
        return res.json({ success: true, telefono: tel.telefono || '' });
    } catch (error) {
        console.error('Error al guardar el teléfono:', error);
        return res.status(500).json({ success: false, error: 'No se pudo guardar el teléfono' });
    }
}

module.exports = { renderContactos, updateMyPhone };
