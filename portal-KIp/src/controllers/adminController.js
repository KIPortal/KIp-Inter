'use strict';

/**
 * Administración (IMPLEMENTACION.md §3.4): áreas y equipos (lectura), plantillas,
 * reglas de alerta y avisos. Solo para el rol COORDINADOR (se protege al montar).
 */

const prisma = require('../config/prisma');
const { ACTIVE_STATES } = require('../services/metricsService');
const { AREA_NAMES } = require('../services/periodReportService');
const { loadConfig, mergeConfig, describeChanges, previewRules, EVENTOS, DESTINATARIOS, MAX_PLANTILLAS, MAX_TEXTO } = require('../services/configService');
const { LIMITS } = require('../services/rulesService');
const { loadOperatorsWithShift } = require('./dashboardController');
const { validateUser, describeUser, MIN_CLAVE } = require('../services/userAdminService');

const grupo = codigo => (codigo === 'EN_TURNO' ? 'turno' : (codigo === 'DE_GUARDIA' || codigo === 'EN_CASA_GUARDIA') ? 'guardia' : 'fuera');

async function activeTickets() {
    return prisma.ticket.findMany({
        where: { estado_actual: { in: ACTIVE_STATES } },
        select: { codigo_incidencia: true, estado_actual: true, puntos_complejidad: true, asignado_a_id: true, createdAt: true, updatedAt: true, fecha_asignacion: true }
    });
}

async function renderAdmin(req, res) {
    try {
        const ahora = new Date();
        const [config, operadores, tickets, coordinadores] = await Promise.all([
            loadConfig(prisma), loadOperatorsWithShift(ahora), activeTickets(),
            prisma.user.findMany({ where: { rol: 'COORDINADOR' }, select: { id: true, nombre: true, email: true }, orderBy: { nombre: 'asc' } })
        ]);
        const areas = Object.keys(AREA_NAMES).map(codigo => {
            const ops = operadores.filter(o => (o.area_designada || 'GENERAL') === codigo).map(o => ({
                id: o.id,
                area: o.area_designada || 'GENERAL',
                nombre: o.nombre,
                email: o.email,
                estado: { etiqueta: o.turno?.etiqueta || 'Fuera de turno', grupo: grupo(o.turno?.codigo) },
                carga: (o.tickets_asignados || []).length
            }));
            return {
                codigo,
                nombre: AREA_NAMES[codigo],
                operadores: ops,
                turno: ops.filter(o => o.estado.grupo === 'turno').length,
                guardia: ops.filter(o => o.estado.grupo === 'guardia').length
            };
        });
        return res.render('admin', {
            titulo: 'Administración',
            currentUser: req.user,
            config,
            areas,
            coordinadores,
            miId: req.user?.id || null,
            minClave: MIN_CLAVE,
            eventos: EVENTOS,
            destinatarios: DESTINATARIOS,
            limites: { ...LIMITS, plantillas: MAX_PLANTILLAS, texto: MAX_TEXTO },
            vistaPrevia: previewRules({ operators: operadores, tickets, rules: config.reglas, now: ahora }),
            activos: tickets.length,
            enTurno: operadores.filter(o => o.turno?.enTurno).length,
            totalOperadores: operadores.length
        });
    } catch (error) {
        console.error('Error al cargar Administración:', error);
        return res.status(500).send('Error en el servidor');
    }
}

// Guarda reglas, avisos y plantillas (saneados) y deja el detalle en Auditoría
async function saveConfig(req, res) {
    const body = req.body || {};
    try {
        const antes = await loadConfig(prisma);
        const despues = mergeConfig({
            reglas: body.reglas ?? antes.reglas,
            avisos: body.avisos ?? antes.avisos,
            plantillas: body.plantillas ?? antes.plantillas
        });
        const cambios = describeChanges(antes, despues);
        if (!cambios.length) return res.json({ success: true, config: despues, cambios });
        await prisma.$transaction(['reglas', 'avisos', 'plantillas'].map(clave => prisma.configuracion.upsert({
            where: { clave },
            create: { clave, valor: despues[clave] },
            update: { valor: despues[clave] }
        })));
        try {
            await prisma.auditLog.create({ data: { accion: 'CONFIGURACION_EDITADA', userId: req.user?.id && !req.user.id.startsWith('temporary:') ? req.user.id : null, detalles: cambios.join('. ') } });
        } catch (e) {
            console.error('No se pudo registrar auditoría:', e.message);
        }
        return res.json({ success: true, config: despues, cambios });
    } catch (error) {
        console.error('Error al guardar configuración:', error);
        const pendiente = /configuracion|does not exist|undefined/i.test(error.message || '');
        return res.status(pendiente ? 503 : 500).json({
            success: false,
            error: pendiente ? 'Falta aplicar la migración de Configuración (npx prisma migrate deploy)' : 'No se pudo guardar la configuración'
        });
    }
}

// Vista previa con los datos de hoy (no guarda nada)
async function preview(req, res) {
    try {
        const [operadores, tickets] = await Promise.all([loadOperatorsWithShift(new Date()), activeTickets()]);
        return res.json({ success: true, ...previewRules({ operators: operadores, tickets, rules: req.body?.reglas }) });
    } catch (error) {
        console.error('Error en vista previa:', error);
        return res.status(500).json({ success: false, error: 'No se pudo calcular la vista previa' });
    }
}

const auditUser = async (req, accion, detalles) => {
    try {
        await prisma.auditLog.create({ data: { accion, userId: req.user?.id && !req.user.id.startsWith('temporary:') ? req.user.id : null, detalles } });
    } catch (e) {
        console.error('No se pudo registrar auditoría:', e.message);
    }
};
const publico = u => ({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, area: u.area_designada });

// Alta de usuario con clave temporal (se guarda sin cifrar hasta feat/seguridad-login)
async function createUser(req, res) {
    const { error, datos } = validateUser(req.body, { nuevo: true });
    if (error) return res.status(400).json({ success: false, error });
    try {
        if (await prisma.user.findUnique({ where: { email: datos.email }, select: { id: true } })) {
            return res.status(409).json({ success: false, error: 'Ya existe un usuario con ese correo' });
        }
        const user = await prisma.user.create({ data: datos });
        await auditUser(req, 'USUARIO_CREADO', describeUser(null, datos));
        return res.status(201).json({ success: true, usuario: publico(user) });
    } catch (e) {
        console.error('Error al crear usuario:', e);
        return res.status(e.code === 'P2002' ? 409 : 500).json({ success: false, error: e.code === 'P2002' ? 'Ya existe un usuario con ese correo' : 'No se pudo crear el usuario' });
    }
}

async function updateUser(req, res) {
    const id = String(req.params.id || '').trim();
    const { error, datos } = validateUser(req.body);
    if (error) return res.status(400).json({ success: false, error });
    try {
        const antes = await prisma.user.findUnique({ where: { id }, select: { id: true, nombre: true, email: true, rol: true, area_designada: true } });
        if (!antes) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        if (datos.rol && datos.rol !== antes.rol && id === req.user?.id) {
            return res.status(409).json({ success: false, error: 'No puedes cambiar tu propio rol' });
        }
        if (datos.email && datos.email !== antes.email) {
            const otro = await prisma.user.findUnique({ where: { email: datos.email }, select: { id: true } });
            if (otro && otro.id !== id) return res.status(409).json({ success: false, error: 'Ya existe un usuario con ese correo' });
        }
        if (datos.rol === 'COORDINADOR' && antes.rol === 'OPERADOR') {
            const activos = await prisma.ticket.count({ where: { asignado_a_id: id, estado_actual: { in: ACTIVE_STATES } } });
            if (activos > 0) return res.status(409).json({ success: false, error: `Tiene ${activos} tickets activos asignados: reasígnalos antes de cambiarle el rol` });
        }
        const user = await prisma.user.update({ where: { id }, data: datos });
        await auditUser(req, 'USUARIO_EDITADO', describeUser(antes, datos));
        return res.json({ success: true, usuario: publico(user) });
    } catch (e) {
        console.error('Error al editar usuario:', e);
        return res.status(500).json({ success: false, error: 'No se pudo guardar el usuario' });
    }
}

module.exports = { renderAdmin, saveConfig, preview, createUser, updateUser };
