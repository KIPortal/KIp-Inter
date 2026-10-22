// Pruebas de tipos de caso (casos comunes), nivel de dificultad y puntos. Sin base de datos.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/prisma');
const tc = require('../src/services/tipoCasoService');
const { prioridadDe } = require('../src/services/rulesService');
const { buildSimulation, asignarAReales } = require('../src/services/simulationService');
const { buildPeriodReport } = require('../src/services/periodReportService');
const { buildReportView } = require('../src/services/reportViewService');
const { getPeriodBounds } = require('../src/services/metricsService');

let total = 0, passed = 0;
async function t(name, fn) { total++; try { await fn(); passed++; console.log(`  ✅ [PASS] ${name}`); } catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.message}`); } }
const res = () => { const r = { code: 200 }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };
const d = s => new Date(s);
const ORIG = { ticket: prisma.ticket, tipoCaso: prisma.tipoCaso, auditLog: prisma.auditLog };
const restaurar = () => Object.assign(prisma, ORIG);

const TIPO_OLT = { id: 'tp-olt', nombre: 'Configuración de OLT', area_codigo: 'REDES_FTTH', nivel: 4, minutos_estimados: 120, frecuencia: 'MEDIA', activo: true };
const TIPO_MAC = { id: 'tp-mac', nombre: 'MAC en Rojo', area_codigo: 'REDES_FTTH', nivel: 1, minutos_estimados: 15, frecuencia: 'ALTA', activo: true };
const TIPO_WAN = { id: 'tp-wan', nombre: 'Movimiento de bloques', area_codigo: 'WAN', nivel: 1, minutos_estimados: 60, frecuencia: 'ALTA', activo: true };

(async () => {
    console.log('\n=== PRUEBAS: TIPOS DE CASO Y PUNTOS POR NIVEL ===\n');

    await t('Niveles: N1=2, N2=4, N3=8, N4=10; sin nivel = 0 pts', () => {
        assert.deepStrictEqual([1, 2, 3, 4, 0, null, 5].map(tc.puntosDeNivel), [2, 4, 8, 10, 0, 0, 0]);
        assert.strictEqual(tc.nivelDeTicket({ nivel: 3 }), 3);
        assert.strictEqual(tc.nivelDeTicket({ tipo_caso: { nivel: 2 } }), 2, 'de su tipo si no trae nivel');
        assert.strictEqual(tc.nivelDeTicket({ puntos_complejidad: 8 }), null, 'los puntos viejos no son un nivel');
    });

    await t('Prioridad separada de los puntos; fotos viejas la deducen de los puntos', () => {
        assert.strictEqual(prioridadDe({ prioridad: 'P1', puntos_complejidad: 2 }), 'P1');
        assert.strictEqual(prioridadDe({ prioridad: null, puntos_complejidad: 8 }), 'SP', 'con el campo, 8 pts ya no es P1');
        assert.strictEqual(prioridadDe({ puntos_complejidad: 8 }), 'P1', 'sin el campo (foto vieja) sí');
        assert.strictEqual(prioridadDe({ prioridad: 'X' }), 'SP');
    });

    await t('Validar tipo: crear exige nombre, área activa y nivel 1-4; editar acepta parciales', () => {
        const ok = tc.validarTipoCaso({ nombre: '  MAC   en Rojo ', area: 'REDES_FTTH', nivel: '1', minutos: 15, frecuencia: 'alta', dependencias: ' HE ' });
        assert.deepStrictEqual(ok.data, { nombre: 'MAC en Rojo', area_codigo: 'REDES_FTTH', subgrupo_id: null, nivel: 1, minutos_estimados: 15, frecuencia: 'ALTA', dependencias: 'HE' });
        assert.ok(tc.validarTipoCaso({ nombre: 'ab', area: 'WAN', nivel: 1 }).error, 'nombre corto');
        assert.ok(tc.validarTipoCaso({ nombre: 'Caso', area: 'NO_EXISTE', nivel: 1 }).error, 'área');
        assert.ok(tc.validarTipoCaso({ nombre: 'Caso', area: 'WAN', nivel: 5 }).error, 'nivel');
        assert.ok(tc.validarTipoCaso({ nombre: 'Caso', area: 'WAN', nivel: 2, minutos: 1.5 }).error, 'minutos enteros');
        assert.ok(tc.validarTipoCaso({ nombre: 'Caso', area: 'WAN', nivel: 2, frecuencia: 'Siempre' }).error, 'frecuencia');
        assert.deepStrictEqual(tc.validarTipoCaso({ nivel: 3, area: 'WAN' }, { parcial: true }).data, { area_codigo: 'WAN', nivel: 3 });
        assert.deepStrictEqual(tc.validarTipoCaso({ activo: false }, { parcial: true }).data, { activo: false });
        assert.ok(tc.validarTipoCaso({}, { parcial: true }).error, 'sin cambios');
    });

    await t('Clasificar: el tipo da nivel y puntos; "Otro" con su nivel; tipo de otra área o desactivado no', () => {
        assert.deepStrictEqual(tc.clasificar({ tipoCasoId: 'tp-olt', tipo: TIPO_OLT, area: 'REDES_FTTH' }), { data: { tipo_caso_id: 'tp-olt', nivel: 4, puntos_complejidad: 10 }, nombre: 'Configuración de OLT' });
        assert.deepStrictEqual(tc.clasificar({ nivel: '2' }).data, { tipo_caso_id: null, nivel: 2, puntos_complejidad: 4 });
        assert.ok(tc.clasificar({ tipoCasoId: 'tp-olt', tipo: TIPO_OLT, area: 'WAN' }).error, 'otra área');
        assert.ok(tc.clasificar({ tipoCasoId: 'tp-olt', tipo: { ...TIPO_OLT, activo: false } }).error, 'desactivado');
        assert.ok(tc.clasificar({ tipoCasoId: 'tp-x', tipo: null }).error, 'no existe');
        assert.ok(tc.clasificar({ nivel: 7 }).error);
    });

    await t('Tomar: pide prioridad y tipo; con un tipo del catálogo guarda nivel, puntos y auditoría', async () => {
        let data = null, detalle = null;
        prisma.ticket = {
            findUnique: async args => (args.include ? { id: 'k1', estado_actual: 'EN_PROGRESO' } : { id: 'k1', estado_actual: 'NUEVO', asignado_a_id: null, area_designada: 'REDES_FTTH', prioridad: 'P2', nivel: null }),
            updateMany: async args => { data = args.data; return { count: 1 }; }
        };
        prisma.tipoCaso = { findUnique: async ({ where }) => [TIPO_OLT, TIPO_WAN].find(x => x.id === where.id) || null };
        prisma.auditLog = { create: async args => { detalle = args.data.detalles; return {}; } };
        try {
            const { claimTicket } = require('../src/controllers/ticketController');
            const user = { id: 'op1', rol: 'OPERADOR', area_designada: 'REDES_FTTH' };
            const sin = res();
            await claimTicket({ params: { ticketCode: 'INC-1' }, user, body: {} }, sin);
            assert.deepStrictEqual([sin.code, sin.body.requierePrioridad, sin.body.requiereTipo], [422, false, true]);
            const otra = res();
            await claimTicket({ params: { ticketCode: 'INC-1' }, user, body: { tipoCasoId: 'tp-wan' } }, otra);
            assert.strictEqual(otra.code, 400, 'un tipo de WAN no vale para un ticket de FTTx');
            assert.strictEqual(data, null);
            const ok = res();
            await claimTicket({ params: { ticketCode: 'INC-1' }, user, body: { tipoCasoId: 'tp-olt' } }, ok);
            assert.strictEqual(ok.code, 200, JSON.stringify(ok.body));
            assert.deepStrictEqual([data.tipo_caso_id, data.nivel, data.puntos_complejidad, data.prioridad], ['tp-olt', 4, 10, undefined], 'la prioridad ya elegida no se toca');
            assert.ok(detalle.includes('con tipo Configuración de OLT (nivel 4, 10 pts)'), detalle);
        } finally { restaurar(); }
    });

    await t('Editar: cambiar el tipo recalcula los puntos; quitarlo los deja en 0; queda en Auditoría', async () => {
        const tk = { id: 'k2', area_designada: 'WAN', eliminado_en: null, asignado_a: null, tipo_caso_id: null, nivel: 2, puntos_complejidad: 4, tipo_caso: null };
        let detalle = null;
        prisma.ticket = { findUnique: async () => ({ ...tk }), update: async ({ data }) => { Object.assign(tk, data); return tk; } };
        prisma.tipoCaso = { findUnique: async ({ where }) => [TIPO_OLT, TIPO_WAN].find(x => x.id === where.id) || null };
        prisma.auditLog = { create: async args => { detalle = args.data.detalles; return {}; } };
        try {
            const { editTicket } = require('../src/controllers/ticketController');
            const r = res();
            await editTicket({ params: { ticketCode: 'INC-2' }, body: { tipoCasoId: 'tp-wan' }, user: { id: 'c1', rol: 'COORDINADOR' } }, r);
            assert.deepStrictEqual([tk.tipo_caso_id, tk.nivel, tk.puntos_complejidad], ['tp-wan', 1, 2]);
            assert.ok(detalle.includes('tipo de caso: Otro → Movimiento de bloques'), detalle);
            const mala = res();
            await editTicket({ params: { ticketCode: 'INC-2' }, body: { tipoCasoId: 'tp-olt' }, user: { id: 'c1', rol: 'COORDINADOR' } }, mala);
            assert.strictEqual(mala.code, 400, 'tipo de otra área');
            await editTicket({ params: { ticketCode: 'INC-2' }, body: { tipoCasoId: null, nivel: null }, user: { id: 'c1', rol: 'COORDINADOR' } }, res());
            assert.deepStrictEqual([tk.tipo_caso_id, tk.nivel, tk.puntos_complejidad], [null, null, 0]);
        } finally { restaurar(); }
    });

    await t('Administración: crear y editar tipos (el área no cambia; nombre repetido = 409)', async () => {
        const audits = [];
        let creado = null;
        prisma.tipoCaso = {
            create: async ({ data }) => { if (data.nombre === 'Repetido') { const e = new Error('dup'); e.code = 'P2002'; throw e; } creado = { id: 'n1', activo: true, ...data }; return creado; },
            findUnique: async () => ({ ...TIPO_MAC }),
            update: async ({ data }) => ({ ...TIPO_MAC, ...data })
        };
        prisma.auditLog = { create: async args => { audits.push(args.data); return {}; } };
        try {
            const admin = require('../src/controllers/adminController');
            const req = body => ({ body, params: { id: 'tp-mac' }, user: { id: 'c1', rol: 'COORDINADOR' } });
            const r1 = res();
            await admin.createTipoCaso(req({ nombre: 'Creación de portchannel', area: 'REDES_FTTH', nivel: 4, minutos: 60, frecuencia: 'MEDIA' }), r1);
            assert.strictEqual(r1.code, 201, JSON.stringify(r1.body));
            assert.deepStrictEqual([r1.body.tipo.nivel, r1.body.tipo.puntos], [4, 10]);
            assert.strictEqual(audits.pop().accion, 'TIPO_CASO_CREADO');
            const r2 = res();
            await admin.createTipoCaso(req({ nombre: 'Repetido', area: 'WAN', nivel: 1 }), r2);
            assert.strictEqual(r2.code, 409);
            const r3 = res();
            await admin.updateTipoCaso(req({ nivel: 2, area: 'WAN', activo: false }), r3);
            assert.strictEqual(r3.code, 200, JSON.stringify(r3.body));
            assert.deepStrictEqual([r3.body.tipo.area, r3.body.tipo.nivel, r3.body.tipo.puntos, r3.body.tipo.activo], ['REDES_FTTH', 2, 4, false]);
            const a = audits.pop();
            assert.strictEqual(a.accion, 'TIPO_CASO_EDITADO');
            assert.ok(a.detalles.includes('nivel 2 (4 pts)') && a.detalles.includes('desactivado'), a.detalles);
        } finally { restaurar(); }
    });

    await t('Casos comunes: ocurrencia, tasa por día, tiempo real vs estimado; "Otro" por área y nivel', () => {
        const range = getPeriodBounds('semana', '2026-10-07');
        const base = { estado_actual: 'RESUELTO', asignado_a: null };
        const tickets = [
            { ...base, codigo_incidencia: 'A1', area_designada: 'REDES_FTTH', tipo_caso_id: 'tp-mac', tipo_caso: TIPO_MAC, nivel: 1, puntos_complejidad: 2, createdAt: d('2026-10-06T13:00:00Z'), resueltoEn: d('2026-10-06T13:20:00Z') },
            { ...base, codigo_incidencia: 'A2', area_designada: 'REDES_FTTH', tipo_caso_id: 'tp-mac', tipo_caso: TIPO_MAC, nivel: 1, puntos_complejidad: 2, createdAt: d('2026-10-07T13:00:00Z'), resueltoEn: d('2026-10-07T13:40:00Z') },
            { ...base, codigo_incidencia: 'A3', area_designada: 'REDES_FTTH', tipo_caso_id: 'tp-olt', tipo_caso: TIPO_OLT, nivel: 4, puntos_complejidad: 10, createdAt: d('2026-10-07T14:00:00Z'), resueltoEn: d('2026-10-07T15:00:00Z') },
            { ...base, codigo_incidencia: 'A4', area_designada: 'WAN', nivel: 2, puntos_complejidad: 4, createdAt: d('2026-10-08T14:00:00Z'), resueltoEn: null, estado_actual: 'EN_PROGRESO' },
            { ...base, codigo_incidencia: 'A5', area_designada: 'SEGURIDAD', nivel: 2, puntos_complejidad: 4, createdAt: d('2026-10-08T15:00:00Z'), resueltoEn: d('2026-10-08T16:00:00Z') },
            { ...base, codigo_incidencia: 'A6', area_designada: 'WAN', createdAt: d('2026-10-08T15:00:00Z'), estado_actual: 'NUEVO' },
            { ...base, codigo_incidencia: 'A0', area_designada: 'WAN', tipo_caso_id: 'tp-wan', tipo_caso: TIPO_WAN, nivel: 1, createdAt: d('2026-09-01T15:00:00Z'), resueltoEn: d('2026-09-01T16:00:00Z') }
        ];
        const cc = tc.buildCasosComunes({ tickets, range });
        assert.deepStrictEqual([cc.dias, cc.recibidos, cc.clasificados, cc.sinClasificar], [7, 6, 5, 1], 'A0 llegó fuera del periodo');
        const mac = cc.filas[0];
        assert.deepStrictEqual([mac.nombre, mac.ocurrencias, mac.porDia, mac.participacion, mac.resueltos, mac.puntos, mac.frecuencia], ['MAC en Rojo', 2, 0.3, 0.4, 2, 4, 'Alta']);
        assert.deepStrictEqual([mac.tiempoPromedioMin, mac.minutosEstimados, mac.sobreEstimado], [30, 15, true], 'promedio, no mediana');
        const olt = cc.filas.find(f => f.tipoId === 'tp-olt');
        assert.deepStrictEqual([olt.tiempoPromedioMin, olt.sobreEstimado], [60, false]);
        const otros = cc.filas.filter(f => !f.tipoId).map(f => `${f.nombre}@${f.area}`).sort();
        assert.deepStrictEqual(otros, ['Otro (nivel 2)@Seguridad', 'Otro (nivel 2)@WAN'], 'no mezcla áreas');
        // En el reporte y su vista
        const rep = buildPeriodReport({ tickets, operators: [], range });
        assert.strictEqual(rep.casosComunes.filas.length, 4);
        assert.ok(rep.lecturas.some(l => l.startsWith('Caso más común: MAC en Rojo')), rep.lecturas.join(' | '));
        assert.ok(rep.lecturas.some(l => l.startsWith('Tardan más de lo estimado: MAC en Rojo')));
        assert.deepStrictEqual(rep.detalle.find(x => x.codigo === 'A3').tipoCaso, 'Configuración de OLT');
        const v = buildReportView(rep, { periodo: 'semana' });
        assert.deepStrictEqual([v.casos.filas[0].ancho, v.casos.filas[0].pct], [100, 40]);
    });

    await t('Simulación: los casos del catálogo según su frecuencia, con su nivel y su tiempo', () => {
        const tipos = [TIPO_MAC, TIPO_OLT, TIPO_WAN].map(x => ({ id: x.id, nombre: x.nombre, area: x.area_codigo, nivel: x.nivel, minutos: x.minutos_estimados, frecuencia: x.frecuencia }));
        const sim = buildSimulation({ fecha: '2026-10-07', cantidad: 400, seed: 11, tipos, sinAsignar: 0 });
        const ftth = sim.tickets.filter(x => x.area === 'REDES_FTTH' && x.operadorKey);
        const mac = ftth.filter(x => x.tipoId === 'tp-mac').length;
        const olt = ftth.filter(x => x.tipoId === 'tp-olt').length;
        assert.ok(mac > olt * 1.5, `Alta (${mac}) llega más que Media (${olt})`);
        assert.ok(ftth.filter(x => !x.tipoId).length > 0, 'algunos son "Otro"');
        ftth.filter(x => x.tipoId).forEach(x => {
            const tp = tipos.find(y => y.id === x.tipoId);
            assert.deepStrictEqual([x.asunto, x.nivel, x.puntos], [tp.nombre, tp.nivel, tc.puntosDeNivel(tp.nivel)]);
        });
        assert.ok(sim.tickets.filter(x => x.area === 'TELEFONIA').every(x => !x.tipoId), 'área sin catálogo: niveles al azar');
        const cola = buildSimulation({ fecha: '2026-10-07', cantidad: 60, seed: 3, tipos, sinAsignar: 40 }).tickets.filter(x => !x.operadorKey);
        assert.ok(cola.length && cola.every(x => x.nivel === null && x.puntos === 0 && !x.tipoId), 'los de la cola esperan a quien los tome');
        const movidos = asignarAReales(ftth.slice(0, 3), [{ id: 'u1', nombre: 'Real WAN', area_designada: 'WAN' }]);
        assert.ok(movidos.every(x => x.area === 'WAN' && x.tipoId === null && x.nivel), 'si cambia de área queda "Otro" con su nivel');
    });

    await t('Migración: tabla TipoCaso, prioridad desde los puntos viejos y catálogo de los Excel', () => {
        const dir = path.join(__dirname, '..', 'prisma', 'migrations');
        const sql = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(x => x.endsWith('_tipos_caso')), 'migration.sql'), 'utf8');
        assert.ok(/CREATE TABLE "TipoCaso"/.test(sql) && /ENABLE ROW LEVEL SECURITY/.test(sql));
        assert.ok(/WHEN 8 THEN 'P1' WHEN 5 THEN 'P2' WHEN 1 THEN 'P3'/.test(sql));
        assert.ok(!/\bDROP\b|DELETE FROM|TRUNCATE/i.test(sql), 'no borra nada');
        const filas = sql.match(/^\s+\('.+', [1-4], \d+, '(ALTA|MEDIA|BAJA)', .+\),?$/gm) || [];
        assert.strictEqual(filas.length, 40 + 13, 'FTTx 40 + WAN 13');
        assert.ok(sql.includes("('Corrección de errores de enlaces (Óptica)', 3, 360, 'MEDIA', 'Óptica')"), 'nivel 3: los puntos siguen al nivel');
        assert.ok(/ON CONFLICT \("area_codigo", "nombre"\) DO NOTHING/.test(sql), 'se puede volver a correr');
    });

    console.log(`\nResultado: ${passed}/${total} pruebas pasaron`);
    process.exit(passed === total ? 0 : 1);
})();
