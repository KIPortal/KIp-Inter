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

// Prisma simulado: la ingesta crea tickets en memoria
const ticketsCreados = [];
const prismaPath = require.resolve('../src/config/prisma');
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: {
    INCLUDE_DELETED: {},
    ticket: {
        findMany: async () => ticketsCreados.map(t => ({ codigo_incidencia: t.codigo_incidencia })),
        findUnique: async () => null,
        create: async ({ data }) => { ticketsCreados.push(data); return data; }
    },
    configuracion: { findMany: async () => [] }
} };

let correosSimulados = [];
const graphLib = require('@microsoft/microsoft-graph-client');
const initOriginal = graphLib.Client.init;
let authProviderCapturado = null;
graphLib.Client.init = ({ authProvider }) => {
    authProviderCapturado = authProvider;
    const api = (ruta) => {
        const pedido = { get: ruta };
        const q = {
            filter(f) { pedido.filter = f; return q; }, orderby(o) { pedido.orderby = o; return q; },
            top() { return q; }, select() { return q; },
            get: async () => { llamadas.push(pedido); return { value: correosSimulados }; },
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
        assert.deepStrictEqual(llamadas, [{ get: '/me/mailFolders/inbox/messages', filter: 'isRead eq false' }]);
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

    console.log('\n--- Solo lectura ---');
    const dirEstado = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-estado-'));
    const archivoEstado = path.join(dirEstado, 'estado.json');
    await prueba('Solo lectura pide solo Mail.Read (y offline_access)', () => {
        assert.strictEqual(graphAuth.soloLectura({ GRAPH_SOLO_LECTURA: 'si' }), true);
        assert.strictEqual(graphAuth.soloLectura({ GRAPH_SOLO_LECTURA: 'no' }), false);
        assert.strictEqual(graphAuth.soloLectura({}), false);
        assert.deepStrictEqual(graphAuth.scopesDelegados({ GRAPH_SOLO_LECTURA: 'Sí' }), ['Mail.Read', 'offline_access']);
    });
    await prueba('La marca avanza con cada correo y recuerda los que llegaron en el mismo instante', () => {
        let e = { desde: '2026-10-19T10:00:00.000Z', ids: [] };
        e = graphAuth.avanzarEstado(e, { id: 'a', receivedDateTime: '2026-10-19T10:00:00Z' });
        assert.deepStrictEqual(e, { desde: '2026-10-19T10:00:00.000Z', ids: ['a'] });
        e = graphAuth.avanzarEstado(e, { id: 'b', receivedDateTime: '2026-10-19T10:05:00Z' });
        assert.deepStrictEqual(e, { desde: '2026-10-19T10:05:00.000Z', ids: ['b'] });
        assert.deepStrictEqual(graphAuth.avanzarEstado(e, { id: 'viejo', receivedDateTime: '2026-10-19T09:00:00Z' }), e);
    });
    await prueba('El estado se guarda y se lee; un archivo dañado cuenta como "nunca se leyó"', () => {
        assert.strictEqual(graphAuth.leerEstado(archivoEstado), null);
        graphAuth.guardarEstado({ desde: '2026-10-19T10:00:00.000Z', ids: ['x'] }, archivoEstado);
        assert.deepStrictEqual(graphAuth.leerEstado(archivoEstado), { desde: '2026-10-19T10:00:00.000Z', ids: ['x'] });
        fs.writeFileSync(archivoEstado, 'no es json');
        assert.strictEqual(graphAuth.leerEstado(archivoEstado), null);
        fs.unlinkSync(archivoEstado);
    });
    process.env.GRAPH_SOLO_LECTURA = 'si';
    process.env.GRAPH_ESTADO_ARCHIVO = archivoEstado;
    await prueba('La primera vez no importa correos viejos: solo guarda la hora de inicio', async () => {
        llamadas.length = 0;
        await mail.procesarCorreosEntrantes();
        assert.deepStrictEqual(llamadas, [], 'no consulta el buzón');
        const e = graphAuth.leerEstado(archivoEstado);
        assert.ok(e && Math.abs(Date.parse(e.desde) - Date.now()) < 5000);
    });
    await prueba('Lee los nuevos por fecha, crea el ticket y no marca nada en el buzón', async () => {
        graphAuth.guardarEstado({ desde: '2026-10-19T10:00:00.000Z', ids: ['ya'] }, archivoEstado);
        correosSimulados = [
            { id: 'ya', subject: 'Repetido', bodyPreview: '', from: { emailAddress: { address: 'c@x.com' } }, receivedDateTime: '2026-10-19T10:00:00Z' },
            { id: 'nuevo', subject: 'Caída enlace', bodyPreview: 'sin servicio', from: { emailAddress: { address: 'c@x.com' } }, receivedDateTime: '2026-10-19T10:07:00Z' }
        ];
        llamadas.length = 0;
        ticketsCreados.length = 0;
        await mail.procesarCorreosEntrantes();
        assert.deepStrictEqual(llamadas, [{
            get: '/me/mailFolders/inbox/messages',
            filter: 'receivedDateTime ge 2026-10-19T10:00:00.000Z',
            orderby: 'receivedDateTime asc'
        }], 'una sola consulta y ningún PATCH');
        assert.deepStrictEqual(ticketsCreados.map(t => [t.codigo_incidencia, t.asunto]), [['INC-001', 'Caída enlace']]);
        assert.deepStrictEqual(graphAuth.leerEstado(archivoEstado), { desde: '2026-10-19T10:07:00.000Z', ids: ['nuevo'] });
        correosSimulados = [];
    });
    await prueba('En solo lectura no envía respuestas', async () => {
        llamadas.length = 0;
        const r = await mail.enviarCorreo({ para: 'cliente@x.com', asunto: 'Re', texto: 'Hola' });
        assert.deepStrictEqual(r, { enviado: false, configurado: false, soloLectura: true });
        assert.deepStrictEqual(llamadas, []);
    });
    delete process.env.GRAPH_SOLO_LECTURA;

    console.log('\n--- Mensajes de ayuda del inicio de sesión ---');
    await prueba('Explica los errores comunes en español', () => {
        assert.match(explicarError({ message: 'AADSTS7000218: ...' }), /Allow public client flows/);
        assert.match(explicarError({ message: 'AADSTS65001: The user or administrator has not consented' }), /administrador/);
        assert.match(explicarError({ message: 'AADSTS50020: User account from identity provider does not exist in tenant' }), /directorio/);
        assert.match(explicarError({ message: 'AADSTS53003: Access has been blocked by Conditional Access policies' }), /--navegador/);
        assert.match(explicarError({ message: 'AADSTS500113: No reply address is registered for the application' }), /http:\/\/localhost/);
        assert.strictEqual(explicarError({ message: 'otra cosa' }), null);
    });

    graphLib.Client.init = initOriginal;
    console.log(`\nResultado: ${ok}/${total} pruebas pasaron`);
    process.exit(ok === total ? 0 : 1);
})();
