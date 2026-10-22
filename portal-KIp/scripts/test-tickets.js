// Pruebas de las acciones del coordinador sobre tickets (cerrar, editar, eliminar,
// restaurar) y del filtro de borrado lógico. Sin base de datos: prisma se simula.
const assert = require('assert');
const prisma = require('../src/config/prisma');
const ctrl = require('../src/controllers/ticketController');
const dashboard = require('../src/controllers/dashboardController');

let total = 0, passed = 0;
async function t(name, fn) {
    total++;
    try { await fn(); passed++; console.log(`  ✅ [PASS] ${name}`); }
    catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.message}`); }
}
function mockRes() {
    const r = { code: 200, body: null };
    r.status = c => { r.code = c; return r; };
    r.json = b => { r.body = b; return r; };
    return r;
}
const req = (params, body) => ({ params, body, user: { id: 'u1', rol: 'COORDINADOR' } });
const audits = [];
function setup(ticket) {
    audits.length = 0;
    prisma.auditLog = { create: async ({ data }) => { audits.push(data); } };
    prisma.ticket.findUnique = async () => ticket && { ...ticket };
    prisma.ticket.update = async ({ data }) => { Object.assign(ticket, data); return ticket; };
}

(async () => {
    console.log('\n=== PRUEBAS: TICKETS (cerrar / editar / eliminar / restaurar) ===\n');

    await t('Eliminar: exige motivo', async () => {
        setup({ id: 't', estado_actual: 'NUEVO', eliminado_en: null });
        const res = mockRes();
        await ctrl.deleteTicket(req({ ticketCode: 'INC-001' }, {}), res);
        assert.strictEqual(res.code, 400);
    });
    await t('Eliminar: borrado lógico, desasigna y audita con motivo', async () => {
        const tk = { id: 't', estado_actual: 'EN_PROGRESO', eliminado_en: null, asignado_a_id: 'op' };
        setup(tk);
        const res = mockRes();
        await ctrl.deleteTicket(req({ ticketCode: 'INC-001' }, { motivo: 'Correo duplicado' }), res);
        assert.strictEqual(res.body.success, true);
        assert(tk.eliminado_en instanceof Date);
        assert.strictEqual(tk.asignado_a_id, null);
        assert.strictEqual(tk.motivo_eliminacion, 'Correo duplicado');
        assert.strictEqual(audits[0].accion, 'TICKET_ELIMINADO');
    });
    await t('Eliminar: ticket resuelto/cerrado pide confirmación extra', async () => {
        const tk = { id: 't', estado_actual: 'CERRADO', eliminado_en: null };
        setup(tk);
        const res = mockRes();
        await ctrl.deleteTicket(req({ ticketCode: 'INC-001' }, { motivo: 'Error de envío' }), res);
        assert.strictEqual(res.code, 409);
        assert.strictEqual(res.body.requiereConfirmacion, true);
        assert.strictEqual(tk.eliminado_en, null);
        const res2 = mockRes();
        await ctrl.deleteTicket(req({ ticketCode: 'INC-001' }, { motivo: 'Error de envío', confirmar: true }), res2);
        assert.strictEqual(res2.body.success, true);
    });
    await t('Restaurar: saca de la papelera y audita', async () => {
        const tk = { id: 't', estado_actual: 'NUEVO', eliminado_en: new Date(), motivo_eliminacion: 'x' };
        setup(tk);
        prisma.ticket.findUnique = async ({ where }) => (where.id ? { ...tk, asignado_a: null } : { ...tk });
        const res = mockRes();
        await ctrl.restoreTicket(req({ ticketCode: 'INC-001' }, {}), res);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(tk.eliminado_en, null);
        assert.strictEqual(audits[0].accion, 'TICKET_RESTAURADO');
    });
    await t('Editar: no permite campos fijos y registra valor anterior → nuevo', async () => {
        const tk = { id: 't', codigo_incidencia: 'INC-001', asunto: 'Viejo', area_designada: 'GENERAL', eliminado_en: null, asignado_a: null };
        setup(tk);
        const res = mockRes();
        await ctrl.editTicket(req({ ticketCode: 'INC-001' }, { asunto: 'Nuevo', createdAt: '2020-01-01', codigo_incidencia: 'INC-999' }), res);
        assert.strictEqual(tk.asunto, 'Nuevo');
        assert.strictEqual(tk.codigo_incidencia, 'INC-001');
        assert.strictEqual(tk.createdAt, undefined);
        assert(audits[0].detalles.includes('Viejo') && audits[0].detalles.includes('Nuevo'));
    });
    await t('Editar: la prioridad va en su campo (ya no da puntos) y rechaza valores inválidos', async () => {
        const tk = { id: 't', area_designada: 'GENERAL', eliminado_en: null, asignado_a: null, puntos_complejidad: 4 };
        setup(tk);
        await ctrl.editTicket(req({ ticketCode: 'INC-001' }, { prioridad: 'P1' }), mockRes());
        assert.strictEqual(tk.prioridad, 'P1');
        assert.strictEqual(tk.puntos_complejidad, 4, 'los puntos salen del nivel, no de la prioridad');
        const bad = mockRes();
        await ctrl.editTicket(req({ ticketCode: 'INC-001' }, { prioridad: 'P9' }), bad);
        assert.strictEqual(bad.code, 400);
    });
    await t('Editar: cambio de área con operador de otra área exige confirmación', async () => {
        const tk = { id: 't', area_designada: 'WAN', eliminado_en: null, asignado_a: { nombre: 'Ana', area_designada: 'WAN' } };
        setup(tk);
        const res = mockRes();
        await ctrl.editTicket(req({ ticketCode: 'INC-001' }, { area_designada: 'SEGURIDAD' }), res);
        assert.strictEqual(res.code, 409);
        assert.strictEqual(tk.area_designada, 'WAN');
    });
    await t('Cerrar: sella fecha_cierre y, en cierre directo, también resueltoEn', async () => {
        const tk = { id: 't', estado_actual: 'EN_PROGRESO', resueltoEn: null, eliminado_en: null };
        setup(tk);
        prisma.ticket.findUnique = async () => ({ ...tk, asignado_a: null });
        await ctrl.closeTicket(req({ ticketCode: 'INC-001' }, {}), mockRes());
        assert.strictEqual(tk.estado_actual, 'CERRADO');
        assert(tk.fecha_cierre instanceof Date && tk.resueltoEn instanceof Date);
    });
    await t('Cerrar: ticket resuelto conserva su resueltoEn original', async () => {
        const orig = new Date('2026-10-10T15:00:00Z');
        const tk = { id: 't', estado_actual: 'RESUELTO', resueltoEn: orig, eliminado_en: null };
        setup(tk);
        prisma.ticket.findUnique = async () => ({ ...tk, asignado_a: null });
        await ctrl.closeTicket(req({ ticketCode: 'INC-001' }, {}), mockRes());
        assert.strictEqual(tk.resueltoEn, orig);
    });
    await t('Rutas: editar/eliminar/restaurar/cerrar solo para COORDINADOR', () => {
        const router = require('../src/routes/ticketRoutes');
        const find = (m, p) => router.stack.find(l => l.route && l.route.path === p && l.route.methods[m]);
        for (const [m, p] of [['patch', '/:ticketCode'], ['delete', '/:ticketCode'], ['post', '/:ticketCode/restore'], ['post', '/:ticketCode/close']]) {
            const layer = find(m, p);
            assert(layer, `Falta ruta ${m} ${p}`);
            assert(layer.route.stack.length >= 2, `${m} ${p} debe tener authorizeRole`);
        }
    });
    await t('Filtro de borrado lógico: el middleware agrega eliminado_en: null salvo que se pida', async () => {
        // Se prueba la lógica con un cliente falso que expone $use
        const Module = require('module');
        let hook; const fake = { $use: fn => { hook = fn; }, ticket: {} };
        const orig = Module._load;
        Module._load = function (r) { return r === '@prisma/client' ? { PrismaClient: function () { return fake; } } : orig.apply(this, arguments); };
        delete require.cache[require.resolve('../src/config/prisma')];
        require('../src/config/prisma');
        Module._load = orig;
        delete require.cache[require.resolve('../src/config/prisma')];
        let seen;
        await hook({ model: 'Ticket', action: 'count', args: { where: { area_designada: 'WAN' } } }, async p => { seen = p; });
        assert.deepStrictEqual(seen.args.where, { area_designada: 'WAN', eliminado_en: null });
        await hook({ model: 'Ticket', action: 'count' }, async p => { seen = p; });
        assert.deepStrictEqual(seen.args.where, { eliminado_en: null });
        await hook({ model: 'Ticket', action: 'findMany', args: { where: { eliminado_en: { not: null } } } }, async p => { seen = p; });
        assert.deepStrictEqual(seen.args.where, { eliminado_en: { not: null } });
        await hook({ model: 'User', action: 'findMany', args: {} }, async p => { seen = p; });
        assert.deepStrictEqual(seen.args, {});
    });

    await t('Traspaso: exige nota y tickets no resueltos/cerrados', async () => {
        setup({});
        prisma.ticket.findMany = async () => [{ id: 'a', codigo_incidencia: 'INC-001', estado_actual: 'EN_PROGRESO', asignado_a: null }];
        const sinNota = mockRes();
        await ctrl.handoffTickets(req({}, { ticketCodes: ['INC-001'], nota: 'corto' }), sinNota);
        assert.strictEqual(sinNota.code, 400);
        prisma.ticket.findMany = async () => [{ id: 'a', codigo_incidencia: 'INC-001', estado_actual: 'RESUELTO', asignado_a: null }];
        const resuelto = mockRes();
        await ctrl.handoffTickets(req({}, { ticketCodes: ['INC-001'], nota: 'Se reinició el enlace; falta confirmar con el cliente' }), resuelto);
        assert.strictEqual(resuelto.code, 409);
    });
    await t('Traspaso: no reasigna, guarda el lote con la foto de cada ticket y audita con la nota', async () => {
        setup({});
        const updates = [];
        let lote = null;
        prisma.ticket.findMany = async () => [
            { id: 'a', codigo_incidencia: 'INC-001', estado_actual: 'EN_PROGRESO', asignado_a: { nombre: 'Ana' } },
            { id: 'b', codigo_incidencia: 'INC-002', estado_actual: 'NUEVO', asignado_a: null }
        ];
        prisma.ticket.update = async ({ where, data }) => { updates.push({ id: where.id, data }); };
        prisma.traspaso = { create: async ({ data }) => { lote = data; return { id: 'tr1' }; } };
        const res = mockRes();
        const nota = 'Se reinició el enlace; falta confirmar con el cliente';
        await ctrl.handoffTickets(req({}, { ticketCodes: ['INC-001', 'INC-002'], nota }), res);
        assert.strictEqual(res.body.count, 2);
        assert.strictEqual(res.body.traspasoId, 'tr1');
        assert.strictEqual(updates.length, 0, 'no cambia el operador de los tickets');
        assert.strictEqual(lote.nota, nota);
        assert.ok(lote.semana_inicio instanceof Date);
        assert.deepStrictEqual(lote.tickets.create, [
            { ticketId: 'a', estado_al_pasar: 'EN_PROGRESO', operador_al_pasar: 'Ana' },
            { ticketId: 'b', estado_al_pasar: 'NUEVO', operador_al_pasar: null }
        ]);
        assert.strictEqual(audits.length, 2);
        assert(audits[0].detalles.includes(nota) && audits[0].detalles.includes('Ana'));
    });
    await t('Traspaso: marcar atendido una sola vez', async () => {
        setup({});
        const tr = { id: 'tr1', cerrado_en: null };
        prisma.traspaso = {
            findUnique: async () => ({ ...tr }),
            update: async ({ data }) => { Object.assign(tr, data); }
        };
        const res = mockRes();
        await ctrl.closeHandoff({ params: { id: 'tr1' }, user: { id: 'u1' } }, res);
        assert.strictEqual(res.code, 200);
        assert.ok(tr.cerrado_en instanceof Date);
        const otra = mockRes();
        await ctrl.closeHandoff({ params: { id: 'tr1' }, user: { id: 'u1' } }, otra);
        assert.strictEqual(otra.code, 409);
    });
    await t('Cerrar: guarda el motivo opcional en Auditoría y limita su largo', async () => {
        const tk = { id: 't', estado_actual: 'RESUELTO', resueltoEn: new Date(), eliminado_en: null };
        setup(tk);
        const largo = mockRes();
        await ctrl.closeTicket(req({ ticketCode: 'INC-001' }, { motivo: 'x'.repeat(301) }), largo);
        assert.strictEqual(largo.code, 400);
        await ctrl.closeTicket(req({ ticketCode: 'INC-001' }, { motivo: 'Servicio restablecido' }), mockRes());
        assert.strictEqual(tk.estado_actual, 'CERRADO');
        assert(audits.some(a => a.accion === 'TICKET_CERRADO' && a.detalles.includes('Servicio restablecido')));
    });
    await t('Dashboard: flujo de hoy en hora de Caracas, cierre = resueltoEn', async () => {
        const { getDayBounds } = require('../src/services/metricsService');
        const { start } = getDayBounds();
        const at = h => new Date(start.getTime() + h * 3600000 + 600000); // hh:10 Caracas
        // El Dashboard nuevo pide los tickets una sola vez y calcula el flujo en dashboardService
        prisma.ticket.findMany = async () => [
            { codigo_incidencia: 'A', estado_actual: 'NUEVO', createdAt: at(9) },
            { codigo_incidencia: 'B', estado_actual: 'NUEVO', createdAt: at(9) },
            { codigo_incidencia: 'C', estado_actual: 'NUEVO', createdAt: at(14) },
            { codigo_incidencia: 'D', estado_actual: 'CERRADO', createdAt: at(8), resueltoEn: at(11), fecha_cierre: at(15) }
        ];
        prisma.ticket.count = async () => 0;
        prisma.user.findMany = async () => [];
        let data;
        await dashboard.renderDashboard({ user: { rol: 'COORDINADOR' }, query: {} }, { render: (_v, d) => { data = d; }, status: () => ({ send() {} }) });
        assert(data, 'debe renderizar');
        assert.strictEqual(data.panel.flujo.creados[9], 2);
        assert.strictEqual(data.panel.flujo.creados[14], 1);
        assert.strictEqual(data.panel.flujo.cerrados[11], 1, 'cierra a la hora de resueltoEn');
        assert.strictEqual(data.panel.flujo.cerrados[15], 0);
        assert.strictEqual(data.panel.kpis.creadosHoy, 4);
    });
    await t('Asignar: un ticket RESUELTO o CERRADO no puede reasignarse (409)', async () => {
        prisma.user.findFirst = async () => ({ id: 'op' });
        for (const estado of ['RESUELTO', 'CERRADO']) {
            prisma.ticket.findUnique = async () => ({ id: 't', estado_actual: estado });
            const res = mockRes();
            await ctrl.assignTicket({ body: { ticketCode: 'INC-1', operatorId: 'op' } }, res);
            assert.strictEqual(res.code, 409, estado);
        }
    });

    // --- Simulación de jornada: base en memoria que cuenta los viajes a la base ---
    const { nextTicketCode } = require('../src/services/ticketCodeService');
    const OPS = [{ id: 'op1', nombre: 'Ana', rol: 'OPERADOR', activo: true }, { id: 'op2', nombre: 'Beto', rol: 'OPERADOR', activo: true }];
    function fakeDb(codigos) {
        const db = { tickets: codigos.map((c, i) => ({ id: 'x' + i, codigo_incidencia: c, estado_actual: 'NUEVO', asignado_a_id: null, eliminado_en: c === 'INC-009' ? new Date() : null })), viajes: 0, audits: [] };
        const find = where => db.tickets.find(tk => tk.codigo_incidencia === where.codigo_incidencia);
        const matches = (tk, where) => (!where.estado_actual?.notIn || !where.estado_actual.notIn.includes(tk.estado_actual))
            && (where.estado_actual === undefined || typeof where.estado_actual !== 'string' || tk.estado_actual === where.estado_actual)
            && (!('asignado_a_id' in where) || tk.asignado_a_id === where.asignado_a_id)
            && (!where.codigo_incidencia?.in || where.codigo_incidencia.in.includes(tk.codigo_incidencia));
        prisma.user.findFirst = async ({ where }) => { db.viajes++; return OPS.find(o => o.id === where.id) || null; };
        prisma.ticket.findMany = async ({ where = {} } = {}) => {
            db.viajes++;
            const prefijo = where.codigo_incidencia?.startsWith;
            return db.tickets.filter(tk => (!prefijo || tk.codigo_incidencia.startsWith(prefijo)) && matches(tk, where)).map(tk => ({ ...tk }));
        };
        prisma.ticket.findUnique = async ({ where }) => { db.viajes++; const tk = find(where); return tk && { ...tk, asignado_a: OPS.find(o => o.id === tk.asignado_a_id) || null }; };
        prisma.ticket.create = async ({ data }) => {
            db.viajes++;
            if (db.tickets.some(tk => tk.codigo_incidencia === data.codigo_incidencia)) throw Object.assign(new Error('único'), { code: 'P2002' });
            const tk = { id: 'n' + db.tickets.length, eliminado_en: null, asignado_a_id: null, ...data };
            db.tickets.push(tk);
            return { ...tk };
        };
        prisma.ticket.update = async ({ where, data }) => {
            db.viajes++;
            const tk = find(where);
            if (!tk || !matches(tk, where)) throw Object.assign(new Error('no encontrado'), { code: 'P2025' });
            return Object.assign(tk, data);
        };
        prisma.ticket.updateMany = async ({ where, data }) => {
            db.viajes++;
            const lista = db.tickets.filter(tk => matches(tk, where));
            lista.forEach(tk => Object.assign(tk, data));
            return { count: lista.length };
        };
        prisma.$transaction = async fn => fn(prisma);
        prisma.auditLog = {
            create: async ({ data }) => { db.viajes++; db.audits.push(data); },
            createMany: async ({ data }) => { db.viajes++; db.audits.push(...data); }
        };
        return db;
    }
    const crear = body => ({ body: { asunto: 'Caída de enlace', areaDesignada: 'WAN', origenIngesta: 'LLAMADA', prioridad: 'P2', ...body }, user: { id: 'u1' } });

    await t('Código INC: ignora SIM-xxx y otros prefijos, cuenta eliminados', () => {
        assert.strictEqual(nextTicketCode([]), 'INC-001');
        assert.strictEqual(nextTicketCode(['INC-004', 'SIM-040', 'INC-006', 'INC-005']), 'INC-007');
        assert.strictEqual(nextTicketCode(['SIM-001', 'SIM-040']), 'INC-001');
        assert.strictEqual(nextTicketCode(['INC-999']), 'INC-1000');
        assert.strictEqual(nextTicketCode(['INC-1000', 'INC-999']), 'INC-1001');
    });
    await t('Simulación: crear con un SIM-xxx como último ticket (caso real) da el siguiente INC', async () => {
        const db = fakeDb(['INC-004', 'INC-005', 'INC-006', 'SIM-039', 'SIM-040']);
        const res = mockRes();
        await ctrl.createTicket(crear({}), res);
        assert.strictEqual(res.code, 201, JSON.stringify(res.body));
        assert.strictEqual(res.body.ticket.codigo_incidencia, 'INC-007');
        assert.deepStrictEqual([res.body.ticket.prioridad, res.body.ticket.puntos_complejidad], ['P2', 0], 'sin tipo de caso aún no suma puntos');
        assert.strictEqual(db.tickets.length, 6);
    });
    await t('Simulación: no reutiliza el código de un ticket en la papelera', async () => {
        fakeDb(['INC-008', 'INC-009']); // INC-009 está eliminado
        const res = mockRes();
        await ctrl.createTicket(crear({}), res);
        assert.strictEqual(res.body.ticket.codigo_incidencia, 'INC-010');
    });
    await t('Simulación: si otro coordinador toma el código a la vez, reintenta con el siguiente', async () => {
        const db = fakeDb(['INC-001']);
        const create = prisma.ticket.create;
        let primera = true;
        prisma.ticket.create = async args => {
            if (primera) { primera = false; db.tickets.push({ id: 'otro', codigo_incidencia: 'INC-002', estado_actual: 'NUEVO', eliminado_en: null }); }
            return create(args);
        };
        const res = mockRes();
        await ctrl.createTicket(crear({}), res);
        assert.strictEqual(res.code, 201);
        assert.strictEqual(res.body.ticket.codigo_incidencia, 'INC-003');
    });
    await t('Simulación: asignar → reasignar → asignación múltiple → resuelto no se reasigna', async () => {
        const db = fakeDb(['INC-001', 'INC-002', 'INC-003', 'INC-004']);
        let res = mockRes();
        await ctrl.assignTicket({ body: { ticketCode: 'INC-001', operatorId: 'op1', prioridad: 'P1' }, user: { id: 'u1' } }, res);
        assert.strictEqual(res.body.success, true);
        assert.deepStrictEqual([db.tickets[0].asignado_a_id, db.tickets[0].prioridad], ['op1', 'P1']);
        assert.strictEqual(db.viajes, 4, 'asignar = 2 lecturas en paralelo + 1 escritura + auditoría sin esperar (antes eran 5 en serie)');

        res = mockRes();
        await ctrl.assignTicket({ body: { ticketCode: 'INC-001', operatorId: 'op2' }, user: { id: 'u1' } }, res);
        assert.strictEqual(db.tickets[0].asignado_a_id, 'op2');
        assert.deepStrictEqual(db.audits.map(a => a.accion), ['TICKET_ASIGNADO', 'TICKET_REASIGNADO']);

        res = mockRes();
        await ctrl.batchAssignTickets({ body: { ticketCodes: ['INC-002', 'INC-003'], operatorId: 'op1' }, user: { id: 'u1' } }, res);
        assert.strictEqual(res.body.count, 2);
        assert.deepStrictEqual(db.tickets.slice(1, 3).map(tk => tk.asignado_a_id), ['op1', 'op1']);
        assert.strictEqual(db.audits.length, 4, 'auditoría del lote en una sola inserción');

        res = mockRes();
        await ctrl.batchAssignTickets({ body: { ticketCodes: ['INC-002', 'INC-004'], operatorId: 'op2' }, user: { id: 'u1' } }, res);
        assert.strictEqual(res.code, 409, 'INC-002 ya está asignado');
        assert.strictEqual(db.tickets[3].asignado_a_id, null, 'el lote no se aplica a medias');

        db.tickets[3].estado_actual = 'RESUELTO';
        res = mockRes();
        await ctrl.assignTicket({ body: { ticketCode: 'INC-004', operatorId: 'op1' }, user: { id: 'u1' } }, res);
        assert.strictEqual(res.code, 409);
    });
    await t('Simulación: si lo resuelven entre la lectura y la asignación responde 409', async () => {
        const db = fakeDb(['INC-001']);
        const findUnique = prisma.ticket.findUnique;
        prisma.ticket.findUnique = async args => { const tk = await findUnique(args); db.tickets[0].estado_actual = 'RESUELTO'; return tk; };
        const res = mockRes();
        await ctrl.assignTicket({ body: { ticketCode: 'INC-001', operatorId: 'op1' }, user: { id: 'u1' } }, res);
        assert.strictEqual(res.code, 409);
        assert.strictEqual(db.tickets[0].asignado_a_id, null);
    });
    await t('Simulación: operador inexistente o ticket inexistente → 404', async () => {
        fakeDb(['INC-001']);
        let res = mockRes();
        await ctrl.assignTicket({ body: { ticketCode: 'INC-001', operatorId: 'nadie' }, user: { id: 'u1' } }, res);
        assert.strictEqual(res.code, 404);
        res = mockRes();
        await ctrl.assignTicket({ body: { ticketCode: 'INC-777', operatorId: 'op1' }, user: { id: 'u1' } }, res);
        assert.strictEqual(res.code, 404);
    });

    console.log(`\n   RESUMEN: ${passed}/${total} pruebas pasaron correctamente\n`);
    if (passed !== total) process.exit(1);
})();
