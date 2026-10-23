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
// Carpetas de cada cuenta: { top: [...], hijos: { <id padre>: [...] } } (la Bandeja de entrada es 'inbox')
let carpetas = {};
const graphLib = require('@microsoft/microsoft-graph-client');
graphLib.Client.initWithMiddleware = () => ({
    api(ruta) {
        const pedido = { ruta };
        const q = {
            filter(f) { pedido.filter = f; return q; }, orderby() { return q; }, top() { return q; }, select() { return q; },
            async get() {
                llamadas.push({ get: ruta, filter: pedido.filter });
                const m = ruta.match(/^\/users\/([^/]+)\/mailFolders(?:\/([^/]+))?(?:\/(childFolders|messages))?$/) || [];
                const correo = decodeURIComponent(m[1] || '');
                const nombre = ((pedido.filter || '').match(/^displayName eq '(.*)'$/) || [])[1];
                const filtrar = lista => (lista || []).filter(f => f.displayName === String(nombre).replace(/''/g, "'"));
                if (!m[2]) return { value: filtrar((carpetas[correo] || {}).top) };
                if (m[3] === 'childFolders') return { value: filtrar(((carpetas[correo] || {}).hijos || {})[m[2]]) };
                const clave = m[2] === 'inbox' ? correo : `${correo}:${m[2]}`;
                const b = bandejas[clave];
                if (b instanceof Error) throw b;
                const lista = b || [];
                bandejas[clave] = []; // ya leídos
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
            findMany: async ({ where = {} } = {}) => buzones.filter(b => (where.activo === undefined || b.activo === where.activo)
                && (where.eliminado_en !== null || !b.eliminado_en)),
            count: async ({ where = {} } = {}) => buzones.filter(b => where.eliminado_en !== null || !b.eliminado_en).length,
            findUnique: async ({ where }) => buzones.find(b => b.id === where.id) || null,
            findFirst: async ({ where }) => buzones.find(b => b.correo === where.correo && (b.carpeta || '') === where.carpeta) || null,
            create: async ({ data }) => {
                if (buzones.some(b => b.correo === data.correo && (b.carpeta || '') === data.carpeta)) throw Object.assign(new Error('único'), { code: 'P2002' });
                const b = { id: 'bz-' + (buzones.length + 1), activo: true, solo_lectura: false, eliminado_en: null, ...data };
                buzones.push(b);
                return b;
            },
            update: async ({ where, data }) => {
                const b = buzones.find(x => x.id === where.id);
                if (data.carpeta !== undefined && buzones.some(x => x !== b && x.correo === b.correo && (x.carpeta || '') === data.carpeta)) {
                    throw Object.assign(new Error('único'), { code: 'P2002' });
                }
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
        assert.deepStrictEqual(v.data, { correo: 'soporte@outlook.com', carpeta: '', area_codigo: 'REDES_FTTH', subgrupo_id: 'sg-soporte', solo_lectura: false });
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

    await t('Carpeta: vacía, "inbox" o "Bandeja de entrada" = Bandeja de entrada; acepta / o \\ para subcarpetas', () => {
        assert.strictEqual(bz.normalizarCarpeta(''), '');
        assert.strictEqual(bz.normalizarCarpeta(' Inbox '), '');
        assert.strictEqual(bz.normalizarCarpeta('bandeja de entrada'), '');
        assert.strictEqual(bz.normalizarCarpeta(' Soporte '), 'Soporte');
        assert.strictEqual(bz.normalizarCarpeta('Inbox\\Soporte//Urgente'), 'Inbox/Soporte/Urgente');
        assert.strictEqual(bz.normalizarCarpeta('x'.repeat(121)), null);
        assert.strictEqual(bz.validarBuzon({ correo: 'a@b.com', area: 'WAN', carpeta: 'Soporte' }).data.carpeta, 'Soporte');
        assert.match(bz.validarBuzon({ carpeta: 'x'.repeat(200) }, { parcial: true }).error, /carpeta/);
        assert.strictEqual(bz.etiquetaBuzon({ correo: 'a@b.com', carpeta: 'Soporte' }), 'a@b.com · Soporte');
        assert.strictEqual(bz.nombreCarpeta(''), 'Bandeja de entrada');
    });
    await t('Eliminar pide motivo de al menos 3 caracteres', () => {
        assert.match(bz.validarMotivo('  x ').error, /motivo/);
        assert.deepStrictEqual(bz.validarMotivo('  Se cerró la cuenta '), { motivo: 'Se cerró la cuenta' });
        assert.strictEqual(bz.validarMotivo('y'.repeat(400)).motivo.length, 300);
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
        assert.strictEqual(bz.buzonParaResponder({ buzon_id: 'bz-wan', area_designada: 'WAN' }, [{ ...WAN, eliminado_en: new Date() }]), null, 'en la papelera no responde');
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
        assert.strictEqual(path.basename(path.dirname(graphAuth.archivoEstadoBuzon('a@b.com', '', {}))), '.graph-estados');
        assert.strictEqual(path.basename(graphAuth.archivoSesionBuzon('../x@b.com', {})), '.._x@b.com.json', 'sin barras en el nombre');
        assert.strictEqual(path.basename(graphAuth.archivoEstadoBuzon('a@b.com', 'Soporte/Urgente', {})), 'a@b.com__soporte_urgente.json', 'estado por carpeta');
        assert.deepStrictEqual(graphAuth.scopesDelegados({}, { soloLectura: true }), ['Mail.Read', 'offline_access']);
    });
    await t('Al pasar el buzón del .env a la lista se reutiliza su sesión si es de esa cuenta', () => {
        const fs = require('fs');
        const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sesiones-'));
        const env = { GRAPH_SESION_ARCHIVO: path.join(dir, 'general.json'), GRAPH_SESIONES_DIR: path.join(dir, 'por-cuenta') };
        assert.strictEqual(graphAuth.sesionDeCuenta('ippruebas@outlook.com', env), null, 'sin sesiones');
        fs.writeFileSync(env.GRAPH_SESION_ARCHIVO, JSON.stringify({ Account: { k: { username: 'IPpruebas@outlook.com' } } }));
        assert.strictEqual(graphAuth.cuentaDeSesion(env.GRAPH_SESION_ARCHIVO), 'ippruebas@outlook.com');
        assert.strictEqual(graphAuth.sesionDeCuenta('ippruebas@outlook.com', env), env.GRAPH_SESION_ARCHIVO, 'usa la general');
        assert.strictEqual(graphAuth.sesionDeCuenta('otra@outlook.com', env), null, 'no la de otra cuenta');
        const propia = graphAuth.archivoSesionBuzon('ippruebas@outlook.com', env);
        fs.mkdirSync(path.dirname(propia), { recursive: true });
        fs.writeFileSync(propia, '{}');
        assert.strictEqual(graphAuth.sesionDeCuenta('ippruebas@outlook.com', env), propia, 'la propia tiene prioridad');
        fs.writeFileSync(env.GRAPH_SESION_ARCHIVO, 'dañado');
        assert.strictEqual(graphAuth.cuentaDeSesion(env.GRAPH_SESION_ARCHIVO), null);
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
    await t('Una cuenta con carpetas: cada carpeta va a su subgrupo, con una sola cuenta', async () => {
        const FTTX = 'fttx@outlook.com';
        const db = baseSimulada({ buzones: [
            { id: 'bz-in', correo: FTTX, carpeta: '', area_codigo: 'REDES_FTTH', subgrupo_id: null, activo: true },
            { id: 'bz-sop', correo: FTTX, carpeta: 'Soporte', area_codigo: 'REDES_FTTH', subgrupo_id: 'sg-soporte', activo: true },
            { id: 'bz-cab', correo: FTTX, carpeta: 'Clientes/Cabecera', area_codigo: 'REDES_FTTH', subgrupo_id: 'sg-cabecera', activo: true }
        ] });
        usar(db);
        // Soporte está dentro de la Bandeja de entrada; Clientes en el primer nivel y Cabecera dentro de Clientes
        carpetas = { [FTTX]: { top: [{ id: 'f-cli', displayName: 'Clientes' }], hijos: { inbox: [{ id: 'f-sop', displayName: 'Soporte' }], 'f-cli': [{ id: 'f-cab', displayName: 'Cabecera' }] } } };
        bandejas = { [FTTX]: [correo('c-in', 'General')], [`${FTTX}:f-sop`]: [correo('c-sop', 'ONU sin señal')], [`${FTTX}:f-cab`]: [correo('c-cab', 'OLT caída')] };
        llamadas.length = 0;
        await mail.revisarBuzones();
        assert.deepStrictEqual(db.tickets.map(x => [x.asunto, x.subgrupo_id || null, x.buzon_id]).sort(), [
            ['General', null, 'bz-in'], ['OLT caída', 'sg-cabecera', 'bz-cab'], ['ONU sin señal', 'sg-soporte', 'bz-sop']
        ].sort());
        assert.ok(db.buzones.every(b => b.ultimo_error === null), 'sin errores');
        // El id de la carpeta se busca una vez y se recuerda
        llamadas.length = 0;
        await mail.revisarBuzones();
        assert.ok(!llamadas.some(l => /childFolders|mailFolders$/.test(l.get)), 'no vuelve a buscar las carpetas');
    });
    await t('Carpeta que no existe: error claro en ese buzón; los demás se leen igual', async () => {
        const db = baseSimulada({ buzones: [
            { id: 'bz-mal', correo: 'x@outlook.com', carpeta: 'NoExiste', area_codigo: 'WAN', subgrupo_id: null, activo: true },
            { id: 'bz-ok', correo: 'y@outlook.com', carpeta: '', area_codigo: 'WAN', subgrupo_id: null, activo: true }
        ] });
        usar(db);
        carpetas = {};
        bandejas = { 'y@outlook.com': [correo('y1', 'Hola')] };
        await mail.revisarBuzones();
        assert.match(db.buzones[0].ultimo_error, /No existe la carpeta "NoExiste" en x@outlook\.com\./);
        assert.strictEqual(db.tickets.length, 1);
    });
    await t('Un buzón en la papelera no se lee; si todos están en la papelera vuelve el del .env', async () => {
        const db = baseSimulada({ buzones: [{ ...WAN, eliminado_en: new Date() }, { ...SOPORTE }] });
        assert.deepStrictEqual((await mail.buzonesActivos(db)).map(b => b.id), ['bz-soporte']);
        const [legado] = await mail.buzonesActivos(baseSimulada({ buzones: [{ ...WAN, eliminado_en: new Date() }] }));
        assert.ok(legado.legado);
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

    await t('Mismo correo con otra carpeta se puede; correo y carpeta repetidos → 409 (y avisa si está en la papelera)', async () => {
        const db = baseSimulada({ buzones: [{ ...SOPORTE, carpeta: '' }, { ...WAN, carpeta: 'Viejos', eliminado_en: new Date() }] });
        usar(db);
        let r = res();
        await admin.createBuzon({ body: { correo: 'soporte@outlook.com', carpeta: 'Cabecera', area: 'REDES_FTTH', subgrupo: 'sg-cabecera' }, user: { id: 'u1' } }, r);
        assert.strictEqual(r.code, 201);
        assert.strictEqual(r.body.buzon.carpetaNombre, 'Cabecera');
        r = res();
        await admin.createBuzon({ body: { correo: 'soporte@outlook.com', carpeta: 'inbox', area: 'WAN' }, user: { id: 'u1' } }, r);
        assert.strictEqual(r.code, 409, '"inbox" es la Bandeja de entrada, ya existe');
        assert.match(r.body.error, /Ya hay un buzón/);
        r = res();
        await admin.createBuzon({ body: { correo: 'wan@outlook.com', carpeta: 'Viejos', area: 'WAN' }, user: { id: 'u1' } }, r);
        assert.strictEqual(r.code, 409);
        assert.match(r.body.error, /papelera/);
    });
    await t('Eliminar: pide motivo, va a la papelera y queda en Auditoría; no se edita ni se elimina dos veces; se restaura', async () => {
        const db = baseSimulada({ buzones: [{ ...SOPORTE, eliminado_en: null }] });
        usar(db);
        const req = (body = {}) => ({ params: { id: 'bz-soporte' }, body, user: { id: 'u1' } });
        let r = res();
        await admin.deleteBuzon(req({ motivo: 'x' }), r);
        assert.strictEqual(r.code, 400);
        r = res();
        await admin.deleteBuzon(req({ motivo: 'Se cambió de cuenta' }), r);
        assert.strictEqual(r.code, 200);
        assert.ok(r.body.buzon.eliminadoEn);
        assert.strictEqual(r.body.buzon.motivoEliminacion, 'Se cambió de cuenta');
        assert.strictEqual(db.auditorias.pop().accion, 'BUZON_ELIMINADO');
        r = res();
        await admin.deleteBuzon(req({ motivo: 'otra vez' }), r);
        assert.strictEqual(r.code, 409);
        r = res();
        await admin.updateBuzon(req({ soloLectura: true }), r);
        assert.strictEqual(r.code, 409, 'en la papelera no se edita');
        r = res();
        await admin.restoreBuzon(req(), r);
        assert.strictEqual(r.code, 200);
        assert.strictEqual(r.body.buzon.eliminadoEn, null);
        assert.strictEqual(db.auditorias.pop().accion, 'BUZON_RESTAURADO');
        r = res();
        await admin.restoreBuzon(req(), r);
        assert.strictEqual(r.code, 409);
    });
    await t('La respuesta de un ticket cuyo buzón está en la papelera sale por otro buzón de su área', async () => {
        usar(baseSimulada({ buzones: [{ ...SOPORTE, eliminado_en: new Date() }, { id: 'bz-fttx', correo: 'fttx@outlook.com', carpeta: '', area_codigo: 'REDES_FTTH', subgrupo_id: null, activo: true }] }));
        llamadas.length = 0;
        await mail.enviarCorreo({ para: 'c@x.com', asunto: 'Re', texto: 'Hola', ticket: { buzon_id: 'bz-soporte', area_designada: 'REDES_FTTH', subgrupo_id: 'sg-soporte' } });
        assert.strictEqual(llamadas[0].post, '/users/fttx%40outlook.com/sendMail');
    });

    console.log(`\nResultado: ${passed}/${total} pruebas pasaron`);
    process.exit(passed === total ? 0 : 1);
})();
