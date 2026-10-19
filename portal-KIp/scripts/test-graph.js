/**
 * Pruebas del modo de autenticación de Microsoft Graph (aplicación / delegado).
 * Sin red ni credenciales: MSAL y el cliente de Graph se simulan.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let total = 0, ok = 0;
async function prueba(nombre, fn) {
    total++;
    try { await fn(); ok++; console.log(`  ✅ [PASS] ${nombre}`); }
    catch (e) { console.error(`  ❌ [FAIL] ${nombre}\n     ${e.message}`); }
}

// --- Simulaciones de MSAL y del cliente de Graph (antes de cargar los servicios) ---
const llamadas = [];
const cuentasSimuladas = [];
class PcaSimulado {
    constructor(config) { this.config = config; }
    getTokenCache() { return { getAllAccounts: async () => cuentasSimuladas }; }
    async acquireTokenSilent(req) { llamadas.push({ silent: req.scopes }); return { accessToken: 'token-delegado' }; }
}
const msalPath = require.resolve('@azure/msal-node');
require.cache[msalPath] = { id: msalPath, filename: msalPath, loaded: true, exports: { PublicClientApplication: PcaSimulado } };

const graphLib = require('@microsoft/microsoft-graph-client');
const initOriginal = graphLib.Client.init;
let authProviderCapturado = null;
graphLib.Client.init = ({ authProvider }) => {
    authProviderCapturado = authProvider;
    const api = (ruta) => {
        const q = {
            filter() { return q; }, top() { return q; }, select() { return q; },
            get: async () => { llamadas.push({ get: ruta }); return { value: [] }; },
            patch: async () => { llamadas.push({ patch: ruta }); },
            post: async (body) => { llamadas.push({ post: ruta, body }); }
        };
        return q;
    };
    return { api };
};

const graphAuth = require('../src/services/graphAuthService');
const { explicarError } = require('./graph-login');

(async () => {
    console.log('\n--- Modo y buzón ---');
    await prueba('Sin GRAPH_MODO el modo es "aplicacion"', () => {
        assert.strictEqual(graphAuth.modo({}), 'aplicacion');
        assert.strictEqual(graphAuth.modo({ GRAPH_MODO: 'cualquiera' }), 'aplicacion');
        assert.strictEqual(graphAuth.modo({ GRAPH_MODO: ' Delegado ' }), 'delegado');
    });
    await prueba('Ruta del buzón: /me en delegado, /users/<buzón> en aplicación', () => {
        assert.strictEqual(graphAuth.rutaBuzon({ GRAPH_MODO: 'delegado' }), '/me');
        assert.strictEqual(graphAuth.rutaBuzon({ GRAPH_NOC_MAILBOX: 'noc@empresa.com' }), '/users/noc%40empresa.com');
        assert.strictEqual(graphAuth.rutaBuzon({}), null);
    });
    await prueba('Archivo de sesión: por defecto en portal-KIp/.graph-sesion.json, o el de GRAPH_SESION_ARCHIVO', () => {
        assert.strictEqual(path.basename(graphAuth.archivoSesion({})), '.graph-sesion.json');
        assert.strictEqual(path.basename(path.dirname(graphAuth.archivoSesion({}))), 'portal-KIp');
        assert.strictEqual(graphAuth.archivoSesion({ GRAPH_SESION_ARCHIVO: '/tmp/x.json' }), path.resolve('/tmp/x.json'));
    });

    console.log('\n--- Sesión guardada ---');
    await prueba('La caché se guarda solo si cambió y se vuelve a leer', async () => {
        const archivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'graph-')), 'sesion.json');
        const plugin = graphAuth.pluginArchivo(archivo);
        let leido = null;
        const ctx = (cambio) => ({ cacheHasChanged: cambio, tokenCache: { serialize: () => '{"a":1}', deserialize: (t) => { leido = t; } } });
        await plugin.beforeCacheAccess(ctx(false));
        assert.strictEqual(leido, null, 'sin archivo no lee nada');
        await plugin.afterCacheAccess(ctx(false));
        assert.ok(!fs.existsSync(archivo), 'sin cambios no escribe');
        await plugin.afterCacheAccess(ctx(true));
        assert.strictEqual(fs.readFileSync(archivo, 'utf8'), '{"a":1}');
        await plugin.beforeCacheAccess(ctx(false));
        assert.strictEqual(leido, '{"a":1}');
    });
    await prueba('Sin sesión iniciada, el token falla con un mensaje que dice qué correr', async () => {
        const pca = new PcaSimulado({});
        cuentasSimuladas.length = 0;
        await assert.rejects(() => graphAuth.tokenDelegado(pca), (e) => e.code === 'SIN_SESION' && /graph-login/.test(e.message));
    });
    await prueba('Con sesión, pide el token en silencio con los permisos de correo', async () => {
        cuentasSimuladas.push({ username: 'prueba@empresa.com' });
        const t = await graphAuth.tokenDelegado(new PcaSimulado({}));
        assert.strictEqual(t, 'token-delegado');
        assert.deepStrictEqual(llamadas.pop().silent, ['Mail.ReadWrite', 'Mail.Send', 'offline_access']);
    });
    await prueba('Sin tenant usa "common" (cuentas personales y de organización)', () => {
        const pca = graphAuth.crearClientePublico({ GRAPH_CLIENT_ID: 'abc' });
        assert.strictEqual(pca.config.auth.authority, 'https://login.microsoftonline.com/common');
        assert.strictEqual(pca.config.auth.clientId, 'abc');
        assert.ok(!('clientSecret' in pca.config.auth), 'el modo delegado no lleva secreto');
        assert.throws(() => graphAuth.crearClientePublico({}), /GRAPH_CLIENT_ID/);
    });

    console.log('\n--- Ingesta y envío en modo delegado ---');
    process.env.GRAPH_MODO = 'delegado';
    process.env.GRAPH_CLIENT_ID = 'abc';
    delete process.env.GRAPH_NOC_MAILBOX;
    const mail = require('../src/services/emailIngestionService');
    await prueba('Lee la Bandeja de entrada del propio buzón (/me), sin GRAPH_NOC_MAILBOX', async () => {
        llamadas.length = 0;
        await mail.procesarCorreosEntrantes();
        assert.deepStrictEqual(llamadas, [{ get: '/me/mailFolders/inbox/messages' }]);
    });
    await prueba('El cliente de Graph usa el token de la sesión guardada', async () => {
        const token = await new Promise((res, rej) => authProviderCapturado((e, t) => e ? rej(e) : res(t)));
        assert.strictEqual(token, 'token-delegado');
    });
    await prueba('Responde desde el propio buzón (/me/sendMail)', async () => {
        llamadas.length = 0;
        const r = await mail.enviarCorreo({ para: 'Cliente <cliente@x.com>', asunto: 'Re: [INC-001] Caída', texto: 'Hola' });
        assert.deepStrictEqual(r, { enviado: true, configurado: true });
        assert.strictEqual(llamadas[0].post, '/me/sendMail');
        assert.strictEqual(llamadas[0].body.message.toRecipients[0].emailAddress.address, 'cliente@x.com');
    });

    console.log('\n--- Mensajes de ayuda del inicio de sesión ---');
    await prueba('Explica los errores comunes en español', () => {
        assert.match(explicarError({ message: 'AADSTS7000218: ...' }), /Allow public client flows/);
        assert.match(explicarError({ message: 'AADSTS65001: The user or administrator has not consented' }), /administrador/);
        assert.match(explicarError({ message: 'AADSTS50020: User account from identity provider does not exist in tenant' }), /directorio/);
        assert.strictEqual(explicarError({ message: 'otra cosa' }), null);
    });

    graphLib.Client.init = initOriginal;
    console.log(`\nResultado: ${ok}/${total} pruebas pasaron`);
    process.exit(ok === total ? 0 : 1);
})();
