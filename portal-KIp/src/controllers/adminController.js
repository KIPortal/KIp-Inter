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
        const [config, operadores, tickets] = await Promise.all([loadConfig(prisma), loadOperatorsWithShift(ahora), activeTickets()]);
        const areas = Object.keys(AREA_NAMES).map(codigo => {
            const ops = operadores.filter(o => (o.area_designada || 'GENERAL') === codigo).map(o => ({
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

module.exports = { renderAdmin, saveConfig, preview };
