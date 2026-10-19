/**
 * Autenticación con Microsoft Graph en dos modos (GRAPH_MODO en el .env):
 *
 * - "aplicacion" (por defecto): la app entra con su secreto (client credentials).
 *   Lee y responde desde GRAPH_NOC_MAILBOX. Requiere que TI dé el consentimiento.
 * - "delegado": una persona inicia sesión UNA vez con un código
 *   (node scripts/graph-login.js) y el portal lee y responde desde SU buzón (/me).
 *   No usa secreto. La sesión (con su token de renovación) queda en
 *   GRAPH_SESION_ARCHIVO, que nunca se sube a git.
 */
const fs = require('fs');
const path = require('path');

const SCOPES_DELEGADOS = ['Mail.ReadWrite', 'Mail.Send', 'offline_access'];
const SESION_POR_DEFECTO = path.resolve(__dirname, '../../.graph-sesion.json');

function modo(env = process.env) {
    return String(env.GRAPH_MODO || '').trim().toLowerCase() === 'delegado' ? 'delegado' : 'aplicacion';
}

function archivoSesion(env = process.env) {
    return env.GRAPH_SESION_ARCHIVO ? path.resolve(env.GRAPH_SESION_ARCHIVO) : SESION_POR_DEFECTO;
}

/** Ruta del buzón en Graph: el propio (/me) en modo delegado; el configurado en modo aplicación. */
function rutaBuzon(env = process.env) {
    if (modo(env) === 'delegado') return '/me';
    return env.GRAPH_NOC_MAILBOX ? `/users/${encodeURIComponent(env.GRAPH_NOC_MAILBOX)}` : null;
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
    const r = await pca.acquireTokenSilent({ account: cuentas[0], scopes: SCOPES_DELEGADOS });
    return r.accessToken;
}

/** Inicio de sesión con código (lo usa scripts/graph-login.js). `mostrar` recibe { verificationUri, userCode, message }. */
async function iniciarSesionConCodigo(pca, mostrar = (r) => console.log(r.message)) {
    return pca.acquireTokenByDeviceCode({
        scopes: SCOPES_DELEGADOS,
        deviceCodeCallback: mostrar
    });
}

module.exports = {
    SCOPES_DELEGADOS,
    modo,
    archivoSesion,
    rutaBuzon,
    pluginArchivo,
    crearClientePublico,
    tokenDelegado,
    iniciarSesionConCodigo
};
