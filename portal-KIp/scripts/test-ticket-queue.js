// Pruebas de la cola de tickets (ticketQueueService) y de su vista. Sin base de datos.
const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const { buildQueue, buildHandoffView, handoffExpiry, daysAgo, ventanaCola } = require('../src/services/ticketQueueService');
const { ticketsAlAzar, cumple } = require('./ventana-tickets-helper');

let total = 0, passed = 0;
async function t(name, fn) { total++; try { await fn(); passed++; console.log(`  ✅ [PASS] ${name}`); } catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.message}`); } }

// Martes 13/10/2026 14:30 en Caracas (UTC-4)
const NOW = new Date('2026-10-13T18:30:00Z');
const at = (hhmm, dia = '2026-10-13') => new Date(`${dia}T${hhmm}:00-04:00`);
const turno = (codigo, etiqueta) => ({ codigo, etiqueta, disponible: codigo === 'EN_TURNO', enTurno: ['EN_TURNO', 'DE_GUARDIA'].includes(codigo) });

const operators = [
    { id: 'a', nombre: 'Ana Pérez', area_designada: 'WAN', estado_operativo: 'DISPONIBLE', turno: turno('EN_TURNO', 'En turno'), tickets_asignados: [1, 2, 3, 4, 5, 6] },
    { id: 'b', nombre: 'Beto Ruiz', area_designada: 'WAN', estado_operativo: 'DISPONIBLE', turno: turno('EN_TURNO', 'En turno'), tickets_asignados: [1] },
    { id: 'c', nombre: 'Carla Díaz', area_designada: 'WAN', estado_operativo: 'DISPONIBLE', turno: turno('DE_GUARDIA', 'De guardia'), deGuardia: true, tickets_asignados: [] },
    { id: 'd', nombre: 'Dani Soto', area_designada: 'TELEFONIA', estado_operativo: 'DISPONIBLE', turno: turno('FUERA_DE_TURNO', 'Fuera de turno'), tickets_asignados: [] }
];
const tk = o => Object.assign({ estado_actual: 'NUEVO', area_designada: 'WAN', puntos_complejidad: 0, asignado_a_id: null, asignado_a: null, origen_ingesta: 'CORREO', updatedAt: o.createdAt }, o);
const tickets = [
    tk({ codigo_incidencia: 'INC-010', asunto: 'Caída de enlace', createdAt: at('09:00'), puntos_complejidad: 8 }),
    tk({ codigo_incidencia: 'INC-011', asunto: 'Lentitud', createdAt: at('14:10'), puntos_complejidad: 1, origen_ingesta: 'COORDINADOR', creado_por: { nombre: 'Coord' } }),
    tk({ codigo_incidencia: 'INC-012', asunto: 'BGP', createdAt: at('10:00'), estado_actual: 'EN_PROGRESO', asignado_a_id: 'a', asignado_a: { id: 'a', nombre: 'Ana Pérez' }, fecha_asignacion: at('10:05'), updatedAt: at('14:00'), adjuntos: [{ nombre_original: 'log.txt', ruta: '/uploads/1-log.txt', peso: 20 }] }),
    tk({ codigo_incidencia: 'INC-005', asunto: 'Ayer', createdAt: at('16:00', '2026-10-12'), estado_actual: 'EN_PAUSA', asignado_a_id: 'b', asignado_a: { id: 'b', nombre: 'Beto Ruiz' }, updatedAt: at('11:00') }),
    tk({ codigo_incidencia: 'INC-007', asunto: 'Resuelto', createdAt: at('08:00'), estado_actual: 'RESUELTO', asignado_a_id: 'a', asignado_a: { id: 'a', nombre: 'Ana Pérez' }, resueltoEn: at('10:00') }),
    tk({ codigo_incidencia: 'INC-008', asunto: 'Cerrado hoy', createdAt: at('09:00'), estado_actual: 'CERRADO', fecha_cierre: at('13:30'), resueltoEn: at('13:00') }),
    tk({ codigo_incidencia: 'INC-003', asunto: 'Cerrado ayer', createdAt: at('08:00', '2026-10-12'), estado_actual: 'CERRADO', fecha_cierre: at('12:00', '2026-10-12') })
];

(async () => {
    console.log('\n=== PRUEBAS: COLA DE TICKETS ===\n');
    const cola = buildQueue({ tickets, operators, now: NOW });
    const fila = code => cola.tickets.find(f => f.codigo === code);

    await t('Cola: activos, resueltos sin cerrar y solo los cerrados de hoy', () => {
        assert.deepStrictEqual(cola.tickets.map(f => f.codigo).sort(), ['INC-005', 'INC-007', 'INC-008', 'INC-010', 'INC-011', 'INC-012']);
    });

    await t('Fila: prioridad, edad, días atrás, operador, adjuntos y origen', () => {
        assert.strictEqual(fila('INC-010').prioridad, 'P1');
        assert.strictEqual(fila('INC-011').prioridad, 'P3');
        assert.strictEqual(fila('INC-012').prioridad, 'SP');
        assert.strictEqual(fila('INC-010').edadMin, 330);
        assert.strictEqual(fila('INC-005').diasAtras, 1);
        assert.strictEqual(fila('INC-012').operador.iniciales, 'AP');
        assert.strictEqual(fila('INC-012').inmovilMin, 30);
        assert.deepStrictEqual(fila('INC-012').adjuntos, [{ nombre: 'log.txt', ruta: '/uploads/1-log.txt', peso: 20 }]);
        assert.strictEqual(fila('INC-011').creadoPor, 'Coord');
        assert.strictEqual(fila('INC-010').creadoPor, 'Buzón compartido');
    });

    await t('Antigüedad: misma regla que el Dashboard (pausa no alerta)', () => {
        assert.strictEqual(fila('INC-010').alerta, 'Sin asignar más de 1 h');
        assert.strictEqual(fila('INC-011').alerta, null, 'P3 de 20 min a tiempo');
        assert.strictEqual(fila('INC-012').alerta, null, 'sin prioridad, 30 min sin movimiento: justo en el límite');
        assert.strictEqual(fila('INC-005').alerta, null, 'en pausa no alerta');
    });

    await t('Tarjetas fijas: no dependen de filtros', () => {
        assert.deepStrictEqual(cola.resumen, {
            activos: 4, sinAsignar: 2, criticosSinAsignar: 1, pausaEspera: 1, resueltosSinCerrar: 1, creadosHoy: 5, cerradosHoy: 1, enCola: 0
        });
    });

    await t('Operadores: carga, sobrecarga y estado de turno', () => {
        const ana = cola.operadores.find(o => o.id === 'a');
        assert.strictEqual(ana.carga, 6);
        assert.strictEqual(ana.sobrecarga, true);
        assert.strictEqual(cola.operadores.find(o => o.id === 'c').estado.grupo, 'guardia');
    });

    await t('Sugerido y cola de espera: Beto en WAN; Telefonía sin nadie → otra área', () => {
        assert.strictEqual(cola.sugeridos.WAN.id, 'b', 'Ana está sobrecargada y la guardia de Carla empieza a las 17:00');
        assert.ok(cola.sugeridos.WAN.motivo.startsWith('En turno'));
        assert.strictEqual(cola.sugeridos.TELEFONIA, null, 'Dani está fuera de turno');
        assert.strictEqual(cola.otraArea.TELEFONIA.id, 'b');
        const telefonia = buildQueue({ tickets: [tk({ codigo_incidencia: 'INC-030', asunto: 'PBX', area_designada: 'TELEFONIA', createdAt: at('14:00') })], operators, now: NOW });
        assert.strictEqual(telefonia.tickets[0].enCola, true);
        assert.strictEqual(telefonia.resumen.enCola, 1);
        assert.strictEqual(fila('INC-010').enCola, false);
    });

    await t('Traspaso: vence a las 08:00 siguientes y cuenta solo pendientes', () => {
        assert.strictEqual(handoffExpiry(at('17:30')).toISOString(), at('08:00', '2026-10-14').toISOString());
        assert.strictEqual(handoffExpiry(at('07:00')).toISOString(), at('08:00').toISOString());
        const base = {
            id: 'tr', nota: 'Vigilar WAN', createdAt: at('12:00'), cerrado_en: null, creado_por: { nombre: 'Coord' },
            tickets: [
                { ticket: { codigo_incidencia: 'INC-010', estado_actual: 'NUEVO' } },
                { ticket: { codigo_incidencia: 'INC-007', estado_actual: 'RESUELTO' } },
                { ticket: { codigo_incidencia: 'INC-099', estado_actual: 'NUEVO', eliminado_en: at('13:00') } }
            ]
        };
        const v = buildHandoffView(base, NOW);
        assert.deepStrictEqual(v.pendientes, ['INC-010']);
        assert.strictEqual(v.vigente, true);
        assert.strictEqual(v.total, 3);
        assert.strictEqual(buildHandoffView({ ...base, cerrado_en: at('13:00') }, NOW).vigente, false, 'atendido');
        assert.strictEqual(buildHandoffView(base, at('08:01', '2026-10-14')).vigente, false, 'vencido');
        assert.strictEqual(buildHandoffView(null, NOW), null);
    });

    await t('Días atrás: hoy 0, ayer 1, null sin fecha', () => {
        assert.strictEqual(daysAgo(at('00:10'), NOW), 0);
        assert.strictEqual(daysAgo(at('23:50', '2026-10-12'), NOW), 1);
        assert.strictEqual(daysAgo(null, NOW), null);
    });

    await t('Vista: dibuja tarjetas, datos JSON seguros y la barra lateral', async () => {
        const conTexto = buildQueue({ tickets: [tk({ codigo_incidencia: 'INC-020', asunto: '</script><b>x', createdAt: at('14:00') })], operators, now: NOW });
        const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'tickets.ejs'), {
            cola: conTexto, traspaso: null, guardias: [], enPapelera: 2, siguienteCodigo: 'INC-021', enTurno: 2,
            currentUser: { nombre: 'Coord', rol: 'COORDINADOR' }
        });
        assert.ok(html.includes('Resumen operativo'));
        assert.ok(html.includes('Críticos sin asignar'));
        assert.ok(!html.includes('</script><b>x'), 'el asunto no puede cerrar el bloque de datos');
        assert.ok(html.includes('\\u003c/script>'));
        assert.ok(/aria-current="page"[^>]*>|title="Tickets" aria-current="page"/.test(html));
        assert.ok(!/\bSLA\b|\bDERS\b/.test(html));
    });

    await t('Controlador /tickets: renderiza con datos, plantillas y siguiente código', async () => {
        const prisma = require('../src/config/prisma');
        prisma.ticket.findMany = async ({ where }) => (where && where.OR ? [{ codigo_incidencia: 'INC-007' }, { codigo_incidencia: 'INC-012' }] : tickets);
        prisma.ticket.count = async () => 2;
        prisma.user.findMany = async () => operators.map(o => ({ ...o, tickets_asignados: [] }));
        prisma.horarioOperador = { findMany: async () => [] };
        prisma.guardiaSemanal = { findMany: async () => [] };
        prisma.traspaso = { findFirst: async () => null };
        prisma.configuracion = { findMany: async () => [{ clave: 'plantillas', valor: { cierre: ['Motivo guardado'] } }] };
        const { renderTickets } = require('../src/controllers/dashboardController');
        let vista, data, error;
        await renderTickets({ user: { rol: 'COORDINADOR' }, query: {} }, { render: (v, d) => { vista = v; data = d; }, status: () => ({ send: m => { error = m; } }) });
        assert.strictEqual(error, undefined, 'no debe responder 500');
        assert.strictEqual(vista, 'tickets');
        assert.strictEqual(data.siguienteCodigo, 'INC-013');
        assert.strictEqual(data.enPapelera, 2);
        assert.deepStrictEqual(data.plantillas.cierre, ['Motivo guardado']);
        assert.ok(data.cola.tickets.length > 0);
    });

    await t('Ventana de la cola: sin los cerrados de otros días da la misma cola', () => {
        const todos = ticketsAlAzar(NOW).map(x => ({ ...x, asunto: 'Falla', asignado_a: null, creado_por: null, adjuntos: [] }));
        const ventana = todos.filter(x => cumple(x, ventanaCola(NOW)));
        assert.ok(ventana.length < todos.length, 'la ventana debe dejar fuera cerrados viejos');
        assert.deepStrictEqual(buildQueue({ tickets: ventana, operators, now: NOW }), buildQueue({ tickets: todos, operators, now: NOW }));
    });

    console.log(`\n   RESUMEN: ${passed}/${total} pruebas pasaron correctamente\n`);
    if (passed !== total) process.exit(1);
})();
