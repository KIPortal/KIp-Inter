// Pruebas de los roles Jefe de área y Gerente, de Contactos y de los subgrupos de área.
// Sin base de datos: prisma se simula.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const prisma = require('../src/config/prisma');
const R = require('../src/services/roleService');

let total = 0, passed = 0;
async function t(name, fn) {
    total++;
    try { await fn(); passed++; console.log(`  ✅ [PASS] ${name}`); }
    catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`); }
}
function mockRes() {
    const r = { code: 200, body: null, view: null, locals: null };
    r.status = c => { r.code = c; return r; };
    r.json = b => { r.body = b; return r; };
    r.send = b => { r.body = b; return r; };
    r.render = (v, l) => { r.view = v; r.locals = l; return r; };
    r.redirect = (c, u) => { r.code = c; r.body = u; return r; };
    return r;
}
// Reemplaza métodos de prisma durante una prueba y los restaura
async function con(mocks, fn) {
    const prev = {};
    Object.keys(mocks).forEach(m => { prev[m] = prisma[m]; prisma[m] = Object.assign({}, prisma[m], mocks[m]); });
    try { await fn(); } finally { Object.keys(prev).forEach(m => { prisma[m] = prev[m]; }); }
}

const COORD = { id: 'c1', rol: 'COORDINADOR', area_designada: 'GENERAL' };
const JEFE = { id: 'j1', rol: 'JEFE', area_designada: 'WAN', nombre: 'Jefe WAN' };
const GER = { id: 'g1', rol: 'GERENTE', area_designada: 'GENERAL' };
const OP = { id: 'o1', rol: 'OPERADOR', area_designada: 'WAN' };

(async () => {
    console.log('\n=== Roles Jefe y Gerente, Contactos y subgrupos ===\n');

    await t('Quién supervisa, quién administra y qué ve cada uno', () => {
        assert.deepStrictEqual([COORD, JEFE, GER, OP].map(R.esSupervisor), [true, true, true, false]);
        assert.deepStrictEqual([COORD, JEFE, GER, OP].map(R.puedeAdministrar), [true, false, true, false]);
        assert.strictEqual(R.areaScope(COORD), null);
        assert.strictEqual(R.areaScope(GER), null);
        assert.strictEqual(R.areaScope(JEFE), 'WAN');
        assert.deepStrictEqual(R.ticketWhere(JEFE), { area_designada: { in: ['WAN', 'GENERAL'] } });
        assert.deepStrictEqual(R.ticketWhere(GER), {});
        assert.deepStrictEqual(R.personaWhere(JEFE), { area_designada: 'WAN' });
        assert.strictEqual(R.ticketEnAlcance(JEFE, 'TELEFONIA'), false);
        assert.strictEqual(R.ticketEnAlcance(JEFE, 'GENERAL'), true);
        assert.strictEqual(R.ticketEnAlcance(COORD, 'TELEFONIA'), true);
        // El jefe con "atiende tickets" también trabaja casos; el gerente no
        assert.strictEqual(R.atiendeTickets({ ...JEFE, atiende_tickets: true }), true);
        assert.strictEqual(R.atiendeTickets({ ...GER, atiende_tickets: true }), false);
    });

    await t('Solo el gerente da los roles Jefe y Gerente o edita a jefes y gerentes', () => {
        assert.strictEqual(R.motivoNoGestionar(GER, null, 'JEFE'), null);
        assert.strictEqual(R.motivoNoGestionar(GER, JEFE, 'OPERADOR'), null);
        assert.match(R.motivoNoGestionar(COORD, null, 'GERENTE'), /Solo el gerente/);
        assert.match(R.motivoNoGestionar(COORD, JEFE, undefined), /Solo el gerente/);
        assert.strictEqual(R.motivoNoGestionar(COORD, OP, 'COORDINADOR'), null);
        assert.match(R.motivoNoGestionar(JEFE, OP, 'OPERADOR'), /Permisos/);
    });

    await t('Middlewares: supervisor, administración y alcance del jefe', async () => {
        for (const [mw, user, ok] of [[R.authorizeSupervisor, JEFE, true], [R.authorizeSupervisor, OP, false], [R.authorizeAdmin, JEFE, false], [R.authorizeAdmin, GER, true]]) {
            let paso = false;
            const res = mockRes();
            mw({ user }, res, () => { paso = true; });
            assert.strictEqual(paso, ok, `${user.rol}`);
            if (!ok) assert.strictEqual(res.code, 403);
        }
        const { limitarAlArea } = require('../src/middlewares/areaScope');
        const tickets = { 'INC-001': 'WAN', 'INC-002': 'TELEFONIA', 'INC-003': 'GENERAL' };
        await con({
            ticket: { findMany: async ({ where }) => where.codigo_incidencia.in.map(c => ({ area_designada: tickets[c] })) },
            user: { findUnique: async ({ where }) => ({ area_designada: where.id === 'o1' ? 'WAN' : 'TELEFONIA' }) }
        }, async () => {
            const prueba = async (user, req) => { let paso = false; const res = mockRes(); await limitarAlArea({ user, params: {}, body: {}, ...req }, res, () => { paso = true; }); return paso ? 'ok' : res.body.error; };
            assert.strictEqual(await prueba(JEFE, { params: { ticketCode: 'INC-001' } }), 'ok');
            assert.strictEqual(await prueba(JEFE, { params: { ticketCode: 'INC-003' } }), 'ok', 'los sin clasificar también');
            assert.match(await prueba(JEFE, { params: { ticketCode: 'INC-002' } }), /otra área/);
            assert.match(await prueba(JEFE, { body: { ticketCodes: ['INC-001', 'INC-002'] } }), /otra área/);
            assert.match(await prueba(JEFE, { body: { ticketCode: 'INC-001', operatorId: 'o9' } }), /personas de tu área/);
            assert.strictEqual(await prueba(JEFE, { body: { ticketCode: 'INC-001', operatorId: 'o1' } }), 'ok');
            assert.match(await prueba(JEFE, { body: { areaDesignada: 'TELEFONIA' } }), /tu área/);
            assert.match(await prueba(JEFE, { body: { area_designada: 'TELEFONIA' } }), /tu área/);
            assert.strictEqual(await prueba(GER, { params: { ticketCode: 'INC-002' }, body: { operatorId: 'o9' } }), 'ok', 'el gerente asigna a cualquier área');
        });
    });

    await t('Administración: el coordinador no crea jefes; el gerente sí, y el jefe necesita su área', async () => {
        const ctrl = require('../src/controllers/adminController');
        let creado = null, gerentes = 1;
        await con({
            user: { count: async () => gerentes, findUnique: async ({ where }) => (where.id === 'j1' ? { ...JEFE, email: 'j@x.com', activo: true } : null), create: async ({ data }) => { creado = data; return { id: 'n1', ...data }; } },
            auditLog: { create: async () => ({}) }
        }, async () => {
            const nuevo = { nombre: 'Jefa Telefonía', email: 'jt@x.com', rol: 'JEFE', area: 'TELEFONIA', clave: 'abcd1234', telefono: '0212-555 1234 ext 12' };
            let r = mockRes();
            await ctrl.createUser({ body: nuevo, user: COORD }, r);
            assert.strictEqual(r.code, 403);
            assert.strictEqual(creado, null);
            r = mockRes();
            await ctrl.createUser({ body: { ...nuevo, area: 'GENERAL' }, user: GER }, r);
            assert.strictEqual(r.code, 400);
            assert.match(r.body.error, /necesita su área/);
            r = mockRes();
            await ctrl.createUser({ body: nuevo, user: GER }, r);
            assert.strictEqual(r.code, 201);
            assert.strictEqual(creado.rol, 'JEFE');
            assert.strictEqual(creado.telefono, '0212-555 1234 ext 12');
            assert.strictEqual(r.body.usuario.telefono, '0212-555 1234 ext 12');
            r = mockRes();
            await ctrl.updateUser({ params: { id: 'j1' }, body: { nombre: 'Otro nombre' }, user: COORD }, r);
            assert.strictEqual(r.code, 403, 'el coordinador no edita a un jefe');
            // Sin gerente activo, el coordinador nombra al primero
            gerentes = 0;
            r = mockRes();
            await ctrl.createUser({ body: { ...nuevo, email: 'g2@x.com', rol: 'GERENTE', area: 'GENERAL' }, user: COORD }, r);
            assert.strictEqual(r.code, 201, 'sin gerente, el coordinador nombra al primero');
            assert.strictEqual(R.motivoNoGestionar(COORD, null, 'GERENTE', { hayGerente: false }), null);
        });
    });

    await t('Teléfono: validación y texto para Auditoría', () => {
        const { validateUser, validatePhone, describeUser } = require('../src/services/userAdminService');
        assert.deepStrictEqual(validatePhone('  +58 (412) 123-4567 '), { telefono: '+58 (412) 123-4567' });
        assert.deepStrictEqual(validatePhone(''), { telefono: null });
        assert.ok(validatePhone('llámame').error);
        assert.ok(validateUser({ telefono: 'abc' }).error.includes('Teléfono'));
        assert.match(describeUser({ nombre: 'Ana', telefono: null }, { telefono: '1234' }), /teléfono: 1234/);
        assert.match(describeUser(null, { nombre: 'Ana', email: 'a@x.com', rol: 'JEFE', area_designada: 'WAN' }), /jefe de área/);
    });

    await t('El jefe toma tickets de su área y no de otra', async () => {
        const { claimTicket } = require('../src/controllers/ticketController');
        const jefe = { ...JEFE, atiende_tickets: true };
        let where = null;
        await con({
            ticket: {
                findUnique: async ({ where: w }) => (w.codigo_incidencia ? { id: 't1', estado_actual: 'NUEVO', asignado_a_id: null, puntos_complejidad: 1, area_designada: w.codigo_incidencia === 'INC-1' ? 'WAN' : 'TELEFONIA' } : { id: 't1', codigo_incidencia: 'INC-1' }),
                updateMany: async ({ where: w }) => { where = w; return { count: 1 }; }
            },
            auditLog: { create: async () => ({}) }
        }, async () => {
            const r = mockRes();
            await claimTicket({ params: { ticketCode: 'INC-2' }, user: jefe }, r);
            assert.strictEqual(r.code, 403);
            await claimTicket({ params: { ticketCode: 'INC-1' }, user: jefe }, mockRes());
            assert.deepStrictEqual(where.area_designada, { in: ['WAN', 'GENERAL'] });
        });
    });

    await t('Tickets, Turno y Reportes del jefe: solo su área', async () => {
        const consultas = [];
        await con({
            ticket: { findMany: async args => { consultas.push(args.where); return []; }, count: async () => 0, findFirst: async () => null },
            user: { findMany: async args => { consultas.push(args.where); return []; } },
            horarioOperador: { findMany: async () => [] },
            guardiaDia: { findMany: async () => [] },
            traspaso: { findFirst: async () => null },
            configuracion: { findMany: async () => [] }
        }, async () => {
            const dash = require('../src/controllers/dashboardController');
            const r = mockRes();
            await dash.renderTickets({ user: JEFE, query: {} }, r);
            assert.strictEqual(r.view, 'tickets');
            assert.ok(consultas.some(w => w && JSON.stringify(w).includes('"area_designada":{"in":["WAN","GENERAL"]}')), 'tickets de su área');
            assert.ok(consultas.some(w => w && w.area_designada === 'WAN' && w.activo === true), 'personas de su área');
            const rep = require('../src/controllers/reportController');
            const r2 = mockRes();
            await rep.renderReportes({ user: JEFE, query: { area: 'TELEFONIA' } }, r2);
            assert.strictEqual(r2.view, 'reportes');
            assert.deepStrictEqual(r2.locals.areasCatalogo.map(a => a.codigo), ['WAN']);
            assert.strictEqual(r2.locals.vista.area, 'WAN', 'el reporte se fija en su área');
        });
    });

    await t('Contactos: gerencia primero, jefes antes que operadores, enlace para llamar', () => {
        const { buildContacts, telHref } = require('../src/services/contactService');
        assert.strictEqual(telHref('0212-555 1234 ext 12'), 'tel:02125551234,12');
        assert.strictEqual(telHref('+58 (412) 123.45.67'), 'tel:+584121234567');
        assert.strictEqual(telHref(''), null);
        const v = buildContacts({
            usuarios: [
                { id: 'o1', nombre: 'Zoe Op', email: 'z@x.com', rol: 'OPERADOR', area_designada: 'WAN', telefono: '1234' },
                { id: 'j1', nombre: 'Ana Jefa', email: 'a@x.com', rol: 'JEFE', area_designada: 'WAN', telefono: null },
                { id: 'g1', nombre: 'Gina Gerente', email: 'g@x.com', rol: 'GERENTE', area_designada: 'GENERAL', telefono: '5555' }
            ],
            turnoPorId: new Map([['o1', { codigo: 'DE_GUARDIA', etiqueta: 'De guardia' }]]),
            yoId: 'o1'
        });
        assert.deepStrictEqual(v.grupos.map(g => g.nombre).slice(0, 1), ['Gerencia']);
        const wan = v.grupos.find(g => g.codigo === 'WAN');
        assert.deepStrictEqual(wan.personas.map(p => p.rolTxt), ['Jefe de área', 'Operador']);
        assert.deepStrictEqual(wan.personas[1].estado, { etiqueta: 'De guardia', grupo: 'guardia' });
        assert.strictEqual(wan.personas[1].esYo, true);
        assert.strictEqual(v.sinTelefono, 1);
        assert.deepStrictEqual(v.yo, { telefono: '1234' });
    });

    await t('Vistas: Contactos y barra lateral según el rol', () => {
        const { buildContacts } = require('../src/services/contactService');
        const file = path.join(__dirname, '..', 'views', 'contactos.ejs');
        const vista = buildContacts({ usuarios: [{ id: 'o1', nombre: 'Zoe <b>Op</b>', email: 'z@x.com', rol: 'OPERADOR', area_designada: 'WAN', telefono: '1234' }], yoId: 'o1' });
        const html = ejs.render(fs.readFileSync(file, 'utf8'), { currentUser: OP, vista }, { filename: file });
        assert.ok(html.includes('href="tel:1234"'));
        assert.ok(html.includes('Tu teléfono o extensión'));
        assert.ok(!html.includes('<b>Op</b>'), 'escapa el nombre');
        const sb = path.join(__dirname, '..', 'views', 'partials', 'sidebar.ejs');
        const tpl = fs.readFileSync(sb, 'utf8');
        const pinta = u => ejs.render(tpl, { currentUser: u, activo: '' }, { filename: sb });
        const jefe = pinta({ ...JEFE, atiende_tickets: true });
        assert.ok(jefe.includes('/reportes') && jefe.includes('/contactos') && jefe.includes('/mi-panel'));
        assert.ok(!jefe.includes('href="/admin"') && !jefe.includes('href="/auditoria"'), 'el jefe no administra');
        const ger = pinta(GER);
        assert.ok(ger.includes('href="/admin"') && ger.includes('href="/auditoria"'));
        assert.ok(pinta(OP).includes('/contactos'));
    });

    // ---------- Subgrupos (FTTx: Soporte y Cabecera) ----------
    const cat = require('../src/services/areaCatalog');
    cat.setSubgrupos([
        { id: 'sg-sop', area_codigo: 'REDES_FTTH', nombre: 'Soporte', activo: true },
        { id: 'sg-cab', area_codigo: 'REDES_FTTH', nombre: 'Cabecera', activo: true },
        { id: 'sg-old', area_codigo: 'REDES_FTTH', nombre: 'Viejo', activo: false }
    ]);

    await t('Subgrupos: catálogo por área, nombre y validez', () => {
        assert.deepStrictEqual(cat.subgruposDe('REDES_FTTH').map(g => g.nombre), ['Soporte', 'Cabecera']);
        assert.strictEqual(cat.subgruposDe('REDES_FTTH', { todos: true }).length, 3);
        assert.strictEqual(cat.subgrupoName('sg-cab'), 'Cabecera');
        assert.strictEqual(cat.isValidSubgrupo('sg-sop', 'REDES_FTTH'), true);
        assert.strictEqual(cat.isValidSubgrupo('sg-sop', 'WAN'), false, 'de otra área');
        assert.strictEqual(cat.isValidSubgrupo('sg-old', 'REDES_FTTH'), false, 'desactivado');
    });

    await t('Subgrupos en tickets: al crear se valida y al asignar toma el del operador', async () => {
        const tc = require('../src/controllers/ticketController');
        let r = mockRes();
        await tc.createTicket({ body: { asunto: 'X', areaDesignada: 'WAN', origenIngesta: 'COORDINADOR', prioridad: 'NONE', subgrupoId: 'sg-sop' }, user: COORD }, r);
        assert.strictEqual(r.code, 400);
        let creado = null, actualizado = null;
        await con({
            ticket: {
                create: async ({ data }) => { creado = data; return data; },
                findMany: async () => [],
                findUnique: async () => ({ id: 't1', estado_actual: 'NUEVO', asignado_a_id: null, area_designada: 'REDES_FTTH', subgrupo_id: null, asignado_a: null }),
                update: async ({ data }) => { actualizado = data; return { id: 't1', ...data }; }
            },
            user: { findFirst: async () => ({ id: 'o5', nombre: 'Enza', area_designada: 'REDES_FTTH', subgrupo_id: 'sg-cab' }) },
            auditLog: { create: async () => ({}) }
        }, async () => {
            r = mockRes();
            await tc.createTicket({ body: { asunto: 'OLT', areaDesignada: 'REDES_FTTH', origenIngesta: 'COORDINADOR', prioridad: 'NONE', subgrupoId: 'sg-sop' }, user: COORD }, r);
            assert.strictEqual(r.code, 201);
            assert.strictEqual(creado.subgrupo_id, 'sg-sop');
            r = mockRes();
            await tc.assignTicket({ body: { ticketCode: 'INC-1', operatorId: 'o5' }, user: COORD }, r);
            assert.strictEqual(r.code, 200);
            assert.strictEqual(actualizado.subgrupo_id, 'sg-cab', 'sin subgrupo: toma el del operador');
        });
    });

    await t('Subgrupos en Mi panel: el operador ve su subgrupo y los del área sin subgrupo', () => {
        const { buildOperatorPanel } = require('../src/services/operatorPanelService');
        const tk = (codigo_incidencia, subgrupo_id) => ({ codigo_incidencia, asunto: codigo_incidencia, estado_actual: 'NUEVO', area_designada: 'REDES_FTTH', subgrupo_id, asignado_a_id: null, puntos_complejidad: 0, createdAt: new Date('2026-10-14T14:00:00Z') });
        const p = buildOperatorPanel({ user: { id: 'o5', nombre: 'Enza', area_designada: 'REDES_FTTH', subgrupo_id: 'sg-cab' }, entrantes: [tk('INC-1', null), tk('INC-2', 'sg-cab'), tk('INC-3', 'sg-sop')], now: new Date('2026-10-14T16:00:00Z') });
        const entr = p.colas.find(q => q.k === 'entrantes').tickets;
        assert.deepStrictEqual(entr.map(x => x.code).sort(), ['INC-1', 'INC-2']);
        assert.ok(entr.find(x => x.code === 'INC-2').areaNombre.endsWith('· Cabecera'));
        assert.ok(p.usuario.areaNombre.endsWith('· Cabecera'));
    });

    await t('Administración: crear subgrupo, nombre repetido y no desactivar con gente', async () => {
        const ctrl = require('../src/controllers/adminController');
        await con({
            area: { findUnique: async () => ({ codigo: 'REDES_FTTH', nombre: 'Redes FTTH' }), findMany: async () => [] },
            subgrupo: {
                findFirst: async ({ where }) => (where.nombre ? (where.nombre.equals === 'Soporte' ? { id: 'sg-sop' } : null) : { orden: 1 }),
                create: async ({ data }) => ({ id: 'sg-new', ...data }),
                findUnique: async () => ({ id: 'sg-sop', area_codigo: 'REDES_FTTH', nombre: 'Soporte', activo: true }),
                findMany: async () => []
            },
            user: { count: async () => 2 },
            ticket: { count: async () => 0 },
            auditLog: { create: async () => ({}) }
        }, async () => {
            let r = mockRes();
            await ctrl.createSubgrupo({ params: { codigo: 'REDES_FTTH' }, body: { nombre: 'Soporte' }, user: GER }, r);
            assert.strictEqual(r.code, 409);
            r = mockRes();
            await ctrl.createSubgrupo({ params: { codigo: 'REDES_FTTH' }, body: { nombre: ' Planta  externa ' }, user: GER }, r);
            assert.strictEqual(r.code, 201);
            assert.strictEqual(r.body.subgrupo.nombre, 'Planta externa');
            assert.strictEqual(r.body.subgrupo.orden, 2);
            r = mockRes();
            await ctrl.updateSubgrupo({ params: { id: 'sg-sop' }, body: { activo: false }, user: GER }, r);
            assert.strictEqual(r.code, 409);
            assert.match(r.body.error, /2 personas/);
        });
        cat.setSubgrupos([
            { id: 'sg-sop', area_codigo: 'REDES_FTTH', nombre: 'Soporte', activo: true },
            { id: 'sg-cab', area_codigo: 'REDES_FTTH', nombre: 'Cabecera', activo: true }
        ]);
    });

    await t('Tickets: cada área lleva sus subgrupos activos para filtrar y elegir', () => {
        const { buildQueue } = require('../src/services/ticketQueueService');
        const cola = buildQueue({ tickets: [{ codigo_incidencia: 'INC-9', asunto: 'x', area_designada: 'REDES_FTTH', subgrupo_id: 'sg-sop', estado_actual: 'NUEVO', puntos_complejidad: 0, createdAt: new Date() }], operators: [], now: new Date() });
        assert.deepStrictEqual(cola.areas.find(a => a.codigo === 'REDES_FTTH').subgrupos.map(g => g.nombre), ['Soporte', 'Cabecera']);
        assert.deepStrictEqual(cola.areas.find(a => a.codigo === 'WAN').subgrupos, []);
        assert.strictEqual(cola.tickets[0].subgrupoNombre, 'Soporte');
        const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'tickets.js'), 'utf8');
        ['areaMatch', 'subgrupoId', 'subgrupo_id', 'sgField'].forEach(x => assert.ok(js.includes(x), 'falta ' + x));
        cat.setSubgrupos([]);
    });

    console.log(`\nResultado: ${passed}/${total} pruebas pasaron\n`);
    process.exit(passed === total ? 0 : 1);
})();
