// Pruebas de los buzones de correo (tabla Buzon): validación, destino de los tickets,
// buzón de respuesta, ingesta de varios buzones y Administración. Sin base de datos ni red.
const assert = require('assert');
const path = require('path');

// Prisma carga el .env al iniciarse: primero Prisma, luego las variables de la prueba
const prisma = require('../src/config/prisma');
// Modo aplicación con credenciales de mentira (antes de cargar la ingesta)
process.env.GRAPH_MODO = 'aplicacion';
process.env.GRAPH_TENANT_ID = 'tenant';
process.env.GRAPH_CLIENT_ID = 'cliente';
process.env.GRAPH_CLIENT_SECRET = 'secreto';
delete process.env.GRAPH_NOC_MAILBOX;
delete process.env.GRAPH_SOLO_LECTURA;

// Graph simulado: cada buzón (/users/<correo>) devuelve sus correos o falla
const llamadas = [];
let bandejas = {};
const graphLib = require('@microsoft/microsoft-graph-client');
graphLib.Client.initWithMiddleware = () => ({
    api(ruta) {
        const pedido = { ruta };
        const q = {
            filter(f) { pedido.filter = f; return q; }, orderby() { return q; }, top() { return q; }, select() { return q; },
            async get() {
                llamadas.push({ get: ruta });
                const correo = decodeURIComponent((ruta.match(/^\/users\/([^/]+)/) || [])[1] || '');
                const b = bandejas[correo];
                if (b instanceof Error) throw b;
                const lista = b || [];
                bandejas[correo] = []; // ya leídos
                return { value: lista };
            },
            async patch() { llamadas.push({ patch: ruta }); },
            async post(body) { llamadas.push({ post: ruta, body }); }
        };
        return q;
    }
});

const { setAreas, setSubgrupos } = require('../src/services/areaCatalog');
const bz = require('../src/services/buzonService');
const graphAuth = require('../src/services/graphAuthService');
const mail = require('../src/services/emailIngestionService');
const admin = require('../src/controllers/adminController');
const { opciones, esCuentaDelBuzon } = require('./graph-login');

let total = 0, passed = 0;
async function t(name, fn) { total++; try { await fn(); passed++; console.log(`  ✅ [PASS] ${name}`); } catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.stack.split('\n').slice(0, 2).join('\n     ')}`); } }
const res = () => { const r = { code: 200 }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };

setAreas([
    { codigo: 'GENERAL', nombre: 'General' },
    { codigo: 'REDES_FTTH', nombre: 'FTTx' },
    { codigo: 'WAN', nombre: 'WAN' },
    { codigo: 'VIEJA', nombre: 'Área vieja', activa: false }
]);
setSubgrupos([
    { id: 'sg-soporte', area_codigo: 'REDES_FTTH', nombre: 'Soporte' },
    { id: 'sg-cabecera', area_codigo: 'REDES_FTTH', nombre: 'Cabecera' },
    { id: 'sg-off', area_codigo: 'REDES_FTTH', nombre: 'Antiguo', activo: false }
]);

const SOPORTE = { id: 'bz-soporte', correo: 'soporte@outlook.com', area_codigo: 'REDES_FTTH', subgrupo_id: 'sg-soporte', activo: true, solo_lectura: false };
const WAN = { id: 'bz-wan', correo: 'wan@outlook.com', area_codigo: 'WAN', subgrupo_id: null, activo: true, solo_lectura: false };
const correo = (id, asunto, extra = {}) => ({
    id, internetMessageId: `<${id}@mail>`, subject: asunto, bodyPreview: 'texto', body: { contentType: 'text', content: 'texto' },
    from: { emailAddress: { address: 'cliente@x.com' } }, receivedDateTime: '2026-10-23T12:00:00Z', ...extra
});

// Base simulada (en memoria)
function baseSimulada({ buzones = [], tickets = [], mensajes = [] } = {}) {
    const db = {
        INCLUDE_DELETED: prisma.INCLUDE_DELETED,
        buzones, tickets, mensajes, auditorias: [], anotaciones: [],
        buzon: {
            findMany: async ({ where } = {}) => buzones.filter(b => !where || where.activo === undefined || b.activo === where.activo),
            count: async () => buzones.length,
            findUnique: async ({ where }) => buzones.find(b => b.id === where.id) || null,
            create: async ({ data }) => {
                if (buzones.some(b => b.correo === data.correo)) throw Object.assign(new Error('único'), { code: 'P2002' });
                const b = { id: 'bz-' + (buzones.length + 1), activo: true, solo_lectura: false, ...data };
                buzones.push(b);
                return b;
            },
            update: async ({ where, data }) => {
                const b = buzones.find(x => x.id === where.id);
                Object.assign(b, data);
                db.anotaciones.push({ id: where.id, ...data });
                return b;
            }
        },
        ticket: {
            findMany: async () => tickets.map(x => ({ codigo_incidencia: x.codigo_incidencia })),
            findFirst: async ({ where }) => tickets.find(x => x.correo_id === where.AND[0].correo_id) || null,
            findUnique: async ({ where }) => tickets.find(x => x.codigo_incidencia === where.codigo_incidencia) || null,
            create: async ({ data }) => {
                if (data.correo_id && tickets.some(x => x.correo_id === data.correo_id)) throw Object.assign(new Error('único'), { code: 'P2002', meta: { target: ['correo_id'] } });
                const x = { id: 't' + (tickets.length + 1), ...data };
                tickets.push(x);
                return x;
            },
            updateMany: async () => ({ count: 0 })
        },
        mensaje: {
            findFirst: async ({ where }) => mensajes.find(m => m.correo_id === where.correo_id) || null,
            create: async ({ data }) => { mensajes.push(data); return data; }
        },
        user: { findFirst: async () => null },
        auditLog: { create: async ({ data }) => { db.auditorias.push(data); return data; } },
        configuracion: { findMany: async () => [] }
    };
    return db;
}
const usar = (db) => Object.assign(prisma, { buzon: db.buzon, ticket: db.ticket, mensaje: db.mensaje, user: db.user, auditLog: db.auditLog, configuracion: db.configuracion });
const sinReglas = async () => null;

(async () => {
    console.log('\n=== PRUEBAS: BUZONES DE CORREO ===\n');

    console.log('--- Validación ---');
    await t('Crear: correo en minúsculas, área y subgrupo; solo lectura apagada por defecto', () => {
        const v = bz.validarBuzon({ correo: '  Soporte@Outlook.com ', area: 'REDES_FTTH', subgrupo: 'sg-soporte' });
        assert.deepStrictEqual(v.data, { correo: 'soporte@outlook.com', area_codigo: 'REDES_FTTH', subgrupo_id: 'sg-soporte', solo_lectura: false });
    });
    await t('Rechaza correo inválido, área desactivada y subgrupo de otra área o desactivado', () => {
        assert.match(bz.validarBuzon({ correo: 'no-es-correo', area: 'WAN' }).error, /correo/);
        assert.match(bz.validarBuzon({ correo: 'a@b.com', area: 'VIEJA' }).error, /Área/);
        assert.match(bz.validarBuzon({ correo: 'a@b.com', area: 'WAN', subgrupo: 'sg-soporte' }).error, /subgrupo/);
        assert.match(bz.validarBuzon({ correo: 'a@b.com', area: 'REDES_FTTH', subgrupo: 'sg-off' }).error, /subgrupo/);
        assert.match(bz.validarBuzon({ soloLectura: 'si' }, { parcial: true }).error, /Solo lectura/);
    });
    await t('Editar: no toca el correo; al cambiar de área el subgrupo se vuelve a validar', () => {
        assert.deepStrictEqual(bz.validarBuzon({ correo: 'otro@x.com', activo: false }, { parcial: true }).data, { activo: false });
        assert.deepStrictEqual(bz.validarBuzon({ area: 'WAN' }, { parcial: true }).data, { area_codigo: 'WAN', subgrupo_id: null });
    });

    console.log('\n--- Destino y respuesta ---');
    await t('Los tickets del buzón de Soporte caen en FTTx/Soporte', () => {
        assert.deepStrictEqual(bz.destinoDeBuzon(SOPORTE), { area_designada: 'REDES_FTTH', subgrupo_id: 'sg-soporte' });
        assert.deepStrictEqual(bz.destinoDeBuzon(WAN), { area_designada: 'WAN', subgrupo_id: null });
    });
    await t('Subgrupo desactivado → el área sin subgrupo; área desactivada → General', () => {
        assert.deepStrictEqual(bz.destinoDeBuzon({ ...SOPORTE, subgrupo_id: 'sg-off' }), { area_designada: 'REDES_FTTH', subgrupo_id: null });
        assert.deepStrictEqual(bz.destinoDeBuzon({ area_codigo: 'VIEJA', subgrupo_id: null }), { area_designada: 'GENERAL', subgrupo_id: null });
    });
    await t('Responde por el buzón del ticket; si no lo tiene, por uno de su área (subgrupo primero)', () => {
        const FTTX = { id: 'bz-fttx', correo: 'fttx@x.com', area_codigo: 'REDES_FTTH', subgrupo_id: null, activo: true };
        const lista = [WAN, FTTX, SOPORTE];
        assert.strictEqual(bz.buzonParaResponder({ buzon_id: 'bz-wan', area_designada: 'REDES_FTTH' }, lista), WAN);
        assert.strictEqual(bz.buzonParaResponder({ area_designada: 'REDES_FTTH', subgrupo_id: 'sg-soporte' }, lista), SOPORTE);
        assert.strictEqual(bz.buzonParaResponder({ area_designada: 'REDES_FTTH', subgrupo_id: 'sg-cabecera' }, lista), FTTX);
        assert.strictEqual(bz.buzonParaResponder({ buzon_id: 'bz-x', area_designada: 'GENERAL' }, lista), null);
        assert.strictEqual(bz.buzonParaResponder({ buzon_id: 'bz-wan', area_designada: 'WAN' }, [{ ...WAN, activo: false }]), null);
    });
    await t('El error que se guarda es corto (primera frase, máx. 300)', () => {
        assert.strictEqual(bz.textoError(new Error('Access is denied. Check credentials and try again.')), 'Access is denied.');
        assert.strictEqual(bz.textoError(null), null);
        assert.ok(bz.textoError('x'.repeat(500)).length <= 300);
    });

    console.log('\n--- Sesiones por buzón ---');
    await t('Cada buzón guarda su sesión y su estado en su archivo', () => {
        assert.strictEqual(path.basename(graphAuth.archivoSesionBuzon('Soporte@Outlook.com', {})), 'soporte@outlook.com.json');
        assert.strictEqual(path.basename(path.dirname(graphAuth.archivoSesionBuzon('a@b.com', {}))), '.graph-sesiones');
        assert.strictEqual(path.basename(path.dirname(graphAuth.archivoEstadoBuzon('a@b.com', {}))), '.graph-estados');
        assert.strictEqual(path.basename(graphAuth.archivoSesionBuzon('../x@b.com', {})), '.._x@b.com.json', 'sin barras en el nombre');
        assert.deepStrictEqual(graphAuth.scopesDelegados({}, { soloLectura: true }), ['Mail.Read', 'offline_access']);
    });
    await t('graph-login: --buzon=, --salir, --solo-lectura; la cuenta tiene que ser la del buzón', () => {
        assert.deepStrictEqual(opciones(['node', 'x', '--buzon=Soporte@Outlook.com', '--salir']), { buzon: 'soporte@outlook.com', buzonDado: true, salir: true, soloLectura: false });
        assert.strictEqual(opciones(['node', 'x', '--buzon=nada']).buzon, null);
        assert.strictEqual(opciones(['node', 'x']).buzonDado, false);
        assert.ok(esCuentaDelBuzon('Soporte@outlook.com', 'soporte@outlook.com'));
        assert.ok(!esCuentaDelBuzon('otra@outlook.com', 'soporte@outlook.com'));
        assert.ok(esCuentaDelBuzon('cualquiera@x.com', null));
    });

    console.log('\n--- Ingesta ---');
    await t('Correo nuevo del buzón de Soporte → ticket en FTTx/Soporte con su buzón y el id del correo', async () => {
        const db = baseSimulada();
        assert.strictEqual(await mail.procesarCorreo(correo('m1', 'Sin servicio'), SOPORTE, sinReglas, db), 'nuevo');
        const [x] = db.tickets;
        assert.strictEqual(x.codigo_incidencia, 'INC-001');
        assert.strictEqual(x.area_designada, 'REDES_FTTH');
        assert.strictEqual(x.subgrupo_id, 'sg-soporte');
        assert.strictEqual(x.buzon_id, 'bz-soporte');
        assert.strictEqual(x.correo_id, '<m1@mail>');
    });
    await t('El mismo correo en copia a dos buzones crea un solo ticket', async () => {
        const db = baseSimulada();
        await mail.procesarCorreo(correo('m1', 'Caída'), SOPORTE, sinReglas, db);
        assert.strictEqual(await mail.procesarCorreo(correo('m1', 'Caída'), WAN, sinReglas, db), 'repetido');
        assert.strictEqual(db.tickets.length, 1);
    });
    await t('Si otro buzón lo guarda al mismo tiempo (P2002 en correo_id), cuenta como repetido', async () => {
        const db = baseSimulada();
        db.ticket.findFirst = async () => null; // la revisión previa no lo ve
        await mail.procesarCorreo(correo('m1', 'Caída'), SOPORTE, sinReglas, db);
        assert.strictEqual(await mail.procesarCorreo(correo('m1', 'Caída'), WAN, sinReglas, db), 'repetido');
    });
    await t('Respuesta a un INC-xxx: va a la conversación con su id; la copia en el otro buzón no se repite', async () => {
        const db = baseSimulada({ tickets: [{ id: 't1', codigo_incidencia: 'INC-001', estado_actual: 'EN_PROGRESO' }] });
        assert.strictEqual(await mail.procesarCorreo(correo('r1', 'RE: [INC-001] Caída'), SOPORTE, sinReglas, db), 'respuesta');
        assert.strictEqual(db.mensajes[0].correo_id, '<r1@mail>');
        assert.strictEqual(await mail.procesarCorreo(correo('r1', 'RE: [INC-001] Caída'), WAN, sinReglas, db), 'repetido');
        assert.strictEqual(db.mensajes.length, 1);
    });
    await t('Buzones a revisar: los activos; ninguno activo = ninguno; tabla vacía o sin migrar = el del .env', async () => {
        assert.deepStrictEqual(await mail.buzonesActivos(baseSimulada({ buzones: [SOPORTE, { ...WAN, activo: false }] })), [SOPORTE]);
        assert.deepStrictEqual(await mail.buzonesActivos(baseSimulada({ buzones: [{ ...WAN, activo: false }] })), []);
        const [legado] = await mail.buzonesActivos(baseSimulada());
        assert.ok(legado.legado && legado.area_codigo === 'GENERAL');
        const [sinTabla] = await mail.buzonesActivos({});
        assert.ok(sinTabla.legado);
    });
    await t('La revisión se anota al empezar, al cambiar el error y cada 5 min; el buzón del .env no se anota', async () => {
        const db = baseSimulada({ buzones: [{ ...WAN, id: 'bz-anota' }] });
        const b = db.buzones[0];
        const t0 = new Date('2026-10-23T12:00:00Z');
        const mas = (min) => new Date(t0.getTime() + min * 60000);
        assert.strictEqual(await mail.anotarRevision(b, null, db, t0), true);
        assert.strictEqual(await mail.anotarRevision(b, null, db, mas(1)), false, 'sin cambios, no escribe');
        assert.strictEqual(await mail.anotarRevision(b, new Error('Access denied'), db, mas(2)), true, 'error nuevo, enseguida');
        assert.strictEqual(b.ultimo_error, 'Access denied');
        assert.strictEqual(await mail.anotarRevision(b, null, db, mas(3)), true, 'se arregló, enseguida');
        assert.strictEqual(await mail.anotarRevision(b, null, db, mas(9)), true, 'pasaron 5 min');
        assert.strictEqual(await mail.anotarRevision({ legado: true, id: null }, null, db, t0), false);
    });
    await t('Una vuelta lee cada buzón por su ruta; uno con error no detiene al otro y su error queda anotado', async () => {
        const db = baseSimulada({ buzones: [{ ...SOPORTE }, { ...WAN }] });
        usar(db);
        bandejas = { 'soporte@outlook.com': new Error('Mailbox not found. Revisa el correo.'), 'wan@outlook.com': [correo('w1', 'Enlace caído')] };
        llamadas.length = 0;
        await mail.revisarBuzones();
        assert.ok(llamadas.some(l => l.get === '/users/soporte%40outlook.com/mailFolders/inbox/messages'));
        assert.ok(llamadas.some(l => l.patch === '/users/wan%40outlook.com/messages/w1'), 'marca leído en su buzón');
        assert.deepStrictEqual(db.tickets.map(x => [x.area_designada, x.buzon_id]), [['WAN', 'bz-wan']]);
        assert.strictEqual(db.buzones.find(b => b.id === 'bz-soporte').ultimo_error, 'Mailbox not found.');
        assert.strictEqual(db.buzones.find(b => b.id === 'bz-wan').ultimo_error, null);
    });
    await t('Un buzón en solo lectura no marca leídos (la primera vez solo guarda la hora de inicio)', async () => {
        const os = require('os');
        process.env.GRAPH_ESTADOS_DIR = require('fs').mkdtempSync(path.join(os.tmpdir(), 'buzon-estado-'));
        const db = baseSimulada({ buzones: [{ ...SOPORTE, id: 'bz-ro', correo: 'ro@x.com', solo_lectura: true }] });
        usar(db);
        bandejas = { 'ro@x.com': [correo('x1', 'Algo')] };
        llamadas.length = 0;
        await mail.revisarBuzones();
        assert.deepStrictEqual(llamadas, [], 'primera vez: no consulta');
        assert.ok(graphAuth.leerEstado(graphAuth.archivoEstadoBuzon('ro@x.com')));
        delete process.env.GRAPH_ESTADOS_DIR;
    });

    console.log('\n--- Envío de respuestas ---');
    await t('La respuesta sale por el buzón del ticket', async () => {
        usar(baseSimulada({ buzones: [{ ...SOPORTE }, { ...WAN }] }));
        llamadas.length = 0;
        const r = await mail.enviarCorreo({ para: 'cliente@x.com', asunto: 'Re', texto: 'Hola', ticket: { buzon_id: 'bz-wan', area_designada: 'WAN' } });
        assert.deepStrictEqual(r, { enviado: true, configurado: true });
        assert.strictEqual(llamadas[0].post, '/users/wan%40outlook.com/sendMail');
    });
    await t('Sin buzón que sirva: se guarda sin enviar; buzón en solo lectura: tampoco envía', async () => {
        usar(baseSimulada({ buzones: [{ ...WAN }] }));
        assert.deepStrictEqual(await mail.enviarCorreo({ para: 'c@x.com', asunto: 'Re', texto: 'Hola', ticket: { area_designada: 'GENERAL' } }), { enviado: false, configurado: false });
        usar(baseSimulada({ buzones: [{ ...WAN, solo_lectura: true }] }));
        assert.deepStrictEqual(await mail.enviarCorreo({ para: 'c@x.com', asunto: 'Re', texto: 'Hola', ticket: { buzon_id: 'bz-wan' } }), { enviado: false, configurado: false, soloLectura: true });
    });
    await t('Sin buzones en la tabla usa GRAPH_NOC_MAILBOX', async () => {
        usar(baseSimulada());
        process.env.GRAPH_NOC_MAILBOX = 'noc@empresa.com';
        llamadas.length = 0;
        await mail.enviarCorreo({ para: 'c@x.com', asunto: 'Re', texto: 'Hola', ticket: { area_designada: 'GENERAL' } });
        assert.strictEqual(llamadas[0].post, '/users/noc%40empresa.com/sendMail');
        delete process.env.GRAPH_NOC_MAILBOX;
    });

    console.log('\n--- Administración ---');
    await t('Crear buzón: 201, queda en Auditoría; correo repetido → 409; datos malos → 400', async () => {
        const db = baseSimulada();
        usar(db);
        const req = { body: { correo: 'Soporte@outlook.com', area: 'REDES_FTTH', subgrupo: 'sg-soporte' }, user: { id: 'u1' } };
        let r = res();
        await admin.createBuzon(req, r);
        assert.strictEqual(r.code, 201);
        assert.strictEqual(r.body.buzon.correo, 'soporte@outlook.com');
        assert.strictEqual(r.body.buzon.subgrupoNombre, 'Soporte');
        assert.strictEqual(db.auditorias[0].accion, 'BUZON_CREADO');
        r = res();
        await admin.createBuzon(req, r);
        assert.strictEqual(r.code, 409);
        r = res();
        await admin.createBuzon({ body: { correo: 'x', area: 'WAN' }, user: { id: 'u1' } }, r);
        assert.strictEqual(r.code, 400);
    });
    await t('Editar buzón: cambiar de área quita el subgrupo; sin cambios no audita; 404 si no existe', async () => {
        const db = baseSimulada({ buzones: [{ ...SOPORTE }] });
        usar(db);
        let r = res();
        await admin.updateBuzon({ params: { id: 'bz-soporte' }, body: { soloLectura: false }, user: { id: 'u1' } }, r);
        assert.strictEqual(db.auditorias.length, 0, 'nada cambió');
        assert.strictEqual(r.body.buzon.subgrupo, 'sg-soporte', 'sin mandar área ni subgrupo, los conserva');
        r = res();
        await admin.updateBuzon({ params: { id: 'bz-soporte' }, body: { area: 'WAN', correo: 'otro@x.com' }, user: { id: 'u1' } }, r);
        assert.strictEqual(r.body.buzon.area, 'WAN');
        assert.strictEqual(r.body.buzon.subgrupo, '');
        assert.strictEqual(r.body.buzon.correo, 'soporte@outlook.com', 'el correo no cambia');
        assert.strictEqual(db.auditorias[0].accion, 'BUZON_EDITADO');
        r = res();
        await admin.updateBuzon({ params: { id: 'nada' }, body: {}, user: { id: 'u1' } }, r);
        assert.strictEqual(r.code, 404);
    });

    console.log(`\nResultado: ${passed}/${total} pruebas pasaron`);
    process.exit(passed === total ? 0 : 1);
})();
