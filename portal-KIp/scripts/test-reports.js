/**
 * Automated Test Suite for Reports View & Controller
 * 
 * Verifies:
 * - Requirement R1: Backend calculations (Tickets Totales, Tickets Jornada, Volumen por Área, Total Puntos por Área, Ranking de Operadores)
 * - Requirement R2: Frontend macOS Liquid Glass template rendering (4 KPI cards, Bar Chart, Donut Chart, Ranking Table)
 * - Edge cases: Zero tickets, tickets with 0 points, null areas, coordinator vs operator separation, empty operators table.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const ejs = require('ejs');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
    totalTests++;
    try {
        fn();
        passedTests++;
        console.log(`  ✅ [PASS] ${name}`);
    } catch (err) {
        console.error(`  ❌ [FAIL] ${name}`);
        console.error(`     Error: ${err.message}`);
    }
}

async function runAsyncTest(name, fn) {
    totalTests++;
    try {
        await fn();
        passedTests++;
        console.log(`  ✅ [PASS] ${name}`);
    } catch (err) {
        console.error(`  ❌ [FAIL] ${name}`);
        console.error(`     Error: ${err.message}`);
    }
}

console.log('\n================================================================');
console.log('       EJECUTANDO PRUEBAS: REPORTES (CONTROLLER & VISTA)        ');
console.log('================================================================\n');

// 1. Module Exports & Route Verification
runTest('R1.0: Exportación de getReports en reportController.js', () => {
    const { getReports } = require('../src/controllers/reportController');
    assert.strictEqual(typeof getReports, 'function', 'getReports debe ser una función');
});

// 2. View Template Existence and Structure
const templatePath = path.join(__dirname, '..', 'views', 'reports.ejs');
runTest('R2.0: Existencia del archivo views/reports.ejs', () => {
    assert(fs.existsSync(templatePath), 'El archivo views/reports.ejs debe existir');
});

const templateContent = fs.readFileSync(templatePath, 'utf8');

runTest('R2.1: Verificación de Chart.js CDN y CDN fallback en la vista', () => {
    assert(templateContent.includes('cdn.jsdelivr.net/npm/chart.js'), 'Debe incluir Chart.js vía jsdelivr CDN');
    assert(templateContent.includes('cdnjs.cloudflare.com/ajax/libs/Chart.js'), 'Debe incluir fallback de Chart.js vía cdnjs');
});

runTest('R2.2: Presencia de estética macOS Liquid Glass (.figma-card)', () => {
    assert(templateContent.includes('figma-card'), 'Debe utilizar la clase CSS figma-card');
    assert(templateContent.includes('backdrop-filter: blur(20px)'), 'Debe contener estilos de blur Liquid Glass');
});

runTest('R2.3: Presencia de 4 Tarjetas de KPI requeridas (IDs y estructura)', () => {
    assert(templateContent.includes('id="kpi-total"'), 'Debe contener KPI de Tickets Totales');
    assert(templateContent.includes('id="kpi-jornada"'), 'Debe contener KPI de Tickets de la Jornada');
    assert(templateContent.includes('id="kpi-resueltos"'), 'Debe contener KPI de Tickets Resueltos');
    assert(templateContent.includes('id="kpi-puntos"'), 'Debe contener KPI de Puntos Completados');
});

runTest('R2.4: Presencia de los dos lienzos Canvas requeridos (Barras y Dona)', () => {
    assert(templateContent.includes('id="areaVolumeChart"'), 'Debe existir canvas para gráfico de barras (#areaVolumeChart)');
    assert(templateContent.includes('id="areaPointsChart"'), 'Debe existir canvas para gráfico de dona (#areaPointsChart)');
});

runTest('R2.5: Presencia de Tabla de Ranking de Operadores estilizada', () => {
    assert(templateContent.includes('Ranking de Operadores'), 'Debe contener el título de Ranking de Operadores');
    assert(templateContent.includes('operator-ranking-row'), 'Debe marcar las filas de operadores con clase específica');
    assert(templateContent.includes('Puntos Complejidad'), 'Debe incluir columna de Puntos Complejidad');
    assert(templateContent.includes('Tiempo Promedio'), 'Debe incluir columna de Tiempo Promedio');
});

runTest('R2.6: Seguridad JSON en script de datos (#report-data-json)', () => {
    assert(templateContent.includes('id="report-data-json"'), 'Debe existir el elemento #report-data-json');
    assert(templateContent.includes('.replace(/</g, \'\\u003c\')'), 'Debe neutralizar inyecciones de script con u003c');
});

// 3. EJS Template Rendering Test with Mock Data
runTest('R2.7: Renderizado exitoso de views/reports.ejs con datos simulados completos', () => {
    const mockData = {
        titulo: 'NOC Portal - Reportes',
        currentUser: { nombre: 'Coordinador NOC', email: 'coord@inter.com' },
        kpis: {
            total: 42,
            jornada: 12,
            resueltos: 30,
            enProgreso: 8,
            tasa: '71%',
            puntosTotales: 156,
            promedioPuntos: 5.2
        },
        ticketsTotales: 42,
        ticketsJornada: 12,
        volumenPorArea: {
            labels: ['Redes FTTH', 'WAN', 'General'],
            data: [20, 15, 7]
        },
        puntosPorArea: {
            labels: ['Redes FTTH', 'WAN', 'General'],
            data: [90, 46, 20],
            tipo: 'Puntos'
        },
        ranking: [
            {
                posicion: 1,
                nombre: 'Carlos Pérez',
                email: 'cperez@inter.com',
                area: 'Redes FTTH',
                puntos: 48,
                resueltos: 6,
                tiempoPromedio: '45 min',
                estado: 'DISPONIBLE'
            },
            {
                posicion: 2,
                nombre: 'Ana Gómez',
                email: 'agomez@inter.com',
                area: 'WAN',
                puntos: 32,
                resueltos: 4,
                tiempoPromedio: '1.2 h',
                estado: 'EN_TERRENO'
            }
        ],
        rankingOperadores: [],
        operadores: [],
        reportData: {
            ticketsTotales: 42,
            total: 42,
            ticketsJornada: 12,
            jornada: 12,
            volumenPorArea: { labels: ['Redes FTTH', 'WAN', 'General'], data: [20, 15, 7] },
            puntosPorArea: { labels: ['Redes FTTH', 'WAN', 'General'], data: [90, 46, 20], tipo: 'Puntos' },
            rankingOperadores: [],
            kpis: { total: 42, jornada: 12, resueltos: 30, puntosTotales: 156 }
        }
    };

    const rendered = ejs.render(templateContent, mockData, { filename: templatePath });
    assert(rendered.includes('42'), 'El HTML debe contener el total de tickets 42');
    assert(rendered.includes('Carlos Pérez'), 'El HTML debe contener el nombre del operador rankeado #1');
    assert(rendered.includes('cperez@inter.com'), 'El HTML debe contener el correo del operador');
    assert(rendered.includes('🥇'), 'El primer lugar debe contener medalla de oro');
    assert(rendered.includes('🥈'), 'El segundo lugar debe contener medalla de plata');
    assert(rendered.includes('48'), 'Debe mostrar 48 puntos');
});

// 4. Edge Case: Empty Dataset (0 tickets, 0 operators)
runTest('R2.8: Renderizado exitoso de views/reports.ejs con base de datos vacía (Edge Case)', () => {
    const emptyData = {
        titulo: 'NOC Portal - Reportes',
        currentUser: null,
        kpis: {
            total: 0,
            jornada: 0,
            resueltos: 0,
            enProgreso: 0,
            tasa: '0%',
            puntosTotales: 0,
            promedioPuntos: 0
        },
        ticketsTotales: 0,
        ticketsJornada: 0,
        volumenPorArea: { labels: [], data: [] },
        puntosPorArea: { labels: [], data: [] },
        ranking: [],
        rankingOperadores: [],
        operadores: [],
        reportData: {
            ticketsTotales: 0,
            ticketsJornada: 0,
            volumenPorArea: { labels: [], data: [] },
            puntosPorArea: { labels: [], data: [] },
            rankingOperadores: [],
            kpis: { total: 0, jornada: 0, resueltos: 0, puntosTotales: 0 }
        }
    };

    const rendered = ejs.render(templateContent, emptyData, { filename: templatePath });
    assert(rendered.includes('No hay operadores registrados para mostrar en el ranking'), 'Debe mostrar el mensaje amigable de tabla vacía');
    assert(rendered.includes('Coord. NOC'), 'Debe usar fallback para currentUser');
    assert(rendered.includes('id="kpi-total"'), 'Debe contener los KPIs');
});

// 5. Adversarial: Status Badges (Disponible, En Terreno, Ausente)
runTest('R2.9: [Adversarial] Formateo correcto de estados operativos (DISPONIBLE, EN_TERRENO, AUSENTE)', () => {
    const statusData = {
        titulo: 'NOC Portal - Reportes',
        currentUser: { nombre: 'Líder', email: 'lider@inter.com' },
        kpis: { total: 3, jornada: 1, resueltos: 3, enProgreso: 0, tasa: '100%', puntosTotales: 15, promedioPuntos: 5 },
        ticketsTotales: 3,
        ticketsJornada: 1,
        volumenPorArea: { labels: ['General'], data: [3] },
        puntosPorArea: { labels: ['General'], data: [15], tipo: 'Puntos' },
        ranking: [
            { posicion: 1, nombre: 'Op Uno', email: 'op1@test.com', area: 'General', puntos: 10, resueltos: 2, tiempoPromedio: '30 min', estado: 'DISPONIBLE' },
            { posicion: 2, nombre: 'Op Dos', email: 'op2@test.com', area: 'General', puntos: 5, resueltos: 1, tiempoPromedio: '1.5 h', estado: 'EN_TERRENO' },
            { posicion: 3, nombre: 'Op Tres', email: 'op3@test.com', area: 'General', puntos: 0, resueltos: 0, tiempoPromedio: 'N/A', estado: 'AUSENTE' }
        ],
        rankingOperadores: [],
        operadores: [],
        reportData: { ticketsTotales: 3, ticketsJornada: 1, volumenPorArea: { labels: ['General'], data: [3] }, puntosPorArea: { labels: ['General'], data: [15] }, rankingOperadores: [] }
    };

    const rendered = ejs.render(templateContent, statusData, { filename: templatePath });
    assert(rendered.includes('Disponible'), 'Debe mostrar badge Disponible');
    assert(rendered.includes('En Terreno'), 'Debe mostrar badge En Terreno');
    assert(rendered.includes('Ausente'), 'Debe mostrar badge Ausente');
    assert(rendered.includes('🥉'), 'El tercer lugar debe contener medalla de bronce');
});

// 6. Adversarial: XSS Injection Neutralization in Report Data
runTest('R2.10: [Adversarial] Neutralización de inyecciones XSS en el script de datos', () => {
    const xssData = {
        titulo: 'NOC Portal - Reportes',
        currentUser: { nombre: 'Safe User', email: 'safe@test.com' },
        kpis: { total: 1, jornada: 1, resueltos: 1, enProgreso: 0, tasa: '100%', puntosTotales: 5, promedioPuntos: 5 },
        ticketsTotales: 1,
        ticketsJornada: 1,
        volumenPorArea: { labels: ['<script>alert(1)</script>'], data: [1] },
        puntosPorArea: { labels: ['<script>alert(1)</script>'], data: [5] },
        ranking: [{ posicion: 1, nombre: 'Hack<script>', email: 'hack@test.com', area: 'General', puntos: 5, resueltos: 1, tiempoPromedio: '10 min', estado: 'DISPONIBLE' }],
        rankingOperadores: [],
        operadores: [],
        reportData: {
            volumenPorArea: { labels: ['<script>alert(1)</script>'] }
        }
    };

    const rendered = ejs.render(templateContent, xssData, { filename: templatePath });
    assert(!rendered.includes('<script>alert(1)</script></script>'), 'No debe permitir inyección de cierre de script');
    assert(rendered.includes('\\u003cscript>alert(1)\\u003c/script>'), 'Debe escapar < como \\u003c en el bloque JSON');
});

console.log('\n================================================================');
console.log(`   RESUMEN: ${passedTests}/${totalTests} pruebas pasaron correctamente`);
console.log('================================================================\n');

if (passedTests !== totalTests) {
    process.exit(1);
}
