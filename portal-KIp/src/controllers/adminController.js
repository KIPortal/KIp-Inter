'use strict';

/**
 * Administración (IMPLEMENTACION.md §3.4): áreas y equipos (lectura), plantillas,
 * reglas de alerta y avisos. Para coordinador y gerente (se protege al montar);
 * solo el gerente da o quita los roles Jefe y Gerente.
 */

const prisma = require('../config/prisma');
const { ACTIVE_STATES } = require('../services/metricsService');
const { AREA_NAMES } = require('../services/periodReportService');
const { loadConfig, mergeConfig, describeChanges, previewRules, EVENTOS, DESTINATARIOS, MAX_PLANTILLAS, MAX_TEXTO } = require('../services/configService');
const { LIMITS } = require('../services/rulesService');
const { auditUserId } = require('../services/auditViewService');
const { loadOperatorsWithShift } = require('./dashboardController');
const { validateUser, describeUser, MIN_CLAVE } = require('../services/userAdminService');
const { allAreas, refreshAreas, validateAreaName, allSubgrupos, isValidSubgrupo, subgrupoName } = require('../services/areaCatalog');
const { SUPERVISORES, ROLES_ALTOS, motivoNoGestionar } = require('../services/roleService');

// ¿Hay algún gerente activo? Sin gerente, el coordinador puede nombrar al primero.
// Solo se consulta cuando el cambio toca a jefes o gerentes.
async function hayGerente(actor, ...roles) {
    if (actor?.rol === 'GERENTE' || !roles.some(r => ROLES_ALTOS.includes(r))) return true;
    return (await prisma.user.count({ where: { rol: 'GERENTE', activo: true } })) > 0;
}

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
        await refreshAreas(prisma, { force: true });
        const [config, operadores, tickets, coordinadores, desactivados] = await Promise.all([
            loadConfig(prisma), loadOperatorsWithShift(ahora), activeTickets(),
            prisma.user.findMany({ where: { rol: { in: SUPERVISORES }, activo: true }, select: { id: true, nombre: true, email: true, rol: true, area_designada: true, atiende_tickets: true, telefono: true, subgrupo_id: true }, orderBy: { nombre: 'asc' } }),
            prisma.user.findMany({ where: { activo: false }, select: { id: true, nombre: true, email: true, rol: true, area_designada: true, telefono: true }, orderBy: { nombre: 'asc' } })
        ]);
        const areas = allAreas().map(({ codigo, activa }) => {
            const ops = operadores.filter(o => o.rol === 'OPERADOR' && (o.area_designada || 'GENERAL') === codigo).map(o => ({
                id: o.id,
                telefono: o.telefono || '',
                subgrupo: o.subgrupo_id || '',
                subgrupoNombre: subgrupoName(o.subgrupo_id),
                area: o.area_designada || 'GENERAL',
                nombre: o.nombre,
                email: o.email,
                estado: { etiqueta: o.turno?.etiqueta || 'Fuera de turno', grupo: grupo(o.turno?.codigo) },
                carga: (o.tickets_asignados || []).length
            }));
            return {
                codigo,
                activa,
                nombre: AREA_NAMES[codigo],
                subgrupos: allSubgrupos().filter(g => g.area === codigo),
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
            desactivados: (desactivados || []).map(u => ({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, area: u.area_designada, telefono: u.telefono || '' })),
            miId: req.user?.id || null,
            miRol: req.user?.rol || null,
            // Sin gerente activo, el coordinador también puede dar los roles Jefe y Gerente
            daRolesAltos: req.user?.rol === 'GERENTE' || !coordinadores.some(c => c.rol === 'GERENTE'),
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
            await prisma.auditLog.create({ data: { accion: 'CONFIGURACION_EDITADA', userId: auditUserId(req), detalles: cambios.join('. ') } });
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
        await prisma.auditLog.create({ data: { accion, userId: auditUserId(req), detalles } });
    } catch (e) {
        console.error('No se pudo registrar auditoría:', e.message);
    }
};
const publico = u => ({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol, area: u.area_designada, atiende: u.atiende_tickets === true, telefono: u.telefono || '', subgrupo: u.subgrupo_id || '' });

/** Reglas que dependen del estado final del usuario (ya validado campo a campo). */
function motivoRolFinal(final) {
    if (final.rol === 'JEFE' && (final.area_designada || 'GENERAL') === 'GENERAL') return 'El jefe de área necesita su área: elige una distinta de General';
    if (final.subgrupo_id && !isValidSubgrupo(final.subgrupo_id, final.area_designada || 'GENERAL')) return 'El subgrupo no es de esa área o está desactivado';
    return null;
}

// Alta de usuario con clave temporal (se guarda sin cifrar hasta feat/seguridad-login)
async function createUser(req, res) {
    const { error, datos } = validateUser(req.body, { nuevo: true });
    if (error) return res.status(400).json({ success: false, error });
    const prohibido = motivoNoGestionar(req.user, null, datos.rol, { hayGerente: await hayGerente(req.user, datos.rol) });
    if (prohibido) return res.status(403).json({ success: false, error: prohibido });
    const motivo = motivoRolFinal(datos);
    if (motivo) return res.status(400).json({ success: false, error: motivo });
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
        const antes = await prisma.user.findUnique({ where: { id }, select: { id: true, nombre: true, email: true, rol: true, area_designada: true, activo: true, atiende_tickets: true, telefono: true, subgrupo_id: true } });
        if (!antes) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        const prohibido = motivoNoGestionar(req.user, antes, datos.rol, { hayGerente: await hayGerente(req.user, datos.rol, antes.rol) });
        if (prohibido) return res.status(403).json({ success: false, error: prohibido });
        // Cambiar de área sin elegir subgrupo lo deja sin subgrupo
        if (datos.area_designada && datos.area_designada !== antes.area_designada && datos.subgrupo_id === undefined && antes.subgrupo_id) datos.subgrupo_id = null;
        const motivo = motivoRolFinal({ ...antes, ...datos });
        if (motivo) return res.status(400).json({ success: false, error: motivo });
        if (datos.rol && datos.rol !== antes.rol && id === req.user?.id) {
            return res.status(409).json({ success: false, error: 'No puedes cambiar tu propio rol' });
        }
        if (datos.activo === false && id === req.user?.id) {
            return res.status(409).json({ success: false, error: 'No puedes desactivar tu propio usuario' });
        }
        if (datos.activo === false && antes.activo !== false) {
            const activos = await prisma.ticket.count({ where: { asignado_a_id: id, estado_actual: { in: ACTIVE_STATES } } });
            if (activos > 0) return res.status(409).json({ success: false, error: `Tiene ${activos} tickets activos asignados: reasígnalos antes de desactivarlo` });
        }
        if (datos.email && datos.email !== antes.email) {
            const otro = await prisma.user.findUnique({ where: { email: datos.email }, select: { id: true } });
            if (otro && otro.id !== id) return res.status(409).json({ success: false, error: 'Ya existe un usuario con ese correo' });
        }
        if (datos.rol && datos.rol !== 'OPERADOR' && antes.rol === 'OPERADOR') {
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

// Áreas: crear, renombrar y activar/desactivar (no se borran: conservan su historial)
async function createArea(req, res) {
    const v = validateAreaName(req.body?.nombre);
    if (v.error) return res.status(400).json({ success: false, error: v.error });
    try {
        if (await prisma.area.findUnique({ where: { codigo: v.codigo } })) {
            return res.status(409).json({ success: false, error: 'Ya existe un área con ese nombre' });
        }
        const ultima = await prisma.area.findFirst({ orderBy: { orden: 'desc' }, select: { orden: true } });
        const area = await prisma.area.create({ data: { codigo: v.codigo, nombre: v.nombre, orden: (ultima?.orden ?? -1) + 1 } });
        await refreshAreas(prisma, { force: true });
        await auditUser(req, 'AREA_CREADA', `${area.nombre} (${area.codigo})`);
        return res.status(201).json({ success: true, area });
    } catch (e) {
        console.error('Error al crear área:', e);
        return res.status(500).json({ success: false, error: 'No se pudo crear el área' });
    }
}

async function updateArea(req, res) {
    const codigo = String(req.params.codigo || '').trim();
    const data = {};
    if (req.body?.nombre !== undefined) {
        const v = validateAreaName(req.body.nombre);
        if (v.error) return res.status(400).json({ success: false, error: v.error });
        data.nombre = v.nombre;
    }
    if (req.body?.activa !== undefined) {
        if (typeof req.body.activa !== 'boolean') return res.status(400).json({ success: false, error: 'Valor de activa no válido' });
        data.activa = req.body.activa;
    }
    if (!Object.keys(data).length) return res.status(400).json({ success: false, error: 'No hay cambios para guardar' });
    try {
        const antes = await prisma.area.findUnique({ where: { codigo } });
        if (!antes) return res.status(404).json({ success: false, error: 'Área no encontrada' });
        if (data.activa === false && antes.activa) {
            if (codigo === 'GENERAL') return res.status(409).json({ success: false, error: 'El área General no se puede desactivar: recibe los correos sin clasificar' });
            const [ops, tickets] = await Promise.all([
                prisma.user.count({ where: { area_designada: codigo, activo: true } }),
                prisma.ticket.count({ where: { area_designada: codigo, estado_actual: { in: ACTIVE_STATES } } })
            ]);
            if (ops || tickets) {
                return res.status(409).json({ success: false, error: `Antes de desactivarla, mueve sus ${ops} usuarios activos y ${tickets} tickets activos a otra área` });
            }
        }
        const area = await prisma.area.update({ where: { codigo }, data });
        await refreshAreas(prisma, { force: true });
        const cambios = [];
        if (data.nombre && data.nombre !== antes.nombre) cambios.push(`nombre: ${antes.nombre} → ${data.nombre}`);
        if (data.activa !== undefined && data.activa !== antes.activa) cambios.push(data.activa ? 'reactivada' : 'desactivada');
        await auditUser(req, 'AREA_EDITADA', `${antes.nombre}: ${cambios.join(', ') || 'sin cambios'}`);
        return res.json({ success: true, area });
    } catch (e) {
        console.error('Error al editar área:', e);
        return res.status(500).json({ success: false, error: 'No se pudo guardar el área' });
    }
}

// Subgrupos de un área: crear, renombrar y activar/desactivar (no se borran)
function validateSubgrupoName(nombre) {
    const limpio = String(nombre || '').replace(/\s+/g, ' ').trim();
    if (limpio.length < 2 || limpio.length > 60) return { error: 'El nombre del subgrupo debe tener entre 2 y 60 caracteres' };
    return { nombre: limpio };
}

async function createSubgrupo(req, res) {
    const codigo = String(req.params.codigo || '').trim();
    const v = validateSubgrupoName(req.body?.nombre);
    if (v.error) return res.status(400).json({ success: false, error: v.error });
    try {
        const area = await prisma.area.findUnique({ where: { codigo } });
        if (!area) return res.status(404).json({ success: false, error: 'Área no encontrada' });
        if (await prisma.subgrupo.findFirst({ where: { area_codigo: codigo, nombre: { equals: v.nombre, mode: 'insensitive' } } })) {
            return res.status(409).json({ success: false, error: 'Esa área ya tiene un subgrupo con ese nombre' });
        }
        const ultimo = await prisma.subgrupo.findFirst({ where: { area_codigo: codigo }, orderBy: { orden: 'desc' }, select: { orden: true } });
        const subgrupo = await prisma.subgrupo.create({ data: { area_codigo: codigo, nombre: v.nombre, orden: (ultimo?.orden ?? -1) + 1 } });
        await refreshAreas(prisma, { force: true });
        await auditUser(req, 'SUBGRUPO_CREADO', `${area.nombre} · ${subgrupo.nombre}`);
        return res.status(201).json({ success: true, subgrupo });
    } catch (e) {
        console.error('Error al crear subgrupo:', e);
        return res.status(e.code === 'P2002' ? 409 : 500).json({ success: false, error: e.code === 'P2002' ? 'Esa área ya tiene un subgrupo con ese nombre' : 'No se pudo crear el subgrupo' });
    }
}

async function updateSubgrupo(req, res) {
    const id = String(req.params.id || '').trim();
    const data = {};
    if (req.body?.nombre !== undefined) {
        const v = validateSubgrupoName(req.body.nombre);
        if (v.error) return res.status(400).json({ success: false, error: v.error });
        data.nombre = v.nombre;
    }
    if (req.body?.activo !== undefined) {
        if (typeof req.body.activo !== 'boolean') return res.status(400).json({ success: false, error: 'Valor de activo no válido' });
        data.activo = req.body.activo;
    }
    if (!Object.keys(data).length) return res.status(400).json({ success: false, error: 'No hay cambios para guardar' });
    try {
        const antes = await prisma.subgrupo.findUnique({ where: { id } });
        if (!antes) return res.status(404).json({ success: false, error: 'Subgrupo no encontrado' });
        if (data.activo === false && antes.activo) {
            const [personas, tickets] = await Promise.all([
                prisma.user.count({ where: { subgrupo_id: id, activo: true } }),
                prisma.ticket.count({ where: { subgrupo_id: id, estado_actual: { in: ACTIVE_STATES } } })
            ]);
            if (personas || tickets) {
                return res.status(409).json({ success: false, error: `Antes de desactivarlo, saca del subgrupo a sus ${personas} personas activas y ${tickets} tickets activos` });
            }
        }
        const subgrupo = await prisma.subgrupo.update({ where: { id }, data });
        await refreshAreas(prisma, { force: true });
        const cambios = [];
        if (data.nombre && data.nombre !== antes.nombre) cambios.push(`nombre: ${antes.nombre} → ${data.nombre}`);
        if (data.activo !== undefined && data.activo !== antes.activo) cambios.push(data.activo ? 'reactivado' : 'desactivado');
        await auditUser(req, 'SUBGRUPO_EDITADO', `${AREA_NAMES[antes.area_codigo] || antes.area_codigo} · ${antes.nombre}: ${cambios.join(', ') || 'sin cambios'}`);
        return res.json({ success: true, subgrupo });
    } catch (e) {
        console.error('Error al editar subgrupo:', e);
        return res.status(e.code === 'P2002' ? 409 : 500).json({ success: false, error: e.code === 'P2002' ? 'Esa área ya tiene un subgrupo con ese nombre' : 'No se pudo guardar el subgrupo' });
    }
}

module.exports = { renderAdmin, saveConfig, preview, createUser, updateUser, createArea, updateArea, createSubgrupo, updateSubgrupo };
