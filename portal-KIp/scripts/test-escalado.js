// Pruebas de prioridad por tipo de caso, subida de prioridad por tiempo sin asignar y
// adjuntos al crear un ticket. Sin base de datos.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/prisma');
const tc = require('../src/services/tipoCasoService');
const { escalones, revisarEscalado } = require('../src/services/escaladoService');
const { mergeRules } = require('../src/services/rulesService');

let total = 0, passed = 0;
async function t(name, fn) { total++; try { await fn(); passed++; console.log(`  ✅ [PASS] ${name}`); } catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.message}`); } }
const res = () => { const r = { code: 200 }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };
const ORIG = { ticket: prisma.ticket, tipoCaso: prisma.tipoCaso, auditLog: prisma.auditLog, configuracion: prisma.configuracion };
const restaurar = () => Object.assign(prisma, ORIG);

const NOW = new Date('2026-10-26T14:00:00Z');
const hace = min => new Date(NOW.getTime() - min * 60000);
const TIPO_P1 = { id: 'tp-caida', nombre: 'Caída masiva', area_codigo: 'REDES_FTTH', nivel: 3, prioridad: 'P1', activo: true };
const TIPO_SIN = { id: 'tp-mac', nombre: 'MAC en Rojo', area_codigo: 'REDES_FTTH', nivel: 1, prioridad: null, activo: true };
const tk = (codigo, extra) => ({ id: codigo, codigo_incidencia: codigo, estado_actual: 'NUEVO', asignado_a_id: null, prioridad: null, prioridad_sugerida: null, createdAt: hace(10), prioridad_subida_en: null, ...extra });

(async () => {
    console.log('\n=== PRUEBAS: PRIORIDAD POR TIPO Y SUBIDA POR TIEMPO ===\n');

    await t('Tipo de caso: prioridad opcional P1/P2/P3 (en mayúsculas); otra cosa no vale', () => {
        const ok = tc.validarTipoCaso({ nombre: 'Caída masiva', area: 'REDES_FTTH', nivel: 3, prioridad: 'p1' });
        assert.strictEqual(ok.data.prioridad, 'P1');
        assert.strictEqual(tc.validarTipoCaso({ nombre: 'Caso', area: 'WAN', nivel: 1 }).data.prioridad, null, 'sin prioridad: la elige quien lo toma');
        assert.ok(tc.validarTipoCaso({ nombre: 'Caso', area: 'WAN', nivel: 1, prioridad: 'P9' }).error);
        assert.deepStrictEqual(tc.validarTipoCaso({ prioridad: '' }, { parcial: true }).data, { prioridad: null }, 'se puede quitar');
        assert.strictEqual(tc.tipoCasoVista({ ...TIPO_P1 }).prioridad, 'P1');
        assert.strictEqual(tc.clasificar({ tipoCasoId: 'tp-caida', tipo: TIPO_P1, area: 'REDES_FTTH' }).prioridad, 'P1');
        assert.strictEqual(tc.clasificar({ nivel: 2 }).prioridad, null, '"Otro" no trae prioridad');
    });

    await t('Subida: sin asignar pasa su tiempo y sube un escalón (SP → sugerida o P3, P3 → P2, P2 → P1)', () => {
        const r = mergeRules();
        const lista = [
            tk('INC-1', { createdAt: hace(31) }),                                  // SP 30 min → P3
            tk('INC-2', { createdAt: hace(31), prioridad_sugerida: 'P2' }),        // SP → la sugerida
            tk('INC-3', { prioridad: 'P3', createdAt: hace(241) }),                // P3 4 h → P2
            tk('INC-4', { prioridad: 'P2', createdAt: hace(500), prioridad_subida_en: hace(121) }), // desde la última subida
            tk('INC-5', { prioridad: 'P2', createdAt: hace(500), prioridad_subida_en: hace(60) }),  // aún no
            tk('INC-6', { prioridad: 'P1', createdAt: hace(900) }),                // ya es la más alta
            tk('INC-7', { createdAt: hace(90), asignado_a_id: 'op1' }),            // asignado: no
            tk('INC-8', { createdAt: hace(90), estado_actual: 'EN_PROGRESO' })     // no está en cola: no
        ];
        assert.deepStrictEqual(escalones(lista, NOW, r).map(e => [e.codigo, e.de, e.a]),
            [['INC-1', 'SP', 'P3'], ['INC-2', 'SP', 'P2'], ['INC-3', 'P3', 'P2'], ['INC-4', 'P2', 'P1']]);
        assert.deepStrictEqual(escalones(lista, NOW, mergeRules({ antiguedad: { subirPrioridad: false } })), [], 'apagado en Reglas');
        assert.deepStrictEqual(escalones(lista, NOW, mergeRules({ antiguedad: { activa: false } })), [], 'antigüedad apagada');
        assert.strictEqual(escalones([tk('INC-9', { createdAt: hace(20) })], NOW, mergeRules({ antiguedad: { SP: 15 } })).length, 1, 'usa los tiempos de Reglas');
    });

    await t('Subida en la base: solo si sigue igual, guarda la hora y deja Auditoría', async () => {
        const db = [tk('INC-1', { createdAt: hace(31) }), tk('INC-3', { prioridad: 'P3', createdAt: hace(241) })];
        const audits = [];
        prisma.configuracion = { findMany: async () => [] };
        prisma.ticket = {
            findMany: async () => db.map(x => ({ ...x })),
            updateMany: async ({ where, data }) => {
                const x = db.find(d => d.id === where.id && d.asignado_a_id === null && d.prioridad === where.prioridad);
                if (!x || x.id === 'INC-3') return { count: 0 }; // INC-3: alguien lo tomó mientras tanto
                Object.assign(x, data);
                return { count: 1 };
            }
        };
        prisma.auditLog = { create: async ({ data }) => { audits.push(data); return {}; } };
        try {
            assert.strictEqual(await revisarEscalado(prisma, NOW), 1);
            assert.deepStrictEqual([db[0].prioridad, db[0].prioridad_subida_en], ['P3', NOW]);
            assert.strictEqual(db[1].prioridad, 'P3', 'no se pisa si cambió');
            assert.deepStrictEqual([audits.length, audits[0].accion, audits[0].userId], [1, 'PRIORIDAD_SUBIDA', null]);
            assert.ok(audits[0].detalles.includes('Sin asignar por más de 30 min: prioridad sin prioridad → P3'), audits[0].detalles);
        } finally { restaurar(); }
    });

    await t('Tomar: sin prioridad, la toma de su tipo de caso; sin tipo con prioridad, la pide', async () => {
        let data = null, detalle = null;
        prisma.ticket = {
            findUnique: async args => (args.include ? { id: 'k1', estado_actual: 'EN_PROGRESO' } : { id: 'k1', estado_actual: 'NUEVO', asignado_a_id: null, area_designada: 'REDES_FTTH', prioridad: null, nivel: null, prioridad_sugerida: 'P3' }),
            updateMany: async args => { data = args.data; return { count: 1 }; }
        };
        prisma.tipoCaso = { findUnique: async ({ where }) => [TIPO_P1, TIPO_SIN].find(x => x.id === where.id) || null };
        prisma.auditLog = { create: async args => { detalle = args.data.detalles; return {}; } };
        try {
            const { claimTicket } = require('../src/controllers/ticketController');
            const user = { id: 'op1', rol: 'OPERADOR', area_designada: 'REDES_FTTH' };
            const pide = res();
            await claimTicket({ params: { ticketCode: 'INC-1' }, user, body: { tipoCasoId: 'tp-mac' } }, pide);
            assert.deepStrictEqual([pide.code, pide.body.requierePrioridad], [422, true], 'su tipo no trae prioridad');
            const ok = res();
            await claimTicket({ params: { ticketCode: 'INC-1' }, user, body: { tipoCasoId: 'tp-caida' } }, ok);
            assert.strictEqual(ok.code, 200, JSON.stringify(ok.body));
            assert.strictEqual(data.prioridad, 'P1');
            assert.ok(detalle.includes('con prioridad P1 (la de su tipo de caso)'), detalle);
            const elegida = res();
            await claimTicket({ params: { ticketCode: 'INC-1' }, user, body: { tipoCasoId: 'tp-caida', prioridad: 'P2' } }, elegida);
            assert.strictEqual(data.prioridad, 'P2', 'la elegida gana a la del tipo');
        } finally { restaurar(); }
    });

    await t('Editar: clasificar un ticket sin prioridad le pone la de su tipo; con prioridad no la toca', async () => {
        const tk2 = { id: 'k2', area_designada: 'REDES_FTTH', eliminado_en: null, asignado_a: null, tipo_caso_id: null, nivel: null, puntos_complejidad: 0, tipo_caso: null, prioridad: null };
        prisma.ticket = { findUnique: async () => ({ ...tk2 }), update: async ({ data }) => { Object.assign(tk2, data); return tk2; } };
        prisma.tipoCaso = { findUnique: async ({ where }) => [TIPO_P1, TIPO_SIN].find(x => x.id === where.id) || null };
        prisma.auditLog = { create: async () => ({}) };
        try {
            const { editTicket } = require('../src/controllers/ticketController');
            await editTicket({ params: { ticketCode: 'INC-2' }, body: { tipoCasoId: 'tp-caida' }, user: { id: 'c1', rol: 'COORDINADOR' } }, res());
            assert.deepStrictEqual([tk2.tipo_caso_id, tk2.prioridad], ['tp-caida', 'P1']);
            tk2.prioridad = 'P3'; tk2.tipo_caso_id = null; tk2.nivel = null;
            await editTicket({ params: { ticketCode: 'INC-2' }, body: { tipoCasoId: 'tp-caida' }, user: { id: 'c1', rol: 'COORDINADOR' } }, res());
            assert.strictEqual(tk2.prioridad, 'P3', 'ya tenía prioridad');
        } finally { restaurar(); }
    });

    await t('Crear: prioridad elegida, si no la de su tipo; los adjuntos del formulario quedan en el ticket', async () => {
        let creado = null;
        prisma.ticket = {
            findMany: async () => [],
            create: async ({ data }) => { creado = data; return { ...data, id: 'n1' }; }
        };
        prisma.tipoCaso = { findUnique: async ({ where }) => [TIPO_P1, TIPO_SIN].find(x => x.id === where.id) || null };
        try {
            const { createTicket } = require('../src/controllers/ticketController');
            const base = { asunto: 'Caída en El Cafetal', areaDesignada: 'REDES_FTTH', origenIngesta: 'COORDINADOR' };
            const r1 = res();
            await createTicket({ body: { ...base, prioridad: 'NONE', tipoCasoId: 'tp-caida' }, user: { id: 'c1' } }, r1);
            assert.strictEqual(r1.code, 201, JSON.stringify(r1.body));
            assert.deepStrictEqual([creado.prioridad, creado.nivel, creado.adjuntos], ['P1', 3, undefined]);
            const r2 = res();
            await createTicket({ body: { ...base, prioridad: 'P3', tipoCasoId: 'tp-caida', nivel: '' }, user: { id: 'c1' } }, r2);
            assert.strictEqual(creado.prioridad, 'P3', 'la elegida gana');
            const r3 = res();
            const files = [{ originalname: 'captura.png', filename: '1-captura.png', mimetype: 'image/png', size: 2048 }];
            await createTicket({ body: { ...base, prioridad: 'NONE', nivel: '2' }, files, user: { id: 'c1' } }, r3);
            assert.strictEqual(r3.code, 201, JSON.stringify(r3.body));
            assert.deepStrictEqual(creado.adjuntos.create, [{ nombre_original: 'captura.png', nombre_archivo: '1-captura.png', ruta: '/uploads/1-captura.png', mimetype: 'image/png', peso: 2048 }]);
            assert.deepStrictEqual([creado.prioridad, creado.nivel], [null, 2], 'multipart: el nivel llega como texto');
            const r4 = res();
            await createTicket({ body: { ...base, prioridad: 'NONE' }, files: Array(6).fill(files[0]), user: { id: 'c1' } }, r4);
            assert.strictEqual(r4.code, 400, 'máximo 5 adjuntos');
        } finally { restaurar(); }
    });

    await t('Ruta y migración: crear acepta adjuntos; columnas nuevas sin borrar nada', () => {
        const rutas = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'ticketRoutes.js'), 'utf8');
        assert.ok(/router\.post\('\/', authorizeSupervisor, subirAdjuntos, limitarAlArea, ticketController\.createTicket\)/.test(rutas));
        const dir = path.join(__dirname, '..', 'prisma', 'migrations');
        const sql = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(x => x.endsWith('_prioridad_por_tipo')), 'migration.sql'), 'utf8');
        assert.ok(/ALTER TABLE "TipoCaso" ADD COLUMN "prioridad" VARCHAR\(2\)/.test(sql));
        assert.ok(/ALTER TABLE "Ticket" ADD COLUMN "prioridad_subida_en" TIMESTAMP\(3\)/.test(sql));
        assert.ok(!/\bDROP\b|DELETE FROM|TRUNCATE|UPDATE /i.test(sql), 'no borra ni cambia datos');
    });

    console.log(`\nResultado: ${passed}/${total} pruebas pasaron`);
    process.exit(passed === total ? 0 : 1);
})();
