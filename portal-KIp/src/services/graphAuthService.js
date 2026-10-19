/**
 * Autenticación con Microsoft Graph en dos modos (GRAPH_MODO en el .env):
 *
 * - "aplicacion" (por defecto): la app entra con su secreto (client credentials).
 *   Lee y responde desde GRAPH_NOC_MAILBOX. Requiere que TI dé el consentimiento.
 * - "delegado": una persona inicia sesión UNA vez con un código
 *   (node scripts/graph-login.js) y el portal lee y responde desde SU buzón (/me).
 *   No usa secreto. La sesión (con su token de renovación) queda en
 *   GRAPH_SESION_ARCHIVO, que nunca se sube a git.
 *
 * GRAPH_SOLO_LECTURA="si" (en cualquier modo): solo lee (permiso Mail.Read). No marca
 * correos como leídos ni envía respuestas; recuerda hasta qué correo leyó en
 * GRAPH_ESTADO_ARCHIVO y la primera vez empieza desde ese momento (no importa lo viejo).
 */
const fs = require('fs');
const path = require('path');

const SCOPES_DELEGADOS = ['Mail.ReadWrite', 'Mail.Send', 'offline_access'];
const SCOPES_SOLO_LECTURA = ['Mail.Read', 'offline_access'];
const SESION_POR_DEFECTO = path.resolve(__dirname, '../../.graph-sesion.json');
const ESTADO_POR_DEFECTO = path.resolve(__dirname, '../../.graph-estado.json');

function modo(env = process.env) {
    return String(env.GRAPH_MODO || '').trim().toLowerCase() === 'delegado' ? 'delegado' : 'aplicacion';
}

function soloLectura(env = process.env) {
    return ['si', 'sí', 'true', '1'].includes(String(env.GRAPH_SOLO_LECTURA || '').trim().toLowerCase());
}

function scopesDelegados(env = process.env) {
    return soloLectura(env) ? SCOPES_SOLO_LECTURA : SCOPES_DELEGADOS;
}

function archivoSesion(env = process.env) {
    return env.GRAPH_SESION_ARCHIVO ? path.resolve(env.GRAPH_SESION_ARCHIVO) : SESION_POR_DEFECTO;
}

/** Ruta del buzón en Graph: el propio (/me) en modo delegado; el configurado en modo aplicación. */
function rutaBuzon(env = process.env) {
    if (modo(env) === 'delegado') return '/me';
    return env.GRAPH_NOC_MAILBOX ? `/users/${encodeURIComponent(env.GRAPH_NOC_MAILBOX)}` : null;
}

// --- Hasta dónde se leyó (modo solo lectura) ---

function archivoEstado(env = process.env) {
    return env.GRAPH_ESTADO_ARCHIVO ? path.resolve(env.GRAPH_ESTADO_ARCHIVO) : ESTADO_POR_DEFECTO;
}

/** { desde: ISO, ids: [ids ya procesados recibidos exactamente en `desde`] } o null si nunca se leyó. */
function leerEstado(archivo = archivoEstado(), fsMod = fs) {
    try {
        const e = JSON.parse(fsMod.readFileSync(archivo, 'utf8'));
        return e && e.desde && !isNaN(Date.parse(e.desde)) ? { desde: e.desde, ids: Array.isArray(e.ids) ? e.ids : [] } : null;
    } catch (_) {
        return null;
    }
}

function guardarEstado(estado, archivo = archivoEstado(), fsMod = fs) {
    fsMod.writeFileSync(archivo, JSON.stringify(estado));
}

/** Estado tras procesar un correo: avanza la marca de tiempo o suma el id si llegó en el mismo instante. */
function avanzarEstado(estado, message) {
    const t = Date.parse(message.receivedDateTime);
    const actual = Date.parse(estado.desde);
    if (isNaN(t) || t < actual) return estado;
    if (t > actual) return { desde: new Date(t).toISOString(), ids: [message.id] };
    return { desde: estado.desde, ids: estado.ids.includes(message.id) ? estado.ids : [...estado.ids, message.id] };
}

/** Guarda y lee la caché de MSAL en un archivo local. */
function pluginArchivo(archivo, fsMod = fs) {
    return {
        async beforeCacheAccess(ctx) {
            if (fsMod.existsSync(archivo)) ctx.tokenCache.deserialize(fsMod.readFileSync(archivo, 'utf8'));
        },
        async afterCacheAccess(ctx) {
            if (ctx.cacheHasChanged) fsMod.writeFileSync(archivo, ctx.tokenCache.serialize(), { mode: 0o600 });
        }
    };
}

/** Cliente MSAL público (sin secreto) para el modo delegado. */
function crearClientePublico(env = process.env) {
    const { PublicClientApplication } = require('@azure/msal-node');
    if (!env.GRAPH_CLIENT_ID) throw new Error('Falta GRAPH_CLIENT_ID en el .env');
    // "common" acepta cuentas personales y de organización; con un tenant fijo, solo ese
    const tenant = (env.GRAPH_TENANT_ID || 'common').trim();
    return new PublicClientApplication({
        auth: { clientId: env.GRAPH_CLIENT_ID.trim(), authority: `https://login.microsoftonline.com/${tenant}` },
        cache: { cachePlugin: pluginArchivo(archivoSesion(env)) }
    });
}

/**
 * Token del modo delegado sin pedir nada a nadie (usa el token de renovación guardado).
 * Lanza un error claro si nadie ha iniciado sesión todavía.
 */
async function tokenDelegado(pca) {
    const cuentas = await pca.getTokenCache().getAllAccounts();
    if (!cuentas.length) {
        const e = new Error('No hay sesión de correo: ejecuta "node scripts/graph-login.js" e inicia sesión con el buzón');
        e.code = 'SIN_SESION';
        throw e;
    }
    const r = await pca.acquireTokenSilent({ account: cuentas[0], scopes: scopesDelegados() });
    return r.accessToken;
}

/** Inicio de sesión con código (lo usa scripts/graph-login.js). `mostrar` recibe { verificationUri, userCode, message }. */
async function iniciarSesionConCodigo(pca, mostrar = (r) => console.log(r.message)) {
    return pca.acquireTokenByDeviceCode({
        scopes: scopesDelegados(),
        deviceCodeCallback: mostrar
    });
}

module.exports = {
    SCOPES_DELEGADOS,
    SCOPES_SOLO_LECTURA,
    modo,
    soloLectura,
    scopesDelegados,
    archivoEstado,
    leerEstado,
    guardarEstado,
    avanzarEstado,
    archivoSesion,
    rutaBuzon,
    pluginArchivo,
    crearClientePublico,
    tokenDelegado,
    iniciarSesionConCodigo
};
