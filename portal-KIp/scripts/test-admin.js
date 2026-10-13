// Pruebas de Administración (configService, controlador y vista). Sin base de datos.
const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const prisma = require('../src/config/prisma');
const { mergeConfig, describeChanges, previewRules, loadConfig, DEFAULT_PLANTILLAS, MAX_PLANTILLAS, EVENTOS, DESTINATARIOS } = require('../src/services/configService');

let total = 0, passed = 0;
async function t(name, fn) { total++; try { await fn(); passed++; console.log(`  ✅ [PASS] ${name}`); } catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.message}`); } }
const at = (hhmm, dia = '2026-10-13') => new Date(`${dia}T${hhmm}:00-04:00`);

(async () => {
    console.log('\n=== PRUEBAS: ADMINISTRACIÓN ===\n');

    await t('Por defecto: reglas acordadas, avisos y plantillas del prototipo', () => {
        const c = mergeConfig();
        assert.strictEqual(c.reglas.sobrecarga.multiplicador, 1.5);
        assert.deepStrictEqual(c.avisos.cola, [true, null, null]);
        assert.deepStrictEqual(c.plantillas, { traspaso: [...DEFAULT_PLANTILLAS.traspaso], cierre: [...DEFAULT_PLANTILLAS.cierre] });
    });

    await t('Saneo: avisos que no aplican siguen en null; plantillas limpias, sin duplicados y con tope', () => {
        const c = mergeConfig({
            avisos: { cola: [false, true, true], p1: 'x' },
            plantillas: { cierre: ['  Servicio   ok ', 'servicio ok', 'no', 42, 'x'.repeat(200)], traspaso: Array.from({ length: 20 }, (_, i) => 'Nota número ' + i) }
        });
        assert.deepStrictEqual(c.avisos.cola, [false, null, null]);
        assert.deepStrictEqual(c.avisos.p1, [true, false, true], 'valor inválido → por defecto');
        assert.deepStrictEqual(c.plantillas.cierre, ['Servicio ok', 'x'.repeat(120)]);
        assert.strictEqual(c.plantillas.traspaso.length, MAX_PLANTILLAS);
    });

    await t('Auditoría: describe solo lo que cambió', () => {
        const antes = mergeConfig();
        const despues = mergeConfig({
            reglas: { sobrecarga: { activa: true, multiplicador: 2, minimo: 3 }, antiguedad: { P1: 45 } },
            avisos: { traspaso: [null, null, false] },
            plantillas: { cierre: ['Servicio restablecido'] }
        });
        assert.deepStrictEqual(describeChanges(antes, despues), [
            'Sobrecarga: 2× y mínimo 3',
            'Antigüedad P1: 45 min',
            'Aviso «Traspaso a guardia» a de guardia: no',
            'Plantillas de cierre: 1'
        ]);
        assert.deepStrictEqual(describeChanges(antes, mergeConfig()), []);
    });

    await t('Vista previa: sobrecarga y antigüedad con las reglas propuestas', () => {
        const operators = [
            { id: 'a', nombre: 'Ana Pérez', area_designada: 'WAN', estado_operativo: 'DISPONIBLE', tickets_asignados: [1, 2, 3, 4] },
            { id: 'b', nombre: 'Beto Ruiz', area_designada: 'WAN', estado_operativo: 'DISPONIBLE', tickets_asignados: [1] },
            { id: 'c', nombre: 'Carla Díaz', area_designada: 'WAN', estado_operativo: 'DISPONIBLE', tickets_asignados: [1] }
        ];
        const tickets = [{ codigo_incidencia: 'INC-1', estado_actual: 'NUEVO', puntos_complejidad: 8, asignado_a_id: null, createdAt: at('09:00') }];
        const base = previewRules({ operators, tickets, rules: {}, now: at('09:50') });
        assert.deepStrictEqual(base.sobrecarga.map(o => o.nombre), ['Ana Pérez']);
        assert.strictEqual(base.antiguedad.length, 0);
        const estricta = previewRules({ operators, tickets, rules: { sobrecarga: { multiplicador: 2.5 }, antiguedad: { P1: 30 } }, now: at('09:50') });
        assert.strictEqual(estricta.sobrecarga.length, 0);
        assert.deepStrictEqual(estricta.antiguedad, [{ codigo: 'INC-1', prioridad: 'P1', detalle: '50 min sin asignar' }]);
        assert.strictEqual(previewRules({ operators, tickets, rules: { sobrecarga: { activa: false } }, now: at('09:50') }).sobrecarga.length, 0);
    });

    await t('Carga: lee la tabla y tolera que no exista', async () => {
        prisma.configuracion = { findMany: async () => [{ clave: 'reglas', valor: { antiguedad: { P1: 45 } } }] };
        assert.strictEqual((await loadConfig(prisma)).reglas.antiguedad.P1, 45);
        prisma.configuracion = { findMany: async () => { throw new Error('relation "Configuracion" does not exist'); } };
        assert.strictEqual((await loadConfig(prisma)).reglas.antiguedad.P1, 60);
    });

    const ctrl = require('../src/controllers/adminController');
    const res = () => { const r = { code: 200 }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };

    await t('Guardar: upsert de las 3 claves y auditoría con el detalle', async () => {
        const upserts = [];
        const logs = [];
        prisma.configuracion = { findMany: async () => [], upsert: args => { upserts.push(args); return args; } };
        prisma.$transaction = async ops => ops;
        prisma.auditLog = { create: async ({ data }) => { logs.push(data); } };
        const r = res();
        await ctrl.saveConfig({ body: { reglas: { antiguedad: { P1: 45 } } }, user: { id: 'u1' } }, r);
        assert.strictEqual(r.code, 200);
        assert.deepStrictEqual(upserts.map(u => u.where.clave), ['reglas', 'avisos', 'plantillas']);
        assert.strictEqual(upserts[0].create.valor.antiguedad.P1, 45);
        assert.strictEqual(logs[0].accion, 'CONFIGURACION_EDITADA');
        assert.strictEqual(logs[0].detalles, 'Antigüedad P1: 45 min');
    });

    await t('Guardar: sin cambios no escribe; sin migración responde 503 con instrucción', async () => {
        let escrito = false;
        prisma.configuracion = { findMany: async () => [], upsert: () => { escrito = true; } };
        prisma.$transaction = async ops => ops;
        const r = res();
        await ctrl.saveConfig({ body: {}, user: { id: 'u1' } }, r);
        assert.strictEqual(escrito, false);
        assert.deepStrictEqual(r.body.cambios, []);
        prisma.configuracion = { findMany: async () => [], upsert: () => ({}) };
        prisma.$transaction = async () => { throw new Error('The table `public.Configuracion` does not exist'); };
        const r2 = res();
        await ctrl.saveConfig({ body: { reglas: { antiguedad: { P1: 45 } } }, user: { id: 'u1' } }, r2);
        assert.strictEqual(r2.code, 503);
        assert.ok(r2.body.error.includes('migrate deploy'));
    });

    await t('Vista: secciones, áreas con operadores y datos seguros', async () => {
        const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin.ejs'), {
            currentUser: { nombre: 'Coord', rol: 'COORDINADOR' },
            config: mergeConfig({ plantillas: { cierre: ['</script><b>x'] } }),
            areas: [{ codigo: 'WAN', nombre: 'WAN', operadores: [{ nombre: 'Ana Pérez', email: 'a@x', estado: { etiqueta: 'En turno', grupo: 'turno' }, carga: 2 }], turno: 1, guardia: 0 },
                { codigo: 'SEGURIDAD', nombre: 'Seguridad', operadores: [], turno: 0, guardia: 0 }],
            eventos: EVENTOS, destinatarios: DESTINATARIOS, limites: { plantillas: 12, texto: 120 },
            vistaPrevia: { sobrecarga: [], antiguedad: [] }, activos: 3, enTurno: 1, totalOperadores: 1
        });
        assert.ok(html.includes('Reglas de alerta') && html.includes('Áreas y equipos'));
        assert.ok(html.includes('data-area-pick="WAN" aria-selected="true"'), 'abre la primera área con operadores');
        assert.ok(!html.includes('</script><b>x'));
        assert.ok(/title="Administración" aria-current="page"/.test(html));
    });

    await t('Tickets usa las plantillas guardadas', async () => {
        const { buildQueue } = require('../src/services/ticketQueueService');
        const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'tickets.ejs'), {
            cola: buildQueue({}), traspaso: null, guardias: [], enPapelera: 0, siguienteCodigo: 'INC-001', enTurno: 0,
            currentUser: { nombre: 'Coord', rol: 'COORDINADOR' }, plantillas: { traspaso: ['Nota A'], cierre: ['Motivo B'] }
        });
        assert.ok(html.includes('"plantillas":{"traspaso":["Nota A"],"cierre":["Motivo B"]}'));
    });

    console.log(`\n   RESUMEN: ${passed}/${total} pruebas pasaron correctamente\n`);
    if (passed !== total) process.exit(1);
})();
