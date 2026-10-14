// Pruebas de la simulación de jornada: determinismo, marcas y coherencia con el reporte.
const assert = require('assert');
const { buildSimulation, buildDemo, OPERADORES, MARCA_REMITENTE, PREFIJO_CODIGO, DOMINIO_DEMO } = require('../src/services/simulationService');
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

t('Equipo demo como el diseño: 14 operadores en las 7 áreas, guardia, horarios y uno en terreno', () => {
    assert.strictEqual(OPERADORES.length, 14);
    assert.strictEqual(new Set(OPERADORES.map(o => o.area)).size, 7);
    assert.strictEqual(OPERADORES.filter(o => o.guardia).length, 3);
    assert.ok(OPERADORES.some(o => o.horario) && OPERADORES.some(o => o.estado === 'EN_TERRENO'));
});
t('Modo demo: ayer completo + hoy hasta ahora, códigos únicos y traspaso con los pendientes de ayer', () => {
    const ahora = new Date('2026-10-13T19:00:00Z'); // 15:00 Caracas
    const d = buildDemo({ ahora, porDia: 55, seed: 7 });
    assert.deepStrictEqual(d.dias.map(x => x.fecha), ['2026-10-12', '2026-10-13']);
    assert.strictEqual(d.dias[0].tickets.length, 55);
    assert.ok(d.dias[1].tickets.length > 20 && d.dias[1].tickets.length < 55, 'a las 15:00 ya llegó buena parte del día');
    assert.strictEqual(new Set(d.tickets.map(x => x.codigo)).size, d.tickets.length);
    for (const x of d.dias[1].tickets) for (const f of [x.creado, x.asignado, x.resuelto, x.cierre]) if (f) assert.ok(f <= ahora);
    const estados = new Set(d.tickets.map(x => x.estado));
    ['NUEVO', 'EN_PROGRESO', 'RESUELTO', 'CERRADO'].forEach(e => assert.ok(estados.has(e), e));
    assert.ok(d.tickets.some(x => x.estado === 'EN_ESPERA_TERCEROS' || x.estado === 'EN_PAUSA'));
    const ayer = new Map(d.dias[0].tickets.map(x => [x.codigo, x]));
    assert.ok(d.traspaso && d.traspaso.codigos.length > 0);
    assert.ok(d.traspaso.codigos.every(c => ayer.has(c) && !['RESUELTO', 'CERRADO'].includes(ayer.get(c).estado)));
    assert.ok(d.traspaso.nota.startsWith(MARCA_REMITENTE) && d.traspaso.nota.length >= 10);
    const temprano = buildDemo({ ahora: new Date('2026-10-13T11:00:00Z'), porDia: 55 }); // 07:00
    assert.ok(temprano.dias[1].tickets.length <= 6, 'de madrugada llegan pocos');
});

console.log(`\n   RESUMEN: ${passed}/${total} pruebas pasaron correctamente\n`);
process.exit(passed === total ? 0 : 1);
