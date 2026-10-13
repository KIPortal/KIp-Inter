// Pruebas de la simulación de jornada: determinismo, marcas y coherencia con el reporte.
const assert = require('assert');
const { buildSimulation, MARCA_REMITENTE, PREFIJO_CODIGO, DOMINIO_DEMO } = require('../src/services/simulationService');
const { buildPeriodReport } = require('../src/services/periodReportService');
const { getPeriodBounds } = require('../src/services/metricsService');

let total = 0, passed = 0;
function t(name, fn) { total++; try { fn(); passed++; console.log(`  ✅ [PASS] ${name}`); } catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.message}`); } }

console.log('\n=== PRUEBAS: SIMULACIÓN DE JORNADA ===\n');
const sim = buildSimulation({ fecha: '2026-10-12', cantidad: 60, seed: 7 });

t('Determinista: misma semilla, mismo resultado', () => {
    assert.deepStrictEqual(buildSimulation({ fecha: '2026-10-12', cantidad: 60, seed: 7 }), sim);
    assert.notDeepStrictEqual(buildSimulation({ fecha: '2026-10-12', cantidad: 60, seed: 8 }).tickets.map(x => +x.creado), sim.tickets.map(x => +x.creado));
});
t('Marcado: códigos SIM-, operadores @demo.local, cantidad pedida', () => {
    assert.strictEqual(sim.tickets.length, 60);
    assert.ok(sim.tickets.every(x => x.codigo.startsWith(PREFIJO_CODIGO)));
    assert.ok(sim.operadores.every(o => o.email.endsWith('@' + DOMINIO_DEMO)));
    assert.ok(MARCA_REMITENTE);
});
t('Todo ocurre dentro del día de Caracas y en orden cronológico', () => {
    const { start, end } = getPeriodBounds('jornada', '2026-10-12');
    for (const x of sim.tickets) {
        assert.ok(x.creado >= start && x.creado < end);
        if (x.asignado) assert.ok(x.asignado > x.creado);
        if (x.resuelto) assert.ok(x.resuelto > x.asignado);
        if (x.cierre) assert.ok(x.cierre > x.resuelto);
    }
});
t('Estados coherentes con las fechas', () => {
    for (const x of sim.tickets) {
        if (x.estado === 'CERRADO') assert.ok(x.cierre && x.resuelto);
        if (x.estado === 'RESUELTO') assert.ok(x.resuelto && !x.cierre);
        if (x.estado === 'NUEVO') assert.ok(!x.operadorKey);
    }
    assert.ok(new Set(sim.tickets.map(x => x.estado)).size >= 3);
});
t('Si es hoy, nada ocurre después de "ahora"', () => {
    const ahora = new Date('2026-10-12T16:00:00Z'); // 12:00 Caracas
    const s = buildSimulation({ fecha: '2026-10-12', cantidad: 30, seed: 3, ahora });
    for (const x of s.tickets) for (const d of [x.creado, x.asignado, x.resuelto, x.cierre]) if (d) assert.ok(d < ahora);
});
t('Alimenta el reporte del periodo sin errores y con sobrecarga en WAN', () => {
    const ops = sim.operadores.map(o => ({ id: o.key, nombre: o.nombre, area_designada: o.area, estado_operativo: 'DISPONIBLE' }));
    const tickets = sim.tickets.map(x => ({
        id: x.codigo, codigo_incidencia: x.codigo, asunto: x.asunto, remitente: MARCA_REMITENTE, estado_actual: x.estado,
        puntos_complejidad: x.puntos, area_designada: x.area, asignado_a_id: x.operadorKey, createdAt: x.creado,
        fecha_asignacion: x.asignado, resueltoEn: x.resuelto, fecha_cierre: x.cierre,
        asignado_a: x.operadorKey ? ops.find(o => o.id === x.operadorKey) : null
    }));
    const r = buildPeriodReport({ tickets, operators: ops, range: getPeriodBounds('jornada', '2026-10-12'), area: null });
    assert.strictEqual(r.resumen.creados, 60);
    assert.strictEqual(r.flujoHorario.length, 24);
    assert.ok(r.porOperador.length >= 5);
});

console.log(`\n   RESUMEN: ${passed}/${total} pruebas pasaron correctamente\n`);
process.exit(passed === total ? 0 : 1);
