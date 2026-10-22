// Pruebas del panel del operador (Fase 9): colas, tarjetas, turno, traspaso,
// avisos, la vista y las acciones nuevas (dejar en espera con nota).
// Sin base de datos: prisma se simula.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const prisma = require('../src/config/prisma');
const { buildOperatorPanel, shiftWindow, saludo, formatMinutes } = require('../src/services/operatorPanelService');
const { DEFAULT_RULES } = require('../src/services/rulesService');

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
    return r;
}

// Miércoles 14/10/2026 12:00 en Caracas (UTC-4)
const NOW = new Date('2026-10-14T16:00:00Z');
const at = (hhmm, dia = '2026-10-14') => new Date(`${dia}T${hhmm}:00-04:00`);
const USER = { id: 'op1', rol: 'OPERADOR', nombre: 'Enza Rojas', area_designada: 'REDES_FTTH', estado_operativo: 'DISPONIBLE' };
const tk = o => Object.assign({
    estado_actual: 'NUEVO', area_designada: 'REDES_FTTH', puntos_complejidad: 0, asignado_a_id: null,
    origen_ingesta: 'CORREO', remitente: 'cliente@empresa.com', descripcion: 'Detalle', updatedAt: o.createdAt
}, o);

const entrantes = [
    tk({ codigo_incidencia: 'INC-020', asunto: 'Consulta', createdAt: at('11:50'), puntos_complejidad: 1 }),
    tk({ codigo_incidencia: 'INC-021', asunto: 'OLT con alarma', createdAt: at('11:35'), puntos_complejidad: 8 }),
    tk({ codigo_incidencia: 'INC-022', asunto: 'Sin prioridad vieja', createdAt: at('11:00') }),
    tk({ codigo_incidencia: 'INC-023', asunto: 'General', createdAt: at('11:55'), area_designada: 'GENERAL', puntos_complejidad: 5 }),
    tk({ codigo_incidencia: 'INC-024', asunto: 'Otra área', createdAt: at('10:00'), area_designada: 'WAN' })
];
const mios = [
    tk({ codigo_incidencia: 'INC-030', asunto: 'Asignado', createdAt: at('10:00'), asignado_a_id: 'op1', fecha_asignacion: at('11:27'), puntos_complejidad: 5 }),
    tk({ codigo_incidencia: 'INC-031', asunto: 'En atención', createdAt: at('09:00'), asignado_a_id: 'op1', estado_actual: 'EN_PROGRESO', fecha_asignacion: at('11:13'), puntos_complejidad: 1 }),
    tk({ codigo_incidencia: 'INC-032', asunto: 'Pausado', createdAt: at('08:00'), asignado_a_id: 'op1', estado_actual: 'EN_PAUSA', updatedAt: at('09:40') }),
    tk({ codigo_incidencia: 'INC-033', asunto: 'Esperando', createdAt: at('08:30'), asignado_a_id: 'op1', estado_actual: 'EN_ESPERA_TERCEROS', updatedAt: at('10:00'), puntos_complejidad: 5 }),
    tk({ codigo_incidencia: 'INC-034', asunto: 'De otro', createdAt: at('08:30'), asignado_a_id: 'op2', estado_actual: 'EN_PROGRESO' })
];
const resueltos = [
    tk({ codigo_incidencia: 'INC-040', asunto: 'Resuelto hoy', createdAt: at('07:00'), asignado_a_id: 'op1', estado_actual: 'RESUELTO', resueltoEn: at('10:15'), puntos_complejidad: 5 }),
    tk({ codigo_incidencia: 'INC-041', asunto: 'Cerrado hoy', createdAt: at('07:00'), asignado_a_id: 'op1', estado_actual: 'CERRADO', resueltoEn: at('09:40'), fecha_cierre: at('10:02'), puntos_complejidad: 8 }),
    tk({ codigo_incidencia: 'INC-042', asunto: 'Ayer', createdAt: at('07:00', '2026-10-13'), asignado_a_id: 'op1', estado_actual: 'CERRADO', resueltoEn: at('09:00', '2026-10-13'), puntos_complejidad: 8 })
];
const turno = { codigo: 'EN_TURNO', etiqueta: 'En turno', enTurno: true, disponible: true };
const build = extra => buildOperatorPanel({ user: USER, entrantes, mios, resueltos, turno, rules: DEFAULT_RULES, now: NOW, ...extra });
const cola = (p, k) => p.colas.find(q => q.k === k);

(async () => {
    console.log('\n🧪 Panel del operador\n');

    await t('Colas: entrantes de mi área y General, asignados, en atención, en espera y resueltos de hoy', () => {
        const p = build();
        assert.deepStrictEqual(p.colas.map(q => q.k), ['entrantes', 'asignados', 'atencion', 'espera', 'resueltos']);
        assert.deepStrictEqual(cola(p, 'entrantes').tickets.map(x => x.code), ['INC-021', 'INC-022', 'INC-020', 'INC-023'], 'P1 primero, luego el más antiguo; sin otras áreas');
        assert.deepStrictEqual(cola(p, 'asignados').tickets.map(x => x.code), ['INC-030']);
        assert.deepStrictEqual(cola(p, 'atencion').tickets.map(x => x.code), ['INC-031'], 'solo los míos');
        assert.deepStrictEqual(cola(p, 'espera').tickets.map(x => x.code).sort(), ['INC-032', 'INC-033']);
        assert.deepStrictEqual(cola(p, 'resueltos').tickets.map(x => x.code), ['INC-040', 'INC-041'], 'solo los de hoy, el más reciente primero');
        assert.strictEqual(cola(p, 'entrantes').hayP1, true);
        assert.strictEqual(p.colaInicial, 'asignados');
    });

    await t('Filas: tiempo, alerta de antigüedad, área general y etiquetas', () => {
        const p = build();
        const e = cola(p, 'entrantes').tickets;
        const sp = e.find(x => x.code === 'INC-022');
        assert.strictEqual(sp.min, 60);
        assert.strictEqual(sp.alerta, true);
        assert.strictEqual(sp.meta, 'Sin prioridad más de 30 min');
        const p1 = e.find(x => x.code === 'INC-021');
        assert.strictEqual(p1.alerta, false, '25 min < 60 min de un P1');
        assert.strictEqual(p1.meta, 'De cliente@empresa.com');
        const gen = e.find(x => x.code === 'INC-023');
        assert.strictEqual(gen.otraArea, true);
        assert.strictEqual(gen.areaNombre, 'General');
        assert.strictEqual(cola(p, 'asignados').tickets[0].min, 33, 'asignado hace: desde fecha_asignacion');
        assert.strictEqual(cola(p, 'atencion').tickets[0].min, 47);
        const pausa = cola(p, 'espera').tickets.find(x => x.code === 'INC-032');
        assert.strictEqual(pausa.tag, 'En pausa');
        assert.strictEqual(cola(p, 'espera').tickets.find(x => x.code === 'INC-033').tag, 'Espera de terceros');
        const cer = cola(p, 'resueltos').tickets.find(x => x.code === 'INC-041');
        assert.strictEqual(cer.meta, 'Resuelto 09:40 · cerrado 10:02');
        assert.strictEqual(cer.tag, 'Cerrado');
        assert.strictEqual(cola(p, 'resueltos').tickets[0].tag, 'Pendiente de cierre');
    });

    await t('Reglas de antigüedad configurables y apagables', () => {
        const rules = { ...DEFAULT_RULES, antiguedad: { activa: true, P1: 10, P2: 120, P3: 240, SP: 90 } };
        const p = build({ rules });
        const e = cola(p, 'entrantes').tickets;
        assert.strictEqual(e.find(x => x.code === 'INC-021').meta, 'Sin asignar más de 10 min');
        assert.strictEqual(e.find(x => x.code === 'INC-022').alerta, false);
        const off = build({ rules: { ...DEFAULT_RULES, antiguedad: { ...DEFAULT_RULES.antiguedad, activa: false } } });
        assert(cola(off, 'entrantes').tickets.every(x => !x.alerta));
    });

    await t('Tarjetas: pendientes por estado, resueltos hoy y puntos (sin sobrecarga ni promedio)', () => {
        const p = build();
        assert.strictEqual(p.mezcla.total, 4);
        assert.deepStrictEqual(p.mezcla.segs.map(s => [s.label, s.n]), [['Asignados', 1], ['En atención', 1], ['En espera', 2]]);
        assert.deepStrictEqual(p.resueltos, { n: 2, abiertos: 1, cerrados: 1 });
        assert.strictEqual(p.puntosHoy, 13);
        const json = JSON.stringify(p).toLowerCase();
        ['sobrecarga', 'promedio', 'sla', 'ders'].forEach(w => assert(!json.includes(w), 'no debe decir ' + w));
    });

    await t('Disponibilidad: Atendiendo automático solo con un P1 en atención', () => {
        assert.strictEqual(build().disponibilidad.auto, 'Disponible');
        const conP1 = mios.map(x => (x.codigo_incidencia === 'INC-031' ? { ...x, puntos_complejidad: 8 } : x));
        const p = build({ mios: conP1 });
        assert.strictEqual(p.disponibilidad.auto, 'Atendiendo');
        assert.strictEqual(build({ user: { ...USER, estado_operativo: 'EN_TERRENO' } }).disponibilidad.estadoOperativo, 'EN_TERRENO');
    });

    await t('Turno: horario normal, guardia entre semana y fin de semana', () => {
        const normal = shiftWindow({ horario: null, deGuardia: false, turno }, NOW);
        assert.strictEqual(normal.horas, '08:00 – 17:00');
        assert.strictEqual(normal.resto, 'Faltan 5 h 00 min');
        assert.strictEqual(normal.tono, 'green');
        const noche = new Date('2026-10-14T23:30:00Z'); // 19:30
        const g = shiftWindow({ horario: null, deGuardia: true, turno: { codigo: 'DE_GUARDIA', etiqueta: 'De guardia' } }, noche);
        assert.strictEqual(g.horas, '17:00 – 24:00');
        assert.strictEqual(g.resto, 'Faltan 4 h 30 min');
        assert.strictEqual(g.tono, 'purple');
        const sabado = new Date('2026-10-17T14:00:00Z'); // sábado 10:00
        const w = shiftWindow({ horario: null, deGuardia: true, turno: { codigo: 'EN_CASA_GUARDIA', etiqueta: 'En casa de guardia' } }, sabado);
        assert.strictEqual(w.horas, '08:00 – 24:00');
        assert(w.resto.startsWith('Desde casa · faltan 14 h'));
        const libre = shiftWindow({ horario: { dias: [1, 2], inicio: '07:00', fin: '15:00' }, deGuardia: false, turno: { codigo: 'FUERA_DE_TURNO', etiqueta: 'Fuera de turno' } }, NOW);
        assert.strictEqual(libre.resto, 'Hoy no tienes turno');
        assert.strictEqual(libre.horas, '07:00 – 15:00');
    });

    await t('Saludo según la hora de Caracas y formato de minutos', () => {
        assert.strictEqual(saludo('Enza Rojas', new Date('2026-10-14T13:00:00Z')), 'Buenos días, Enza');
        assert.strictEqual(saludo('Enza Rojas', NOW), 'Buenas tardes, Enza');
        assert.strictEqual(saludo('', new Date('2026-10-15T00:30:00Z')), 'Buenas noches');
        assert.strictEqual(formatMinutes(47), '47 min');
        assert.strictEqual(formatMinutes(125), '2 h 05');
    });

    await t('Traspaso: solo de guardia, con quién lo tiene y si se puede tomar', () => {
        const traspaso = { nota: 'Revisar P1 primero', autor: 'Coord', creadoEn: at('17:00', '2026-10-13').toISOString(), pendientes: ['INC-050', 'INC-051', 'INC-052'], vigente: true };
        const traspasoTickets = [
            tk({ codigo_incidencia: 'INC-050', asunto: 'Libre', createdAt: at('16:00', '2026-10-13'), puntos_complejidad: 8 }),
            tk({ codigo_incidencia: 'INC-051', asunto: 'De otro', createdAt: at('16:00', '2026-10-13'), asignado_a_id: 'op2', asignado_a: { nombre: 'Luis' }, estado_actual: 'EN_PROGRESO' }),
            tk({ codigo_incidencia: 'INC-052', asunto: 'Mío', createdAt: at('16:00', '2026-10-13'), asignado_a_id: 'op1', estado_actual: 'EN_PAUSA' })
        ];
        assert.strictEqual(build({ traspaso, traspasoTickets }).traspaso, null, 'sin guardia no se muestra');
        const p = build({ traspaso, traspasoTickets, deGuardia: true });
        assert.deepStrictEqual(p.traspaso.filas.map(f => [f.code, f.op, f.puedeTomar]), [['INC-050', 'Sin asignar', true], ['INC-051', 'Luis', false], ['INC-052', 'Tuyo', false]]);
        assert.strictEqual(p.traspaso.hora, '13 oct 17:00');
    });

    await t('Avisos dentro del portal: P1 nuevo, antigüedad y asignados', () => {
        const p = build();
        const tipos = p.avisos.map(a => a.tipo);
        assert(tipos.includes('p1') && tipos.includes('antiguedad') && tipos.includes('asignado'));
        assert.strictEqual(p.avisos[0].hace, 'hace 25 min', 'el más reciente primero');
    });

    await t('Controlador: arma el panel con las consultas del operador', async () => {
        const calls = [];
        const orig = { ticket: prisma.ticket, user: prisma.user, horarioOperador: prisma.horarioOperador, guardiaSemanal: prisma.guardiaSemanal, configuracion: prisma.configuracion };
        prisma.ticket = { findMany: async args => { calls.push(args.where); const w = args.where; if (w.asignado_a_id === null) return entrantes.slice(0, 2); if (w.estado_actual && w.estado_actual.in && w.estado_actual.in.includes('RESUELTO')) return resueltos.slice(0, 1); return mios.slice(0, 2); } };
        prisma.user = { findUnique: async () => ({ estado_operativo: 'DISPONIBLE' }) };
        prisma.horarioOperador = { findMany: async () => [] };
        prisma.guardiaSemanal = { findMany: async () => [] };
        prisma.configuracion = { findMany: async () => [] };
        try {
            const { renderDashboard } = require('../src/controllers/dashboardController');
            const res = mockRes();
            await renderDashboard({ user: USER, query: {} }, res);
            assert.strictEqual(res.view, 'operator-dashboard', String(res.body));
            assert(res.locals.panel && res.locals.panel.colas.length === 5);
            assert(calls.some(w => w.asignado_a_id === 'op1' && w.estado_actual.in.includes('NUEVO')), 'consulta Asignados a mí (NUEVO asignado a mí)');
            assert(calls.some(w => w.OR), 'resueltos de hoy');
        } finally {
            Object.assign(prisma, orig);
        }
    });

    await t('Dejar en espera de terceros con nota (PATCH status)', async () => {
        const store = { ticket: { id: 't1', estado_actual: 'EN_PROGRESO', asignado_a_id: 'op1' }, audits: [] };
        const orig = { ticket: prisma.ticket, auditLog: prisma.auditLog };
        prisma.ticket = {
            findUnique: async () => ({ ...store.ticket }),
            updateMany: async ({ where, data }) => { if (!where.estado_actual.in.includes(store.ticket.estado_actual)) return { count: 0 }; Object.assign(store.ticket, data); return { count: 1 }; }
        };
        prisma.auditLog = { create: async ({ data }) => { store.audits.push(data); return data; } };
        try {
            const { updateOperatorStatus } = require('../src/controllers/ticketController');
            const res = mockRes();
            await updateOperatorStatus({ params: { ticketCode: 'INC-031' }, body: { status: 'EN_ESPERA_TERCEROS', nota: '  Proveedor en sitio ' }, user: USER }, res);
            assert.strictEqual(res.code, 200, JSON.stringify(res.body));
            assert.strictEqual(store.ticket.estado_actual, 'EN_ESPERA_TERCEROS');
            assert.strictEqual(store.audits[0].accion, 'TICKET_EN_ESPERA');
            assert(store.audits[0].detalles.endsWith('Nota: Proveedor en sitio'));
            const res2 = mockRes();
            await updateOperatorStatus({ params: { ticketCode: 'INC-031' }, body: { status: 'EN_ESPERA_TERCEROS' }, user: USER }, res2);
            assert.strictEqual(res2.code, 409, 'solo desde En atención');
        } finally {
            Object.assign(prisma, orig);
        }
    });

    await t('Vista: encabezado, tarjetas, reloj, bandeja, detalle y traspaso', () => {
        const file = path.join(__dirname, '..', 'views', 'operator-dashboard.ejs');
        const traspaso = { nota: 'Revisar <b>P1</b>', autor: 'Coord', creadoEn: at('17:00', '2026-10-13').toISOString(), pendientes: ['INC-050'], vigente: true };
        const panel = build({ deGuardia: true, traspaso, traspasoTickets: [tk({ codigo_incidencia: 'INC-050', asunto: 'Libre </script><script>alert(1)</script>', createdAt: at('16:00', '2026-10-13') })] });
        const html = ejs.render(fs.readFileSync(file, 'utf8'), { currentUser: USER, panel }, { filename: file });
        ['Buenas tardes, Enza', 'puntos hoy', 'Mi turno', 'id="opClock"', 'Pendientes', 'Resueltos hoy', 'Pendientes del traspaso', 'id="opQnav"', 'id="opSearch"',
            'id="tdTabInfo"', 'id="tdTabThread"', 'id="tdSendWait"', '/css/operador.css', '/js/operador.js', '/css/ticket-detalle.css', '/js/ticket-conversacion.js', 'Mi panel', 'Operación', "localStorage.getItem('kip.theme')"]
            .forEach(s => assert(html.includes(s), 'falta ' + s));
        assert(!html.includes('Coordinación'), 'sin menú del coordinador');
        assert(!html.includes('<b>P1</b>'), 'la nota del traspaso se escapa');
        const json = html.split('id="opDatos">')[1].split('</script>')[0];
        assert(!json.includes('<'), 'los datos no pueden cerrar el script');
        assert.strictEqual(JSON.parse(json).panel.colas.length, 5);
        assert(!/sobrecarga|promedio del área/i.test(html));
    });

    await t('Coordinador que atiende tickets: permiso, filtro, conversación y alta en Administración', () => {
        const { atiendeTickets, ATIENDE_WHERE, authorizeWorker } = require('../src/services/roleService');
        const coord = { id: 'c1', rol: 'COORDINADOR', atiende_tickets: false };
        assert.strictEqual(atiendeTickets({ rol: 'OPERADOR' }), true);
        assert.strictEqual(atiendeTickets(coord), false);
        assert.strictEqual(atiendeTickets({ ...coord, atiende_tickets: true }), true);
        assert.deepStrictEqual(ATIENDE_WHERE.OR, [{ rol: 'OPERADOR' }, { rol: { in: ['COORDINADOR', 'JEFE'] }, atiende_tickets: true }]);
        let res = mockRes(), next = false;
        authorizeWorker({ user: coord }, res, () => { next = true; });
        assert.strictEqual(res.code, 403);
        authorizeWorker({ user: { ...coord, atiende_tickets: true } }, mockRes(), () => { next = true; });
        assert.strictEqual(next, true);
        const conv = require('../src/services/conversationService');
        const tk1 = { estado_actual: 'EN_PROGRESO', asignado_a_id: 'c1' };
        assert.strictEqual(conv.motivoNoEscribir(tk1, { ...coord, atiende_tickets: true }), null, 'el coordinador que atiende responde sus tickets');
        assert.notStrictEqual(conv.motivoNoEscribir(tk1, coord), null);
        const { validateUser, describeUser } = require('../src/services/userAdminService');
        const v = validateUser({ nombre: 'Rafael Aguilar', email: 'ra@inter.com', rol: 'COORDINADOR', area: 'WAN', clave: 'temporal123', atiende: true }, { nuevo: true });
        assert.strictEqual(v.datos.atiende_tickets, true);
        assert(describeUser(null, v.datos).includes('que atiende tickets'));
        assert.strictEqual(validateUser({ atiende: 'si' }).error, 'Valor de "atiende tickets" no válido');
        assert.strictEqual(describeUser({ nombre: 'R', atiende_tickets: true }, { atiende_tickets: false }), 'R: ya no atiende tickets');
    });

    await t('El coordinador que atiende toma tickets de cualquier área; el operador solo de la suya', async () => {
        const orig = { ticket: prisma.ticket, auditLog: prisma.auditLog };
        let where = null;
        prisma.ticket = {
            findUnique: async () => ({ id: 't9', estado_actual: 'NUEVO', asignado_a_id: null, area_designada: 'SEGURIDAD', prioridad: 'P2', nivel: 2, puntos_complejidad: 4 }),
            updateMany: async args => { where = args.where; return { count: 1 }; }
        };
        prisma.auditLog = { create: async () => ({}) };
        try {
            const { claimTicket } = require('../src/controllers/ticketController');
            const res = mockRes();
            await claimTicket({ params: { ticketCode: 'INC-090' }, user: USER }, res);
            assert.strictEqual(res.code, 403, 'operador de otra área');
            prisma.ticket.findUnique = async args => (args.include ? { id: 't9', estado_actual: 'EN_PROGRESO' } : { id: 't9', estado_actual: 'NUEVO', asignado_a_id: null, area_designada: 'SEGURIDAD', prioridad: 'P2', nivel: 2, puntos_complejidad: 4 });
            const res2 = mockRes();
            await claimTicket({ params: { ticketCode: 'INC-090' }, user: { id: 'c1', rol: 'COORDINADOR', atiende_tickets: true, area_designada: 'GENERAL' } }, res2);
            assert.strictEqual(res2.code, 200, JSON.stringify(res2.body));
            assert.strictEqual(where.area_designada, undefined, 'sin filtro de área para el coordinador');
        } finally {
            Object.assign(prisma, orig);
        }
    });

    await t('Ticket sin prioridad (correo): se elige al tomarlo, partiendo de la sugerida', async () => {
        const orig = { ticket: prisma.ticket, auditLog: prisma.auditLog };
        let data = null, detalle = null;
        prisma.ticket = {
            findUnique: async args => (args.include ? { id: 't8', estado_actual: 'EN_PROGRESO' } : { id: 't8', estado_actual: 'NUEVO', asignado_a_id: null, area_designada: 'GENERAL', puntos_complejidad: 0, prioridad_sugerida: 'P1' }),
            updateMany: async args => { data = args.data; return { count: 1 }; }
        };
        prisma.auditLog = { create: async args => { detalle = args.data.detalles; return {}; } };
        try {
            const { claimTicket } = require('../src/controllers/ticketController');
            const sin = mockRes();
            await claimTicket({ params: { ticketCode: 'INC-091' }, user: USER, body: {} }, sin);
            assert.strictEqual(sin.code, 422);
            assert.deepStrictEqual([sin.body.requierePrioridad, sin.body.requiereTipo, sin.body.sugerida], [true, true, 'P1']);
            assert.strictEqual(data, null, 'no se tomó');
            const mala = mockRes();
            await claimTicket({ params: { ticketCode: 'INC-091' }, user: USER, body: { prioridad: 'NONE' } }, mala);
            assert.strictEqual(mala.code, 422, '"sin prioridad" no vale');
            const sinTipo = mockRes();
            await claimTicket({ params: { ticketCode: 'INC-091' }, user: USER, body: { prioridad: 'p2' } }, sinTipo);
            assert.strictEqual(sinTipo.code, 422, 'también falta el tipo de caso');
            assert.deepStrictEqual([sinTipo.body.requierePrioridad, sinTipo.body.requiereTipo], [false, true]);
            const ok = mockRes();
            await claimTicket({ params: { ticketCode: 'INC-091' }, user: USER, body: { prioridad: 'p2', nivel: 3 } }, ok);
            assert.strictEqual(ok.code, 200, JSON.stringify(ok.body));
            assert.deepStrictEqual([data.prioridad, data.nivel, data.puntos_complejidad, data.tipo_caso_id, data.estado_actual], ['P2', 3, 8, null, 'EN_PROGRESO'], 'los puntos salen del nivel (N3 = 8)');
            assert.ok(detalle.includes('prioridad P2') && detalle.includes('sugerida P1') && detalle.includes('tipo Otro (nivel 3, 8 pts)'), detalle);
        } finally {
            Object.assign(prisma, orig);
        }
    });

    await t('Panel: la fila sin prioridad trae la sugerida; el JS pide elegirla al tomar', () => {
        const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'operador.js'), 'utf8');
        assert.ok(js.includes('function prioritySheet') && js.includes("t.p === 'SP' && !prioridad"));
        const { sugerirPrioridad, mergeRules } = require('../src/services/rulesService');
        assert.strictEqual(sugerirPrioridad('CAÍDA del enlace principal'), 'P1', 'sin tildes ni mayúsculas');
        assert.strictEqual(sugerirPrioridad('Intermitencia y una consulta'), 'P2', 'gana la más alta');
        assert.strictEqual(sugerirPrioridad('download del backup'), null, 'palabra completa');
        assert.strictEqual(sugerirPrioridad('de noc@banco.com', mergeRules({ palabrasPrioridad: { P1: ['@banco.com'] } })), 'P1', 'por remitente');
        assert.deepStrictEqual(mergeRules({ palabrasPrioridad: { P2: [' Lento ', 'lento', '', 7] } }).palabrasPrioridad.P2, ['Lento'], 'limpia y sin repetidas');
        assert.strictEqual(mergeRules({}).palabrasPrioridad.P1.length > 0, true, 'trae palabras por defecto');
    });

    await t('Barra lateral: Mi panel solo para el coordinador que atiende', () => {
        const file = path.join(__dirname, '..', 'views', 'partials', 'sidebar.ejs');
        const tpl = fs.readFileSync(file, 'utf8');
        const con = ejs.render(tpl, { currentUser: { nombre: 'R', rol: 'COORDINADOR', atiende_tickets: true }, activo: 'panel', conteos: { misTickets: 2 } }, { filename: file });
        const sin = ejs.render(tpl, { currentUser: { nombre: 'R', rol: 'COORDINADOR' }, activo: 'dashboard' }, { filename: file });
        assert(con.includes('href="/mi-panel"') && con.includes('Coordinación'));
        assert(!sin.includes('/mi-panel'));
    });

    await t('Script y estilos: sin innerHTML, teléfono, tema oscuro y movimiento reducido', () => {
        const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'operador.js'), 'utf8');
        assert(!/innerHTML/.test(js), 'no usar innerHTML');
        new Function(js);
        ['Mostrar ', 'kip.op.fuera', "'/claim'", 'EN_ESPERA_TERCEROS', 'prefers-reduced-motion'].forEach(s => assert(js.includes(s), 'falta ' + s));
        const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'operador.css'), 'utf8');
        ['@media (max-width: 640px)', '[data-theme=dark]', 'prefers-reduced-motion', '.qhead { position: sticky', 'height: 44px'].forEach(s => assert(css.includes(s), 'falta ' + s));
    });

    console.log(`\nResultado: ${passed}/${total} pruebas pasaron\n`);
    process.exit(passed === total ? 0 : 1);
})();
