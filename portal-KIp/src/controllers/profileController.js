'use strict';

const fs = require('fs');
const path = require('path');
const prisma = require('../config/prisma');
const { AREA_NAMES, subgrupoName } = require('../services/areaCatalog');
const { auditUserId } = require('../services/auditViewService');
const {
    FOTOS_DIR, FOTO_TIPOS, validateFoto, fotoFileName, isValidFotoName, fotoUrl,
    validatePasswordChange, buildProfileView
} = require('../services/profileService');

const esTemporal = req => !req.user?.id || String(req.user.id).startsWith('temporary:');
const SIN_USUARIO = 'El acceso de desarrollo no tiene usuario para guardar';

async function audit(req, detalles) {
    try {
        await prisma.auditLog.create({ data: { accion: 'USUARIO_EDITADO', userId: auditUserId(req), detalles: `${req.user.nombre || req.user.id}: ${detalles}` } });
    } catch (e) {
        console.error('No se pudo registrar auditoría:', e.message);
    }
}

function borrarArchivo(nombre) {
    if (!isValidFotoName(nombre)) return;
    fs.promises.unlink(path.join(FOTOS_DIR, nombre)).catch(() => {});
}

// Mi perfil: datos propios (solo lectura los que fija Administración), teléfono, foto y clave
async function renderPerfil(req, res) {
    try {
        let user = req.user;
        if (!esTemporal(req)) {
            user = await prisma.user.findUnique({
                where: { id: req.user.id },
                select: { id: true, nombre: true, email: true, rol: true, area_designada: true, subgrupo_id: true, atiende_tickets: true, telefono: true, foto: true }
            }) || req.user;
        }
        const vista = buildProfileView(user, {
            areaNombre: AREA_NAMES[user.area_designada] || user.area_designada,
            subgrupoNombre: subgrupoName(user.subgrupo_id)
        });
        return res.render('perfil', { titulo: 'Mi perfil', currentUser: req.user, vista, temporal: esTemporal(req) });
    } catch (error) {
        console.error('Error al cargar Mi perfil:', error);
        return res.status(500).send('Error en el servidor');
    }
}

// Sube la foto: el cuerpo es la imagen tal cual (Content-Type image/*), máx. 2 MB
async function uploadFoto(req, res) {
    if (esTemporal(req)) return res.status(400).json({ success: false, error: SIN_USUARIO });
    const { error, ext } = validateFoto(req.body);
    if (error) return res.status(400).json({ success: false, error });
    const nombre = fotoFileName(req.user.id, ext);
    try {
        await fs.promises.mkdir(FOTOS_DIR, { recursive: true });
        await fs.promises.writeFile(path.join(FOTOS_DIR, nombre), req.body);
        const antes = await prisma.user.findUnique({ where: { id: req.user.id }, select: { foto: true } });
        await prisma.user.update({ where: { id: req.user.id }, data: { foto: nombre } });
        if (antes?.foto && antes.foto !== nombre) borrarArchivo(antes.foto);
        await audit(req, 'foto de perfil cambiada');
        return res.json({ success: true, foto: fotoUrl(nombre) });
    } catch (e) {
        console.error('Error al guardar la foto de perfil:', e);
        borrarArchivo(nombre);
        return res.status(500).json({ success: false, error: 'No se pudo guardar la foto' });
    }
}

async function deleteFoto(req, res) {
    if (esTemporal(req)) return res.status(400).json({ success: false, error: SIN_USUARIO });
    try {
        const antes = await prisma.user.findUnique({ where: { id: req.user.id }, select: { foto: true } });
        if (!antes?.foto) return res.json({ success: true, foto: null });
        await prisma.user.update({ where: { id: req.user.id }, data: { foto: null } });
        borrarArchivo(antes.foto);
        await audit(req, 'foto de perfil quitada');
        return res.json({ success: true, foto: null });
    } catch (e) {
        console.error('Error al quitar la foto de perfil:', e);
        return res.status(500).json({ success: false, error: 'No se pudo quitar la foto' });
    }
}

// Cambio de clave propio: pide la actual (se guarda sin cifrar hasta feat/seguridad-login)
async function changePassword(req, res) {
    if (esTemporal(req)) return res.status(400).json({ success: false, error: SIN_USUARIO });
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { clave: true } });
        if (!user) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        const r = validatePasswordChange(req.body, user.clave);
        if (r.error) return res.status(400).json({ success: false, error: r.error, campo: r.campo });
        await prisma.user.update({ where: { id: req.user.id }, data: { clave: r.clave } });
        await audit(req, 'cambió su clave desde Mi perfil');
        return res.json({ success: true });
    } catch (e) {
        console.error('Error al cambiar la clave:', e);
        return res.status(500).json({ success: false, error: 'No se pudo cambiar la clave' });
    }
}

// Sirve una foto solo a quien tiene sesión; el nombre cambia en cada subida, así que se guarda en caché
function serveFoto(req, res) {
    const nombre = req.params.archivo;
    if (!isValidFotoName(nombre)) return res.status(404).end();
    const ext = nombre.split('.').pop();
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.set('X-Content-Type-Options', 'nosniff');
    res.type(FOTO_TIPOS[ext]);
    return res.sendFile(path.join(FOTOS_DIR, nombre), err => {
        if (err && !res.headersSent) res.status(404).end();
    });
}

module.exports = { renderPerfil, uploadFoto, deleteFoto, changePassword, serveFoto };
