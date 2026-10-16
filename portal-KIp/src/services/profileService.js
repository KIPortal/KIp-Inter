'use strict';

/**
 * Mi perfil: foto de perfil y cambio de clave de cada persona. Lógica pura
 * (ver scripts/test-perfil.js); el controlador es profileController.
 *
 * La foto se guarda en portal-KIp/fotos-perfil/ (no versionado) con un nombre
 * nuevo en cada subida (`<id>-<sello>.<ext>`), así el navegador puede guardarla
 * en caché sin mostrar una vieja. User.foto guarda solo ese nombre.
 *
 * Nota: mientras no se fusione feat/seguridad-login, la clave se compara y se
 * guarda tal cual, igual que en el login y en Administración.
 */

const path = require('path');
const { MIN_CLAVE } = require('./userAdminService');

const FOTOS_DIR = process.env.FOTOS_DIR || path.join(__dirname, '..', '..', 'fotos-perfil');
const FOTO_MAX_BYTES = 2 * 1024 * 1024;
const FOTO_TIPOS = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const FOTO_NOMBRE_RE = /^[0-9a-zA-Z-]{1,60}\.(jpg|png|webp)$/;

/** Tipo real de la imagen por sus primeros bytes (no por la extensión ni el Content-Type). */
function detectImageType(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpg';
    if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'png';
    if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
    return null;
}

/** Valida la imagen subida: { ext } o { error }. */
function validateFoto(buf) {
    if (!Buffer.isBuffer(buf) || buf.length === 0) return { error: 'Elige una imagen' };
    if (buf.length > FOTO_MAX_BYTES) return { error: 'La foto pesa más de 2 MB' };
    const ext = detectImageType(buf);
    if (!ext) return { error: 'La foto debe ser JPG, PNG o WebP' };
    return { ext };
}

/** Nombre de archivo nuevo para la foto de un usuario. */
function fotoFileName(userId, ext, now = Date.now()) {
    const id = String(userId || '').replace(/[^0-9a-zA-Z-]/g, '').slice(0, 40) || 'usuario';
    return `${id}-${now.toString(36)}.${ext}`;
}

/** true si el nombre es uno que generó fotoFileName (sin rutas ni caracteres raros). */
function isValidFotoName(nombre) {
    return typeof nombre === 'string' && FOTO_NOMBRE_RE.test(nombre);
}

/** URL para mostrar la foto (o null si no tiene). Solo la sirve a usuarios con sesión. */
function fotoUrl(foto) {
    return isValidFotoName(foto) ? '/perfil/foto/' + foto : null;
}

/**
 * Cambio de clave desde Mi perfil: pide la actual, la nueva y su confirmación.
 * @returns {{ clave: string } | { error: string, campo?: string }}
 */
function validatePasswordChange(body, claveGuardada) {
    const b = body || {};
    const actual = typeof b.actual === 'string' ? b.actual : '';
    const nueva = typeof b.nueva === 'string' ? b.nueva : '';
    const confirmar = typeof b.confirmar === 'string' ? b.confirmar : '';
    if (!actual) return { error: 'Escribe tu clave actual', campo: 'actual' };
    if (actual !== claveGuardada) return { error: 'La clave actual no coincide', campo: 'actual' };
    if (nueva.length < MIN_CLAVE || nueva.length > 72) return { error: `La clave nueva debe tener entre ${MIN_CLAVE} y 72 caracteres`, campo: 'nueva' };
    if (nueva === actual) return { error: 'La clave nueva debe ser distinta de la actual', campo: 'nueva' };
    if (nueva !== confirmar) return { error: 'La confirmación no coincide con la clave nueva', campo: 'confirmar' };
    return { clave: nueva };
}

const ROL_TXT = { GERENTE: 'Gerente', JEFE: 'Jefe de área', COORDINADOR: 'Coordinador', OPERADOR: 'Operador' };
const initials = n => String(n || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';

/** Datos que dibuja views/perfil.ejs. */
function buildProfileView(user, { areaNombre = '', subgrupoNombre = '' } = {}) {
    const u = user || {};
    return {
        nombre: u.nombre || 'Usuario',
        iniciales: initials(u.nombre),
        email: u.email || '',
        rolTxt: ROL_TXT[u.rol] || u.rol || '',
        area: areaNombre || u.area_designada || '',
        subgrupo: subgrupoNombre || '',
        atiende: u.rol === 'OPERADOR' || u.atiende_tickets === true,
        telefono: u.telefono || '',
        foto: fotoUrl(u.foto),
        minClave: MIN_CLAVE
    };
}

module.exports = {
    FOTOS_DIR, FOTO_MAX_BYTES, FOTO_TIPOS,
    detectImageType, validateFoto, fotoFileName, isValidFotoName, fotoUrl,
    validatePasswordChange, buildProfileView
};
