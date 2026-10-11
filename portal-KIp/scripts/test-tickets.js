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
    await t('Editar: prioridad se traduce a puntos (P1=8) y rechaza valores inválidos', async () => {
        const tk = { id: 't', area_designada: 'GENERAL', eliminado_en: null, asignado_a: null };
        setup(tk);
        await ctrl.editTicket(req({ ticketCode: 'INC-001' }, { prioridad: 'P1' }), mockRes());
        assert.strictEqual(tk.puntos_complejidad, 8);
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

    await t('Traspaso: exige nota, operador y tickets no resueltos/cerrados', async () => {
        setup({});
        prisma.user.findFirst = async () => ({ id: 'g1', nombre: 'Guardia' });
        prisma.ticket.findMany = async () => [{ id: 'a', codigo_incidencia: 'INC-001', estado_actual: 'EN_PROGRESO', fecha_asignacion: null, asignado_a: null }];
        const sinNota = mockRes();
        await ctrl.handoffTickets(req({}, { ticketCodes: ['INC-001'], operatorId: 'g1', nota: 'corto' }), sinNota);
        assert.strictEqual(sinNota.code, 400);
        prisma.ticket.findMany = async () => [{ id: 'a', codigo_incidencia: 'INC-001', estado_actual: 'RESUELTO', asignado_a: null }];
        const resuelto = mockRes();
        await ctrl.handoffTickets(req({}, { ticketCodes: ['INC-001'], operatorId: 'g1', nota: 'Se reinició el enlace; falta confirmar con el cliente' }), resuelto);
        assert.strictEqual(resuelto.code, 409);
    });
    await t('Traspaso: asigna al guardia, conserva fecha_asignacion y audita con la nota', async () => {
        setup({});
        const original = new Date('2026-10-10T14:00:00Z');
        const updates = [];
        prisma.user.findFirst = async () => ({ id: 'g1', nombre: 'Guardia' });
        prisma.ticket.findMany = async () => [
            { id: 'a', codigo_incidencia: 'INC-001', estado_actual: 'EN_PROGRESO', fecha_asignacion: original, asignado_a: { nombre: 'Ana' } },
            { id: 'b', codigo_incidencia: 'INC-002', estado_actual: 'NUEVO', fecha_asignacion: null, asignado_a: null }
        ];
        prisma.ticket.update = async ({ where, data }) => { updates.push({ id: where.id, data }); };
        const res = mockRes();
        const nota = 'Se reinició el enlace; falta confirmar con el cliente';
        await ctrl.handoffTickets(req({}, { ticketCodes: ['INC-001', 'INC-002'], operatorId: 'g1', nota }), res);
        assert.strictEqual(res.body.count, 2);
        assert.strictEqual(updates[0].data.asignado_a_id, 'g1');
        assert.strictEqual(updates[0].data.fecha_asignacion, original);
        assert(updates[1].data.fecha_asignacion instanceof Date);
        assert.strictEqual(audits.length, 2);
        assert(audits[0].detalles.includes(nota) && audits[0].detalles.includes('Ana'));
    });
    await t('Dashboard: flujoHoy en hora de Caracas, solo hoy, cierre = resueltoEn', async () => {
        const { getDayBounds } = require('../src/services/metricsService');
        const { start } = getDayBounds();
        const at = h => new Date(start.getTime() + h * 3600000 + 600000); // hh:10 Caracas
        prisma.ticket.findMany = async ({ where, select }) => {
            if (where && where.createdAt && select && select.createdAt && !select.fecha_cierre) return [{ createdAt: at(9) }, { createdAt: at(9) }, { createdAt: at(14) }];
            if (where && where.OR) return [{ createdAt: at(8), resueltoEn: at(11), fecha_cierre: at(15) }];
            return [];
        };
        prisma.ticket.count = async () => 0;
        prisma.user.findMany = async () => [];
        let data;
        await dashboard.renderDashboard({ user: { rol: 'COORDINADOR' }, query: {} }, { render: (_v, d) => { data = d; }, status: () => ({ send() {} }) });
        assert(data, 'debe renderizar');
        assert.strictEqual(data.flujoHoy.creados[9], 2);
        assert.strictEqual(data.flujoHoy.creados[14], 1);
        assert.strictEqual(data.flujoHoy.cerrados[11], 1, 'cierra a la hora de resueltoEn');
        assert.strictEqual(data.flujoHoy.cerrados[15], 0);
        assert.strictEqual(data.ticketsCreadosHoy, 3);
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

    console.log(`\n   RESUMEN: ${passed}/${total} pruebas pasaron correctamente\n`);
    if (passed !== total) process.exit(1);
})();
