'use strict';

/**
 * Aviso inmediato de Microsoft Graph cuando llega un correo (notificaciones de cambio).
 * Opcional: solo se activa con GRAPH_WEBHOOK_URL, la dirección https pública del portal
 * (por ejemplo la del túnel de Cloudflare). Microsoft llama a /api/graph/notificaciones
 * y el portal revisa el buzón enseguida. La revisión periódica sigue como respaldo.
 */

const crypto = require('crypto');

const RUTA = '/api/graph/notificaciones';
const DURACION_MS = 2 * 24 * 60 * 60 * 1000;   // Microsoft permite hasta ~7 días para correos
const RENOVAR_CADA_MS = 12 * 60 * 60 * 1000;

let clientState = null;
let alAvisar = null;
let suscripcion = null;
let renovacion = null;

/** Dirección pública https a la que Microsoft avisa, o null si no está configurada o no es https. */
function urlNotificaciones(env = process.env) {
    const base = String(env.GRAPH_WEBHOOK_URL || '').trim().replace(/\/+$/, '');
    if (!base) return null;
    if (!/^https:\/\//i.test(base)) return null;
    return base + RUTA;
}

/** Recurso de Graph de la Bandeja de entrada a partir de la ruta del buzón ('/me' o '/users/x'). */
function recursoBandeja(rutaBuzon) {
    return `${rutaBuzon.replace(/^\//, '')}/mailFolders('inbox')/messages`;
}

const vence = (ahora = Date.now()) => new Date(ahora + DURACION_MS).toISOString();

async function crearSuscripcion(client, { url, recurso }) {
    clientState = crypto.randomBytes(24).toString('hex');
    suscripcion = await client.api('/subscriptions').post({
        changeType: 'created',
        notificationUrl: url,
        resource: recurso,
        expirationDateTime: vence(),
        clientState
    });
    return suscripcion;
}

async function renovar(client, datos) {
    try {
        if (!suscripcion) throw new Error('sin suscripción');
        await client.api(`/subscriptions/${suscripcion.id}`).patch({ expirationDateTime: vence() });
    } catch (e) {
        try { await crearSuscripcion(client, datos); } catch (e2) {
            console.error('❌ [Graph API] No se pudo renovar el aviso de correos nuevos:', e2.message);
        }
    }
}

/**
 * Pide a Microsoft que avise de cada correo nuevo. Se llama con el portal ya escuchando,
 * porque Microsoft valida la dirección en ese momento.
 */
async function iniciar({ client, rutaBuzon, revisar, env = process.env, timers = { setInterval } }) {
    const url = urlNotificaciones(env);
    if (!url || !client || !rutaBuzon) {
        if (String(env.GRAPH_WEBHOOK_URL || '').trim() && !url) console.warn('⚠️ GRAPH_WEBHOOK_URL debe empezar con https://. Se sigue con la revisión periódica.');
        return null;
    }
    alAvisar = revisar;
    const datos = { url, recurso: recursoBandeja(rutaBuzon) };
    try {
        await crearSuscripcion(client, datos);
        console.log(`✅ [Graph API] Aviso inmediato de correos nuevos activo (${url}).`);
    } catch (e) {
        console.error('❌ [Graph API] No se activó el aviso inmediato; se sigue con la revisión periódica:', e.message);
        return null;
    }
    if (!renovacion) renovacion = timers.setInterval(() => renovar(client, datos), RENOVAR_CADA_MS);
    return suscripcion;
}

/** POST /api/graph/notificaciones (sin sesión: lo llama Microsoft). */
function recibir(req, res) {
    // Validación al crear la suscripción: devolver el token tal cual, en texto plano
    if (req.query && req.query.validationToken) {
        return res.status(200).type('text/plain').send(String(req.query.validationToken));
    }
    const avisos = Array.isArray(req.body && req.body.value) ? req.body.value : [];
    const validos = avisos.filter(a => clientState && a.clientState === clientState);
    res.sendStatus(202);
    if (validos.length && alAvisar) Promise.resolve().then(alAvisar).catch(() => {});
}

module.exports = { urlNotificaciones, recursoBandeja, iniciar, recibir, RUTA };
