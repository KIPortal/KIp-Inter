/**
 * Pruebas de src/services/metricsService.js (funciones puras, sin base de datos).
 * Ejecutar: npm run test:metrics
 *
 * Las pruebas son independientes de la zona horaria de la máquina.
 */

const assert = require('assert');
const {
    ACTIVE_STATES,
    getDayBounds,
    getHourOfDay,
    getClosingDate,
    getResolutionMinutes,
    averageResolutionMinutes,
    formatMinutes,
    computeOverload
} = require('../src/services/metricsService');

let total = 0;
let passed = 0;

function runTest(name, fn) {
    total++;
    try {
        fn();
        passed++;
        console.log(`  ✅ [PASS] ${name}`);
    } catch (err) {
        console.error(`  ❌ [FAIL] ${name}`);
        console.error(`     Error: ${err.message}`);
    }
}

const iso = date => date.toISOString();

console.log('\n================================================================');
console.log('          EJECUTANDO PRUEBAS: MÉTRICAS (metricsService)         ');
console.log('================================================================\n');

// ---------------------------------------------------------------------------
// Día y hora en Caracas (UTC-4)
// ---------------------------------------------------------------------------
runTest('Día: 22:00 de Caracas pertenece al mismo día aunque en UTC ya sea el siguiente', () => {
    const { start, end } = getDayBounds(new Date('2026-10-11T02:00:00Z')); // 10 oct, 22:00 Caracas
    assert.strictEqual(iso(start), '2026-10-10T04:00:00.000Z');
    assert.strictEqual(iso(end), '2026-10-11T04:00:00.000Z');
});

runTest('Día: 23:59:59 de Caracas sigue en el día anterior', () => {
    const { start } = getDayBounds(new Date('2026-10-10T03:59:59Z')); // 9 oct, 23:59:59 Caracas
    assert.strictEqual(iso(start), '2026-10-09T04:00:00.000Z');
});

runTest('Día: 00:00:00 de Caracas abre el día nuevo (límite inclusivo)', () => {
    const { start, end } = getDayBounds(new Date('2026-10-10T04:00:00Z'));
    assert.strictEqual(iso(start), '2026-10-10T04:00:00.000Z');
    assert.strictEqual(iso(end), '2026-10-11T04:00:00.000Z');
});

runTest('Día: el inicio de un día es exactamente 24 h antes que el fin', () => {
    const { start, end } = getDayBounds(new Date('2026-01-15T15:30:00Z'));
    assert.strictEqual(end.getTime() - start.getTime(), 24 * 3600 * 1000);
});

runTest('Hora: 22:30 UTC es 18:00 en Caracas', () => {
    assert.strictEqual(getHourOfDay(new Date('2026-10-10T22:30:00Z')), 18);
});

runTest('Hora: 03:59 UTC es 23:00 del día anterior en Caracas', () => {
    assert.strictEqual(getHourOfDay(new Date('2026-10-10T03:59:00Z')), 23);
});

// ---------------------------------------------------------------------------
// Tiempo de resolución
// ---------------------------------------------------------------------------
runTest('Cierre: usa resueltoEn; fecha_cierre solo como respaldo; nunca updatedAt', () => {
    const a = new Date('2026-10-10T15:00:00Z');
    const b = new Date('2026-10-10T16:00:00Z');
    assert.strictEqual(getClosingDate({ fecha_cierre: a, resueltoEn: b }), b);
    assert.strictEqual(getClosingDate({ fecha_cierre: a, resueltoEn: null }), a);
    assert.strictEqual(getClosingDate({ updatedAt: b, estado_actual: 'CERRADO' }), null);
});

runTest('Tiempo: 90 minutos entre llegada y cierre', () => {
    const minutes = getResolutionMinutes({
        createdAt: new Date('2026-10-10T12:00:00Z'),
        fecha_cierre: new Date('2026-10-10T13:30:00Z')
    });
    assert.strictEqual(minutes, 90);
});

runTest('Tiempo: sin cierre, sin llegada o con orden imposible devuelve null', () => {
    const createdAt = new Date('2026-10-10T12:00:00Z');
    assert.strictEqual(getResolutionMinutes({ createdAt }), null);
    assert.strictEqual(getResolutionMinutes({ fecha_cierre: createdAt }), null);
    assert.strictEqual(getResolutionMinutes({ createdAt, fecha_cierre: new Date('2026-10-10T11:00:00Z') }), null);
});

runTest('Promedio: suma de tiempos ÷ cantidad, ignorando tickets sin tiempo válido', () => {
    const base = new Date('2026-10-10T12:00:00Z');
    const at = minutes => new Date(base.getTime() + minutes * 60000);
    const average = averageResolutionMinutes([
        { createdAt: base, fecha_cierre: at(60) },
        { createdAt: base, fecha_cierre: at(120) },
        { createdAt: base, fecha_cierre: null }
    ]);
    assert.strictEqual(average, 90);
});

runTest('Promedio: sin datos devuelve null (no 0)', () => {
    assert.strictEqual(averageResolutionMinutes([]), null);
    assert.strictEqual(averageResolutionMinutes(undefined), null);
});

runTest('Formato: min, h y N/A', () => {
    assert.strictEqual(formatMinutes(null), 'N/A');
    assert.strictEqual(formatMinutes(45), '45 min');
    assert.strictEqual(formatMinutes(90), '1.5 h');
    assert.strictEqual(formatMinutes(59.6), '1.0 h');
    assert.strictEqual(formatMinutes(0), '0 min');
});

// ---------------------------------------------------------------------------
// Estados activos
// ---------------------------------------------------------------------------
runTest('Activos: todo lo que no está cerrado', () => {
    assert.deepStrictEqual(ACTIVE_STATES, ['NUEVO', 'EN_PROGRESO', 'EN_PAUSA', 'EN_ESPERA_TERCEROS']);
    assert(!ACTIVE_STATES.includes('CERRADO'));
});

// ---------------------------------------------------------------------------
// Sobrecarga
// ---------------------------------------------------------------------------
const op = (id, cargaActual, extra = {}) => ({
    id, cargaActual, area_designada: 'WAN', estado_operativo: 'DISPONIBLE', ...extra
});

runTest('Sobrecarga: ejemplo de la especificación (promedio 4 → alerta desde 7)', () => {
    const seven = computeOverload([op('a', 7), op('b', 3), op('c', 3), op('d', 3)]); // promedio 4
    assert.strictEqual(seven.get('a').promedioArea, 4);
    assert.strictEqual(seven.get('a').indiceCarga, 1.75);
    assert.strictEqual(seven.get('a').sobrecarga, true);
    assert.strictEqual(seven.get('b').sobrecarga, false);

    const six = computeOverload([op('a', 6), op('b', 4), op('c', 3), op('d', 3)]); // promedio 4
    assert.strictEqual(six.get('a').indiceCarga, 1.5);
    assert.strictEqual(six.get('a').sobrecarga, false, 'exactamente 1.5 veces no es alerta');
});

runTest('Sobrecarga: mínimo de 3 tickets para no alertar con promedios casi nulos', () => {
    const result = computeOverload([op('a', 2), op('b', 0), op('c', 0)]);
    assert.strictEqual(result.get('a').indiceCarga, 3);
    assert.strictEqual(result.get('a').sobrecarga, false);
});

runTest('Sobrecarga: los operadores ausentes no bajan el promedio del área', () => {
    const result = computeOverload([
        op('a', 6),
        op('b', 3),
        op('c', 0, { estado_operativo: 'AUSENTE' })
    ]);
    // Sin contar al ausente: promedio 4.5 → índice 1.33 → sin alerta.
    // Si se contara: promedio 3 → índice 2 → alerta falsa.
    assert.strictEqual(result.get('a').promedioArea, 4.5);
    assert.strictEqual(result.get('a').sobrecarga, false);
});

runTest('Sobrecarga: un área con un solo operador no es comparable y no genera alerta', () => {
    const result = computeOverload([op('solo', 9)]);
    assert.deepStrictEqual(result.get('solo'), {
        comparable: false, promedioArea: null, indiceCarga: null, sobrecarga: false
    });
});

runTest('Sobrecarga: cada área se compara solo contra sus propios operadores', () => {
    const result = computeOverload([
        op('w1', 7, { area_designada: 'WAN' }),
        op('w2', 3, { area_designada: 'WAN' }),
        op('w3', 3, { area_designada: 'WAN' }),
        op('w4', 3, { area_designada: 'WAN' }),
        op('s1', 7, { area_designada: 'SEGURIDAD' }),
        op('s2', 7, { area_designada: 'SEGURIDAD' })
    ]);
    assert.strictEqual(result.get('w1').sobrecarga, true);
    assert.strictEqual(result.get('s1').sobrecarga, false, 'en Seguridad todos tienen la misma carga');
});

runTest('Sobrecarga: área sin tickets activos no divide por cero', () => {
    const result = computeOverload([op('a', 0), op('b', 0)]);
    assert.strictEqual(result.get('a').indiceCarga, 0);
    assert.strictEqual(result.get('a').sobrecarga, false);
});

runTest('Sobrecarga: lista vacía o indefinida devuelve un mapa vacío', () => {
    assert.strictEqual(computeOverload([]).size, 0);
    assert.strictEqual(computeOverload(undefined).size, 0);
});

console.log('\n================================================================');
console.log(`   RESUMEN: ${passed}/${total} pruebas pasaron correctamente`);
console.log('================================================================\n');

if (passed !== total) process.exit(1);
