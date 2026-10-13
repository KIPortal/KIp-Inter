// Pruebas de Auditoría (auditViewService, controlador, vista y registros nuevos). Sin base de datos.
const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const prisma = require('../src/config/prisma');
const { actionInfo, parseAuditQuery, dateRange, dayLabel, buildAuditView, toCsv } = require('../src/services/auditViewService');

let total = 0, passed = 0;
async function t(name, fn) { total++; try { await fn(); passed++; console.log(`  ✅ [PASS] ${name}`); } catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.message}`); } }
const at = (hhmm, dia = '2026-10-13') => new Date(`${dia}T${hhmm}:00-04:00`); // martes
const NOW = at('15:00');
const log = (accion, hhmm, dia, extra = {}) => Object.assign({ accion, createdAt: at(hhmm, dia), detalles: 'detalle ' + accion, user: { nombre: 'Ana Pérez' }, userId: 'a', ticket: { codigo_incidencia: 'INC-001' } }, extra);

(async () => {
    console.log('\n=== PRUEBAS: AUDITORÍA ===\n');

    await t('Acciones: etiquetas cortas y códigos desconocidos legibles', () => {
        assert.deepStrictEqual(actionInfo('TICKET_REASIGNADO'), { codigo: 'TICKET_REASIGNADO', etiqueta: 'Reasignó', tono: 'azul' });
        assert.strictEqual(actionInfo('TICKET_ELIMINADO').tono, 'rojo');
        assert.strictEqual(actionInfo('ALGO_NUEVO').etiqueta, 'Algo nuevo');
    });

    await t('Filtros: por defecto 7 días y límite acotado', () => {
        assert.deepStrictEqual(parseAuditQuery({}), { usuario: '', accion: '', fecha: '7d', q: '', limite: 200 });
        assert.strictEqual(parseAuditQuery({ fecha: 'xx', limite: '99999' }).limite, 1000);
        assert.strictEqual(parseAuditQuery({ fecha: 'xx' }).fecha, '7d');
        assert.strictEqual(dateRange('todo', NOW), null);
        assert.strictEqual(dateRange('hoy', NOW).gte.toISOString(), at('00:00').toISOString());
        assert.strictEqual(dateRange('ayer', NOW).lt.toISOString(), at('00:00').toISOString());
    });

    await t('Días: "Hoy, martes 13 oct", "Ayer, lunes 12 oct"', () => {
        assert.strictEqual(dayLabel('2026-10-13', NOW), 'Hoy, martes 13 oct');
        assert.strictEqual(dayLabel('2026-10-12', NOW), 'Ayer, lunes 12 oct');
        assert.strictEqual(dayLabel('2026-10-10', NOW), 'Sábado 10 oct');
    });

    const logs = [
        log('TICKET_CERRADO', '14:30'), log('TICKET_REASIGNADO', '09:05'),
        log('GUARDIA_DEFINIDA', '18:00', '2026-10-12', { user: null, userId: null, ticket: null })
    ];
    const vista = buildAuditView({ logs, hoyLogs: logs.slice(0, 2), usuarios: [{ id: 'a', nombre: 'Ana Pérez' }], filtros: parseAuditQuery({}), now: NOW });

    await t('Registro: agrupado por día, hora de Caracas, sistema y resumen de hoy', () => {
        assert.deepStrictEqual(vista.dias.map(d => [d.etiqueta, d.filas.length]), [['Hoy, martes 13 oct', 2], ['Ayer, lunes 12 oct', 1]]);
        assert.strictEqual(vista.dias[0].filas[0].hora, '14:30');
        assert.strictEqual(vista.dias[1].filas[0].usuario, 'Sistema');
        assert.deepStrictEqual(vista.resumen, { eventosHoy: 2, usuariosHoy: 1, reasignacionesHoy: 1, eliminacionesHoy: 0 });
    });

    await t('Búsqueda por texto: ticket, usuario, detalle o acción', () => {
        const v = buildAuditView({ logs, filtros: parseAuditQuery({ q: 'reasign' }), now: NOW });
        assert.strictEqual(v.total, 1);
    });

    await t('CSV: con BOM, separador ; y comillas escapadas', () => {
        const v = buildAuditView({ logs: [log('TICKET_EDITADO', '10:00', '2026-10-13', { detalles: 'Asunto "nuevo"' })], now: NOW });
        const csv = toCsv(v);
        assert.ok(csv.startsWith('﻿"Fecha";"Hora"'));
        assert.ok(csv.includes('"Asunto ""nuevo"""'));
    });

    await t('Controlador: aplica filtros a la consulta y "Cargar más"', async () => {
        const { getAuditLogs } = require('../src/controllers/auditController');
        let where, take;
        prisma.auditLog = { findMany: async args => { if (args.take) { where = args.where; take = args.take; return Array.from({ length: 51 }, () => log('TICKET_CERRADO', '10:00')); } return []; } };
        prisma.user.findMany = async () => [];
        prisma.ticket.count = async () => 4;
        let vista2, data;
        await getAuditLogs({ query: { usuario: 'sistema', accion: 'TICKET_CERRADO', fecha: 'hoy', limite: '50' }, user: { rol: 'COORDINADOR' } }, { render: (v, d) => { vista2 = v; data = d; }, status: () => ({ send() {} }) });
        assert.strictEqual(vista2, 'auditoria');
        assert.strictEqual(where.userId, null);
        assert.strictEqual(where.accion, 'TICKET_CERRADO');
        assert.ok(where.createdAt.gte instanceof Date);
        assert.strictEqual(take, 51);
        assert.strictEqual(data.vista.hayMas, true);
        assert.strictEqual(data.vista.total, 50);
    });

    await t('Vista: filtros, día, enlace al ticket y texto escapado', async () => {
        const v = buildAuditView({ logs: [log('TICKET_EDITADO', '10:00', '2026-10-13', { detalles: '<b>x</b>' })], usuarios: [{ id: 'a', nombre: 'Ana Pérez' }], filtros: parseAuditQuery({ accion: 'TICKET_EDITADO' }), now: new Date() });
        const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'auditoria.ejs'), { vista: v, activos: 2, currentUser: { nombre: 'Coord', rol: 'COORDINADOR' } });
        assert.ok(html.includes('Usuario:') && html.includes('Acción:') && html.includes('Fecha:'));
        assert.ok(html.includes('href="/tickets#INC-001"'));
        assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
        assert.ok(html.includes('Quitar filtros'));
        assert.ok(/title="Auditoría" aria-current="page"/.test(html));
    });

    await t('Registros nuevos: asignar, reasignar y desasignar quedan en Auditoría', async () => {
        const ctrl = require('../src/controllers/ticketController');
        const audits = [];
        prisma.auditLog = { create: async ({ data }) => { audits.push(data); } };
        prisma.user.findFirst = async () => ({ id: 'op2', nombre: 'Beto Ruiz' });
        prisma.ticket.findUnique = async () => ({ id: 't1', estado_actual: 'EN_PROGRESO', asignado_a_id: 'op1', asignado_a: { nombre: 'Ana Pérez' } });
        prisma.ticket.updateMany = async () => ({ count: 1 });
        const res = () => { const r = {}; r.status = () => r; r.json = b => { r.body = b; return r; }; return r; };
        await ctrl.assignTicket({ body: { ticketCode: 'INC-1', operatorId: 'op2' }, user: { id: 'u' } }, res());
        assert.deepStrictEqual([audits[0].accion, audits[0].detalles], ['TICKET_REASIGNADO', 'De Ana Pérez a Beto Ruiz']);
        prisma.ticket.findUnique = async () => ({ id: 't1', estado_actual: 'NUEVO', asignado_a_id: null, asignado_a: null });
        await ctrl.assignTicket({ body: { ticketCode: 'INC-1', operatorId: 'op2', prioridad: 'P1' }, user: { id: 'u' } }, res());
        assert.deepStrictEqual([audits[1].accion, audits[1].detalles], ['TICKET_ASIGNADO', 'A Beto Ruiz (prioridad P1)']);
        prisma.ticket.findUnique = async () => ({ id: 't1', estado_actual: 'NUEVO', asignado_a: { nombre: 'Beto Ruiz' } });
        await ctrl.unassignTicket({ body: { ticketCode: 'INC-1' }, user: { id: 'u' } }, res());
        assert.strictEqual(audits[2].accion, 'TICKET_DESASIGNADO');
    });

    console.log(`\n   RESUMEN: ${passed}/${total} pruebas pasaron correctamente\n`);
    if (passed !== total) process.exit(1);
})();
