// Pruebas de la asignación sugerida, la cola de espera y las reglas (sin base de datos).
const assert = require('assert');
const { guardWindow, eligibility, suggest, buildSuggestions, normalizeOperator } = require('../src/services/assignmentService');
const { DEFAULT_RULES, mergeRules, ageLimitFor, overloadOptions } = require('../src/services/rulesService');
const { agingTickets } = require('../src/services/dashboardService');
const { computeOverload } = require('../src/services/metricsService');

let total = 0, passed = 0;
function t(name, fn) { total++; try { fn(); passed++; console.log(`  ✅ [PASS] ${name}`); } catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.message}`); } }

const at = (hhmm, dia = '2026-10-13') => new Date(`${dia}T${hhmm}:00-04:00`); // martes
const op = o => Object.assign({ id: 'x', nombre: 'X', area: 'WAN', carga: 0, sobrecarga: false, deGuardia: false, disponible: true, ausente: false }, o);

console.log('\n=== PRUEBAS: ASIGNACIÓN SUGERIDA Y REGLAS ===\n');

t('Ventana de guardia: entre semana desde las 17:00; fin de semana desde las 08:00', () => {
    assert.deepStrictEqual(guardWindow(at('16:40')), { inicio: '17:00', dentro: false, faltan: 20 });
    assert.strictEqual(guardWindow(at('18:00')).dentro, true);
    assert.strictEqual(guardWindow(at('09:00', '2026-10-17')).dentro, true, 'sábado');
});

t('Elegibilidad: en turno y disponible; nunca ausente ni con sobrecarga', () => {
    assert.strictEqual(eligibility(op({}), at('10:00')).elegible, true);
    assert.strictEqual(eligibility(op({ disponible: false }), at('10:00')).elegible, false, 'en terreno o fuera de turno');
    assert.strictEqual(eligibility(op({ ausente: true }), at('10:00')).elegible, false);
    assert.strictEqual(eligibility(op({ sobrecarga: true }), at('10:00')).motivo, 'Sobrecarga');
});

t('Guardia: solo durante su guardia o si empieza en menos de 30 min', () => {
    const g = op({ deGuardia: true, disponible: false });
    assert.strictEqual(eligibility(g, at('10:00')).elegible, false);
    assert.strictEqual(eligibility(g, at('10:00')).motivo, 'De guardia desde las 17:00');
    assert.deepStrictEqual(eligibility(g, at('16:40')), { elegible: true, motivo: 'Su guardia empieza en 20 min' });
    assert.strictEqual(eligibility(g, at('20:00')).elegible, true);
    const reglas = mergeRules({ sugerencia: { guardiaAntesMin: 10 } });
    assert.strictEqual(eligibility(g, at('16:40'), reglas).elegible, false, 'umbral configurable');
});

t('Sugerencia: el elegible de menor carga del área; si nadie, null', () => {
    const ops = [op({ id: 'a', nombre: 'Ana', carga: 4 }), op({ id: 'b', nombre: 'Beto', carga: 1 }), op({ id: 'c', nombre: 'Carla', carga: 0, sobrecarga: true }), op({ id: 'd', nombre: 'Dani', area: 'TELEFONIA', carga: 0 })];
    assert.strictEqual(suggest(ops, 'WAN', at('10:00')).id, 'b');
    assert.strictEqual(suggest(ops, 'SEGURIDAD', at('10:00')), null);
    assert.strictEqual(suggest(ops, 'WAN', at('10:00'), DEFAULT_RULES, { otraArea: true }).id, 'd');
});

t('Cola de espera: sin asignar y nadie disponible en su área; otra área opcional', () => {
    const ops = [op({ id: 'a', area: 'WAN' })];
    const tickets = [
        { codigo_incidencia: 'INC-1', area_designada: 'WAN', estado_actual: 'NUEVO', asignado_a_id: null },
        { codigo_incidencia: 'INC-2', area_designada: 'SEGURIDAD', estado_actual: 'NUEVO', asignado_a_id: null },
        { codigo_incidencia: 'INC-3', area_designada: 'SEGURIDAD', estado_actual: 'EN_PROGRESO', asignado_a_id: 'z' },
        { codigo_incidencia: 'INC-4', area_designada: 'SEGURIDAD', estado_actual: 'RESUELTO', asignado_a_id: null }
    ];
    const s = buildSuggestions({ operadores: ops, areas: ['WAN', 'SEGURIDAD'], tickets, now: at('10:00') });
    assert.deepStrictEqual(s.enCola, ['INC-2']);
    assert.strictEqual(s.otraArea.SEGURIDAD.id, 'a');
    assert.strictEqual(s.otraArea.WAN, null, 'solo se calcula cuando el área no tiene a nadie');
    const sinOtra = buildSuggestions({ operadores: ops, areas: ['SEGURIDAD'], tickets, now: at('10:00'), rules: mergeRules({ sugerencia: { permitirOtraArea: false } }) });
    assert.strictEqual(sinOtra.otraArea.SEGURIDAD, null);
});

t('Sugerencia: a igual elegibilidad, va a quien tiene menos puntos activos', () => {
    const base = { area_designada: 'WAN', estado_operativo: 'DISPONIBLE', turno: { codigo: 'EN_TURNO', disponible: true } };
    const ops = [
        normalizeOperator({ ...base, id: 'a', nombre: 'Ana', tickets_asignados: [{ puntos_complejidad: 10 }] }),
        normalizeOperator({ ...base, id: 'b', nombre: 'Beto', tickets_asignados: [{ puntos_complejidad: 2 }, { puntos_complejidad: 2 }] })
    ];
    assert.strictEqual(suggest(ops, 'WAN', at('10:00')).id, 'b', '2 tickets N1 (4 pts) pesan menos que 1 N4 (10 pts)');
});

t('normalizeOperator: desde el operador del controlador', () => {
    const n = normalizeOperator({ id: 'a', nombre: 'Ana', area_designada: 'WAN', estado_operativo: 'DISPONIBLE', deGuardia: false, turno: { codigo: 'EN_TURNO', disponible: true }, tickets_asignados: [1, 2] });
    assert.deepStrictEqual(n, { id: 'a', nombre: 'Ana', area: 'WAN', carga: 2, puntosCarga: 4, sobrecarga: false, deGuardia: false, disponible: true, ausente: false });
});

t('Reglas: valores por defecto y combinación con datos inválidos', () => {
    assert.deepStrictEqual(DEFAULT_RULES.antiguedad, { activa: true, P1: 60, P2: 120, P3: 240, SP: 30 });
    const r = mergeRules({ antiguedad: { P1: 45, P2: -3, SP: 'x' }, sobrecarga: { multiplicador: 2 } });
    assert.deepStrictEqual(r.antiguedad, { activa: true, P1: 45, P2: 120, P3: 240, SP: 30 });
    assert.deepStrictEqual(r.sobrecarga, { activa: true, multiplicador: 2, minimo: 3 });
    assert.strictEqual(mergeRules({ sobrecarga: { multiplicador: 9 } }).sobrecarga.multiplicador, 3, 'tope del paso');
    assert.strictEqual(ageLimitFor('P1'), 60);
    assert.strictEqual(ageLimitFor('P7'), 30, 'prioridad desconocida = sin prioridad');
});

t('Interruptores: sin antigüedad, sin sobrecarga y sin guardia anticipada', () => {
    const tk = { codigo_incidencia: 'INC-9', estado_actual: 'NUEVO', puntos_complejidad: 8, asignado_a_id: null, createdAt: at('07:00') };
    assert.strictEqual(agingTickets([tk], at('10:00'), mergeRules({ antiguedad: { activa: false } })).length, 0);
    const ops = [{ id: 'a', cargaActual: 4 }, { id: 'b', cargaActual: 1 }, { id: 'c', cargaActual: 1 }];
    assert.strictEqual(computeOverload(ops, overloadOptions(mergeRules({ sobrecarga: { activa: false } }))).get('a').sobrecarga, false);
    const g = op({ deGuardia: true, disponible: false });
    assert.strictEqual(eligibility(g, at('16:40'), mergeRules({ sugerencia: { incluirGuardia: false } })).elegible, false);
    assert.strictEqual(eligibility(g, at('18:00'), mergeRules({ sugerencia: { incluirGuardia: false } })).elegible, true, 'durante su guardia sí');
});

t('Las reglas cambian la antigüedad y la sobrecarga', () => {
    const tk = { codigo_incidencia: 'INC-9', estado_actual: 'NUEVO', puntos_complejidad: 8, asignado_a_id: null, createdAt: at('09:00') };
    assert.strictEqual(agingTickets([tk], at('09:50')).length, 0);
    assert.strictEqual(agingTickets([tk], at('09:50'), mergeRules({ antiguedad: { P1: 45 } })).length, 1);
    const ops = [{ id: 'a', cargaActual: 4 }, { id: 'b', cargaActual: 1 }, { id: 'c', cargaActual: 1 }];
    assert.strictEqual(computeOverload(ops).get('a').sobrecarga, true);
    assert.strictEqual(computeOverload(ops, { ratio: 2.5, minimo: 3 }).get('a').sobrecarga, false);
});

console.log(`\n   RESUMEN: ${passed}/${total} pruebas pasaron correctamente\n`);
if (passed !== total) process.exit(1);
