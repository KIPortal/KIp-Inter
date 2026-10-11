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
const { getDayBounds } = require('../src/services/metricsService');

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

// Las pruebas asíncronas reemplazan temporalmente los métodos de prisma, así que
// se ejecutan en cola (una tras otra) y el resumen final espera a que terminen
// todas. Antes no se esperaban y process.exit() cortaba el proceso antes de que
// reportaran resultado.
let asyncQueue = Promise.resolve();

function runAsyncTest(name, fn) {
    totalTests++;
    asyncQueue = asyncQueue.then(async () => {
        try {
            await fn();
            passedTests++;
            console.log(`  ✅ [PASS] ${name}`);
        } catch (err) {
            console.error(`  ❌ [FAIL] ${name}`);
            console.error(`     Error: ${err.message}`);
        }
    });
    return asyncQueue;
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

// 7. New Requirements Tests (R1 & R2 Enhancements)
runTest('R2.11: Presencia del lienzo Canvas para gráfico de líneas (#hourlyFlowChart)', () => {
    assert(templateContent.includes('id="hourlyFlowChart"'), 'Debe existir canvas para gráfico de líneas (#hourlyFlowChart)');
});

runTest('R2.12: Presencia de Tarjeta de KPI para Área Crítica (#kpi-area-critica)', () => {
    assert(templateContent.includes('id="kpi-area-critica"'), 'Debe contener KPI de Área Crítica (#kpi-area-critica)');
    assert(templateContent.includes('Área Crítica'), 'Debe titular la tarjeta como Área Crítica');
});

runTest('R2.13: Columnas visuales de Eficiencia y Carga Actual en la tabla de ranking', () => {
    assert(templateContent.includes('Eficiencia'), 'Debe incluir columna de Eficiencia');
    assert(templateContent.includes('Carga Actual'), 'Debe incluir columna de Carga Actual');
    assert(templateContent.includes('activas (Baja)') || templateContent.includes('Baja'), 'Debe tener indicador para carga baja');
    assert(templateContent.includes('activas (Media)') || templateContent.includes('Media'), 'Debe tener indicador para carga media');
    assert(templateContent.includes('activas (Alta)') || templateContent.includes('Alta'), 'Debe tener indicador para carga alta');
});

runTest('R2.14: Presencia de Indicadores de Saturación Técnica (barras de progreso)', () => {
    assert(templateContent.includes('Indicadores de Saturación'), 'Debe incluir sección de indicadores de saturación');
    assert(templateContent.includes('BARRAS AGRUPADAS'), 'Debe identificar gráfico de barras agrupadas');
});

// 8. R1 Dynamic Controller Calculation Test with Mocked Prisma
runAsyncTest('R1.1: [End-to-End Async] Ejecución de getReports con cálculos dinámicos de R1', async () => {
    const prisma = require('../src/config/prisma');
    const { getReports } = require('../src/controllers/reportController');

    // Salvar métodos originales si existen
    const origCount = prisma.ticket.count;
    const origAgg = prisma.ticket.aggregate;
    const origGroupBy = prisma.ticket.groupBy;
    const origFindManyTicket = prisma.ticket.findMany;
    const origFindManyUser = prisma.user.findMany;

    let callCount = 0;
    prisma.ticket.count = async (args) => {
        callCount++;
        // 1. Total: 50, 2. Jornada: 15, 3. Resueltos: 35, 4. En progreso: 8
        if (callCount === 1) return 50;
        if (callCount === 2) return 15;
        if (callCount === 3) return 35;
        if (callCount === 4) return 8;
        return 0;
    };

    let aggCallCount = 0;
    prisma.ticket.aggregate = async (args) => {
        aggCallCount++;
        if (aggCallCount === 1) {
            return { _sum: { puntos_complejidad: 120 }, _avg: { puntos_complejidad: 3.4 } };
        }
        return { _sum: { puntos_complejidad: 150 } };
    };

    let groupByCallCount = 0;
    prisma.ticket.groupBy = async (args) => {
        groupByCallCount++;
        // 7: Volumen por área
        if (groupByCallCount === 1) {
            return [
                { area_designada: 'REDES_FTTH', _count: { id: 25 } },
                { area_designada: 'WAN', _count: { id: 15 } },
                { area_designada: 'GENERAL', _count: { id: 10 } }
            ];
        }
        // 8: Cerrados por área
        if (groupByCallCount === 2) {
            return [
                { area_designada: 'REDES_FTTH', _count: { id: 18 } },
                { area_designada: 'WAN', _count: { id: 12 } },
                { area_designada: 'GENERAL', _count: { id: 5 } }
            ];
        }
        // 9: Abiertos por área (Área Crítica) -> REDES_FTTH tiene 7, GENERAL tiene 5, WAN tiene 3
        if (groupByCallCount === 3) {
            return [
                { area_designada: 'REDES_FTTH', _count: { id: 7 } },
                { area_designada: 'WAN', _count: { id: 3 } },
                { area_designada: 'GENERAL', _count: { id: 5 } }
            ];
        }
        // 10: Puntos totales por área
        if (groupByCallCount === 4) {
            return [
                { area_designada: 'REDES_FTTH', _sum: { puntos_complejidad: 80 } },
                { area_designada: 'WAN', _sum: { puntos_complejidad: 45 } },
                { area_designada: 'GENERAL', _sum: { puntos_complejidad: 25 } }
            ];
        }
        // 11: Puntos cerrados por área
        if (groupByCallCount === 5) {
            return [
                { area_designada: 'REDES_FTTH', _sum: { puntos_complejidad: 60 } },
                { area_designada: 'WAN', _sum: { puntos_complejidad: 40 } },
                { area_designada: 'GENERAL', _sum: { puntos_complejidad: 20 } }
            ];
        }
        // 13: Asignados totales por operador
        if (groupByCallCount === 6) {
            return [
                { asignado_a_id: 'op-1', _count: { id: 20 } },
                { asignado_a_id: 'op-2', _count: { id: 10 } }
            ];
        }
        // 14: Cerrados por operador con puntos
        if (groupByCallCount === 7) {
            return [
                { asignado_a_id: 'op-1', _count: { id: 16 }, _sum: { puntos_complejidad: 50 } },
                { asignado_a_id: 'op-2', _count: { id: 5 }, _sum: { puntos_complejidad: 18 } }
            ];
        }
        // 15: Carga actual por operador (EN_PROGRESO o EN_PAUSA)
        if (groupByCallCount === 8) {
            return [
                { asignado_a_id: 'op-1', _count: { id: 1 } },  // Baja
                { asignado_a_id: 'op-2', _count: { id: 5 } }   // Alta
            ];
        }
        return [];
    };

    prisma.user.findMany = async (args) => {
        return [
            { id: 'op-1', nombre: 'Laura Medina', email: 'lmedina@inter.com', rol: 'OPERADOR', area_designada: 'REDES_FTTH', estado_operativo: 'DISPONIBLE', tickets_resueltos: 16 },
            { id: 'op-2', nombre: 'Pedro Ramos', email: 'pramos@inter.com', rol: 'OPERADOR', area_designada: 'WAN', estado_operativo: 'EN_TERRENO', tickets_resueltos: 5 }
        ];
    };

    // Inicio del día en Caracas (independiente de la zona horaria de la máquina)
    const startOfToday = getDayBounds().start;

    prisma.ticket.findMany = async (args) => {
        // Closed tickets with operator
        if (args.select && args.select.asignado_a) {
            return [
                {
                    id: 't-1',
                    asignado_a_id: 'op-1',
                    puntos_complejidad: 10,
                    createdAt: new Date(Date.now() - 3600000),
                    fecha_cierre: new Date(),
                    resueltoEn: new Date(),
                    asignado_a: { id: 'op-1', nombre: 'Laura Medina', email: 'lmedina@inter.com', rol: 'OPERADOR', area_designada: 'REDES_FTTH', estado_operativo: 'DISPONIBLE', tickets_resueltos: 16 }
                }
            ];
        }
        // Today tickets for hourly flow
        const d8 = new Date(startOfToday.getTime() + 8 * 3600000);
        const d10 = new Date(startOfToday.getTime() + 10 * 3600000);
        return [
            { id: 't-h1', createdAt: d8, fecha_cierre: null, resueltoEn: null, updatedAt: d8, estado_actual: 'EN_PROGRESO' },
            { id: 't-h2', createdAt: d8, fecha_cierre: d10, resueltoEn: d10, updatedAt: d10, estado_actual: 'CERRADO' }
        ];
    };

    try {
        let renderedView = null;
        let renderedData = null;

        const req = { user: { nombre: 'Coord Test', email: 'coord@test.com' } };
        const res = {
            render: (view, data) => {
                renderedView = view;
                renderedData = data;
            },
            status: () => res,
            send: () => {}
        };

        await getReports(req, res);

        assert.strictEqual(renderedView, 'reports', 'Debe renderizar la vista reports');
        assert(renderedData, 'Debe proveer datos para renderizar');

        // 1. Verificación de Área Crítica (REDES_FTTH con 7 abiertos) y Puntos Totales Globales
        assert.strictEqual(renderedData.kpis.areaCritica.area, 'REDES_FTTH', 'El área crítica debe ser REDES_FTTH');
        assert.strictEqual(renderedData.kpis.areaCritica.abiertos, 7, 'Debe registrar 7 tickets abiertos en área crítica');
        assert.strictEqual(renderedData.kpis.puntosTotales, 150, 'Puntos totales debe priorizar los 150 globales');

        // 2. Verificación de Ranking de Operadores y Eficiencia
        const rank = renderedData.rankingOperadores;
        assert(Array.isArray(rank) && rank.length === 2, 'Debe contener 2 operadores en el ranking');
        const op1 = rank.find(o => o.id === 'op-1');
        const op2 = rank.find(o => o.id === 'op-2');

        // op1: asignados=20, cerrados=16 -> eficiencia = 80%, cargaActual = 1 (baja)
        assert.strictEqual(op1.cerrados, 16, 'op-1 debe tener 16 cerrados');
        assert.strictEqual(op1.asignadosTotales, 20, 'op-1 debe tener 20 asignados');
        assert.strictEqual(op1.eficiencia, 80, 'op-1 debe tener 80% de eficiencia');
        assert.strictEqual(op1.cargaActual, 1, 'op-1 debe tener carga actual 1');
        assert.strictEqual(op1.cargaNivel, 'baja', 'op-1 debe tener carga baja');

        // op2: asignados=10, cerrados=5 -> eficiencia = 50%, cargaActual = 5 (alta)
        assert.strictEqual(op2.cerrados, 5, 'op-2 debe tener 5 cerrados');
        assert.strictEqual(op2.asignadosTotales, 10, 'op-2 debe tener 10 asignados');
        assert.strictEqual(op2.eficiencia, 50, 'op-2 debe tener 50% de eficiencia');
        assert.strictEqual(op2.cargaActual, 5, 'op-2 debe tener carga actual 5');
        assert.strictEqual(op2.cargaNivel, 'alta', 'op-2 debe tener carga alta');

        // Cada operador está solo en su área: no hay con quién compararlo, así que no hay índice ni alerta
        assert.strictEqual(op1.indiceCarga, null, 'op-1 no es comparable (único en su área)');
        assert.strictEqual(op1.sobrecarga, false, 'op-1 no debe generar alerta de sobrecarga');
        assert.strictEqual(op2.indiceCarga, null, 'op-2 no es comparable (único en su área)');
        assert.strictEqual(op2.sobrecarga, false, 'op-2 no debe generar alerta aunque su carga sea alta');

        // 3. Verificación de Flujo Horario
        assert(renderedData.flujoPorHora, 'Debe contener flujoPorHora');
        assert.strictEqual(renderedData.flujoPorHora.labels.length, 24, 'Debe contener 24 horas');
        assert.strictEqual(renderedData.flujoPorHora.creados[8], 2, 'A las 08:00 se crearon 2 tickets');
        assert.strictEqual(renderedData.flujoPorHora.cerrados[10], 1, 'A las 10:00 se cerró 1 ticket');
        assert.strictEqual(renderedData.kpis.creadosHoy, 2, 'Debe sumar 2 tickets creados hoy');
        assert.strictEqual(renderedData.kpis.cerradosHoy, 1, 'Debe sumar 1 ticket cerrado hoy');

        // 4. Verificación de Renderizado EJS con los datos producidos por el controlador
        const fullHtml = ejs.render(templateContent, renderedData, { filename: templatePath });
        assert(fullHtml.includes('Redes FTTH'), 'El HTML debe renderizar el área crítica');
        assert(fullHtml.includes('Laura Medina'), 'El HTML debe renderizar al operador #1');
        assert(fullHtml.includes('80%'), 'El HTML debe renderizar 80% de eficiencia');
        assert(fullHtml.includes('1 activas (Baja)'), 'El HTML debe renderizar semáforo baja');
        assert(fullHtml.includes('5 activas (Alta)'), 'El HTML debe renderizar semáforo alta');
        assert(fullHtml.includes('id="hourlyFlowChart"'), 'El HTML debe renderizar el canvas de flujo por hora');
    } finally {
        // Restaurar métodos originales
        prisma.ticket.count = origCount;
        prisma.ticket.aggregate = origAgg;
        prisma.ticket.groupBy = origGroupBy;
        prisma.ticket.findMany = origFindManyTicket;
        prisma.user.findMany = origFindManyUser;
    }
});

// 9. Adversarial: Síntesis automática de Indicadores de Saturación Técnica sin detalles
runTest('R2.15: [Adversarial] Síntesis de indicadores de saturación cuando volumenPorArea solo tiene labels y data', () => {
    const dataWithoutDetails = {
        titulo: 'NOC Portal - Reportes',
        currentUser: { nombre: 'Coord', email: 'coord@test.com' },
        kpis: { total: 10, jornada: 5, resueltos: 4, tasa: '40%', puntosTotales: 30, areaCritica: { nombre: 'Seguridad', abiertos: 6 } },
        volumenPorArea: {
            labels: ['Seguridad'],
            data: [10],
            totales: [10],
            cerrados: [4],
            saturaciones: [60]
        },
        puntosPorArea: { labels: ['Seguridad'], data: [30] },
        ranking: [],
        rankingOperadores: [],
        operadores: [],
        reportData: {
            volumenPorArea: { labels: ['Seguridad'], data: [10], cerrados: [4], saturaciones: [60] }
        }
    };

    const rendered = ejs.render(templateContent, dataWithoutDetails, { filename: templatePath });
    assert(rendered.includes('Seguridad'), 'Debe renderizar la etiqueta del área');
    assert(rendered.includes('(4/10 cerrados)'), 'Debe sintetizar la cantidad de cerrados y totales');
    assert(rendered.includes('Sat. 60%'), 'Debe sintetizar la saturación del 60%');
});

// 10. Adversarial: Coherencia de Eficiencia cuando asignados = 0 pero cerrados > 0
runAsyncTest('R1.2: [Adversarial] Eficiencia de operador cuando asignados = 0 pero cerrados > 0', async () => {
    const prisma = require('../src/config/prisma');
    const { getReports } = require('../src/controllers/reportController');

    const origCount = prisma.ticket.count;
    const origAgg = prisma.ticket.aggregate;
    const origGroupBy = prisma.ticket.groupBy;
    const origFindManyTicket = prisma.ticket.findMany;
    const origFindManyUser = prisma.user.findMany;

    try {
        prisma.ticket.count = async () => 3;
        prisma.ticket.aggregate = async () => ({ _sum: { puntos_complejidad: 15 }, _avg: { puntos_complejidad: 5 } });
        let groupCalls = 0;
        prisma.ticket.groupBy = async () => {
            groupCalls++;
            if (groupCalls === 6) {
                // assigned counts group: returns nothing for op-zero
                return [];
            }
            if (groupCalls === 7) {
                // closed counts group: op-zero closed 3 tickets
                return [{ asignado_a_id: 'op-zero', _count: { id: 3 }, _sum: { puntos_complejidad: 15 } }];
            }
            if (groupCalls === 8) {
                // active counts: 0
                return [];
            }
            return [{ area_designada: 'GENERAL', _count: { id: 3 }, _sum: { puntos_complejidad: 15 } }];
        };
        prisma.user.findMany = async () => [
            { id: 'op-zero', nombre: 'Test Zero', email: 'zero@test.com', rol: 'OPERADOR', area_designada: 'GENERAL', estado_operativo: 'DISPONIBLE' }
        ];
        prisma.ticket.findMany = async () => [];

        let renderedData = null;
        const req = { user: { nombre: 'Coord' } };
        const res = { render: (v, d) => { renderedData = d; }, status: () => res, send: () => {} };

        await getReports(req, res);

        const op = renderedData.rankingOperadores.find(o => o.id === 'op-zero');
        assert(op, 'Debe existir op-zero en el ranking');
        assert.strictEqual(op.cerrados, 3, 'Debe registrar 3 tickets cerrados');
        assert.strictEqual(op.asignadosTotales, 3, 'Asignados totales no puede ser 0 si cerró 3; debe ajustarse a 3');
        assert.strictEqual(op.eficiencia, 100, 'Eficiencia debe ser 100%');
    } finally {
        prisma.ticket.count = origCount;
        prisma.ticket.aggregate = origAgg;
        prisma.ticket.groupBy = origGroupBy;
        prisma.ticket.findMany = origFindManyTicket;
        prisma.user.findMany = origFindManyUser;
    }
});

// 11. Adversarial: Coherencia de asignadosTotales considerando cargaActual activa (R1.3)
runAsyncTest('R1.3: [Adversarial] Coherencia de asignadosTotales considerando cargaActual activa', async () => {
    const prisma = require('../src/config/prisma');
    const { getReports } = require('../src/controllers/reportController');

    const origCount = prisma.ticket.count;
    const origAgg = prisma.ticket.aggregate;
    const origGroupBy = prisma.ticket.groupBy;
    const origFindManyTicket = prisma.ticket.findMany;
    const origFindManyUser = prisma.user.findMany;

    try {
        prisma.ticket.count = async () => 5;
        prisma.ticket.aggregate = async () => ({ _sum: { puntos_complejidad: 20 }, _avg: { puntos_complejidad: 4 } });
        let groupCalls = 0;
        prisma.ticket.groupBy = async () => {
            groupCalls++;
            if (groupCalls === 6) {
                // assigned counts group: returns 2 for op-active
                return [{ asignado_a_id: 'op-active', _count: { id: 2 } }];
            }
            if (groupCalls === 7) {
                // closed counts group: op-active closed 3 tickets
                return [{ asignado_a_id: 'op-active', _count: { id: 3 }, _sum: { puntos_complejidad: 15 } }];
            }
            if (groupCalls === 8) {
                // active counts: 2 tickets in progress
                return [{ asignado_a_id: 'op-active', _count: { id: 2 } }];
            }
            return [{ area_designada: 'GENERAL', _count: { id: 5 }, _sum: { puntos_complejidad: 20 } }];
        };
        prisma.user.findMany = async () => [
            { id: 'op-active', nombre: 'Test Active', email: 'active@test.com', rol: 'OPERADOR', area_designada: 'GENERAL', estado_operativo: 'DISPONIBLE' }
        ];
        prisma.ticket.findMany = async () => [];

        let renderedData = null;
        const req = { user: { nombre: 'Coord' } };
        const res = { render: (v, d) => { renderedData = d; }, status: () => res, send: () => {} };

        await getReports(req, res);

        const op = renderedData.rankingOperadores.find(o => o.id === 'op-active');
        assert(op, 'Debe existir op-active en el ranking');
        assert.strictEqual(op.cerrados, 3, 'Debe registrar 3 tickets cerrados');
        assert.strictEqual(op.cargaActual, 2, 'Debe registrar 2 tickets activos en cargaActual');
        assert.strictEqual(op.asignadosTotales, 5, 'Asignados totales debe ser al menos cerrados + cargaActual (3 + 2 = 5)');
        assert.strictEqual(op.eficiencia, 60, 'Eficiencia debe ser (3 / 5) * 100 = 60%');
    } finally {
        prisma.ticket.count = origCount;
        prisma.ticket.aggregate = origAgg;
        prisma.ticket.groupBy = origGroupBy;
        prisma.ticket.findMany = origFindManyTicket;
        prisma.user.findMany = origFindManyUser;
    }
});

// 12. Adversarial: Desempate inteligente de Área Crítica por saturación (R1.4)
runAsyncTest('R1.4: [Adversarial] Desempate inteligente de Área Crítica por porcentaje de saturación', async () => {
    const prisma = require('../src/config/prisma');
    const { getReports } = require('../src/controllers/reportController');

    const origCount = prisma.ticket.count;
    const origAgg = prisma.ticket.aggregate;
    const origGroupBy = prisma.ticket.groupBy;
    const origFindManyTicket = prisma.ticket.findMany;
    const origFindManyUser = prisma.user.findMany;

    try {
        prisma.ticket.count = async () => 24;
        prisma.ticket.aggregate = async () => ({ _sum: { puntos_complejidad: 40 }, _avg: { puntos_complejidad: 4 } });
        let groupCalls = 0;
        prisma.ticket.groupBy = async () => {
            groupCalls++;
            // 7: Volumen por área: WAN tiene 20 total, SEGURIDAD tiene 4 total
            if (groupCalls === 1) {
                return [
                    { area_designada: 'WAN', _count: { id: 20 } },
                    { area_designada: 'SEGURIDAD', _count: { id: 4 } }
                ];
            }
            // 8: Cerrados: WAN cerró 16 (abiertos: 4, sat: 20%), SEGURIDAD cerró 0 (abiertos: 4, sat: 100%)
            if (groupCalls === 2) {
                return [
                    { area_designada: 'WAN', _count: { id: 16 } },
                    { area_designada: 'SEGURIDAD', _count: { id: 0 } }
                ];
            }
            // 9: Abiertos: ambas tienen 4 abiertos
            if (groupCalls === 3) {
                return [
                    { area_designada: 'WAN', _count: { id: 4 } },
                    { area_designada: 'SEGURIDAD', _count: { id: 4 } }
                ];
            }
            return [];
        };
        prisma.user.findMany = async () => [];
        prisma.ticket.findMany = async () => [];

        let renderedData = null;
        const req = { user: { nombre: 'Coord' } };
        const res = { render: (v, d) => { renderedData = d; }, status: () => res, send: () => {} };

        await getReports(req, res);

        assert.strictEqual(renderedData.kpis.areaCritica.area, 'SEGURIDAD', 'Área crítica debe desempatar a favor de SEGURIDAD (100% saturación vs 20%)');
        assert.strictEqual(renderedData.kpis.areaCritica.abiertos, 4, 'Debe registrar 4 tickets abiertos');
    } finally {
        prisma.ticket.count = origCount;
        prisma.ticket.aggregate = origAgg;
        prisma.ticket.groupBy = origGroupBy;
        prisma.ticket.findMany = origFindManyTicket;
        prisma.user.findMany = origFindManyUser;
    }
});

// 13. Adversarial: Conteo dinámico de áreas monitoreadas en la vista (R2.16)
runTest('R2.16: [Adversarial] Renderizado con conteo dinámico de áreas monitoreadas en views/reports.ejs', () => {
    const customAreaData = {
        titulo: 'NOC Portal - Reportes',
        currentUser: { nombre: 'Coord', email: 'coord@test.com' },
        kpis: { total: 5, jornada: 2, resueltos: 3, tasa: '60%', puntosTotales: 15 },
        volumenPorArea: {
            labels: ['Redes FTTH', 'WAN', 'Telefonía'],
            data: [2, 2, 1]
        },
        puntosPorArea: { labels: ['Redes FTTH', 'WAN', 'Telefonía'], data: [10, 5, 0], tipo: 'Puntos' },
        ranking: [],
        rankingOperadores: [],
        operadores: [],
        reportData: {
            volumenPorArea: { labels: ['Redes FTTH', 'WAN', 'Telefonía'], data: [2, 2, 1] },
            puntosPorArea: { labels: ['Redes FTTH', 'WAN', 'Telefonía'], data: [10, 5, 0], tipo: 'Puntos' }
        }
    };

    const rendered = ejs.render(templateContent, customAreaData, { filename: templatePath });
    assert(rendered.includes('3 Áreas Monitoreadas'), 'Debe renderizar dinámicamente "3 Áreas Monitoreadas"');
});

// 14. Adversarial: Flujo horario cuando fecha_cierre es de ayer pero resueltoEn es de hoy (R1.5)
runAsyncTest('R1.5: [Adversarial] Flujo horario cuando fecha_cierre es de ayer pero resueltoEn es de hoy', async () => {
    const prisma = require('../src/config/prisma');
    const { getReports } = require('../src/controllers/reportController');

    const origCount = prisma.ticket.count;
    const origAgg = prisma.ticket.aggregate;
    const origGroupBy = prisma.ticket.groupBy;
    const origFindManyTicket = prisma.ticket.findMany;
    const origFindManyUser = prisma.user.findMany;

    try {
        prisma.ticket.count = async () => 1;
        prisma.ticket.aggregate = async () => ({ _sum: { puntos_complejidad: 5 } });
        prisma.ticket.groupBy = async () => [];
        prisma.user.findMany = async () => [];

        const startOfToday = getDayBounds().start;
        const resolvedAt11 = new Date(startOfToday.getTime() + 11 * 3600000);
        const closedYesterday = new Date(startOfToday.getTime() - 24 * 3600000);

        prisma.ticket.findMany = async (args) => {
            return [
                {
                    id: 't-resuelto-hoy',
                    createdAt: closedYesterday,
                    fecha_cierre: closedYesterday,
                    resueltoEn: resolvedAt11,
                    updatedAt: resolvedAt11,
                    estado_actual: 'CERRADO'
                }
            ];
        };

        let renderedData = null;
        const req = { user: { nombre: 'Coord' } };
        const res = { render: (v, d) => { renderedData = d; }, status: () => res, send: () => {} };

        await getReports(req, res);

        assert(renderedData.flujoPorHora, 'Debe existir flujoPorHora');
        assert.strictEqual(renderedData.flujoPorHora.cerrados[11], 1, 'Debe registrar 1 ticket cerrado a las 11:00 de hoy a pesar de fecha_cierre antigua');
    } finally {
        prisma.ticket.count = origCount;
        prisma.ticket.aggregate = origAgg;
        prisma.ticket.groupBy = origGroupBy;
        prisma.ticket.findMany = origFindManyTicket;
        prisma.user.findMany = origFindManyUser;
    }
});

// 15. Adversarial: Inclusión en ranking de operador con carga activa cuando operators.length === 0 (R1.6)
runAsyncTest('R1.6: [Adversarial] Inclusión en ranking de operador con carga activa cuando operators.length === 0', async () => {
    const prisma = require('../src/config/prisma');
    const { getReports } = require('../src/controllers/reportController');

    const origCount = prisma.ticket.count;
    const origAgg = prisma.ticket.aggregate;
    const origGroupBy = prisma.ticket.groupBy;
    const origFindManyTicket = prisma.ticket.findMany;
    const origFindManyUser = prisma.user.findMany;

    try {
        prisma.ticket.count = async () => 2;
        prisma.ticket.aggregate = async () => ({ _sum: { puntos_complejidad: 0 } });
        let groupCalls = 0;
        prisma.ticket.groupBy = async () => {
            groupCalls++;
            if (groupCalls === 6) {
                return [{ asignado_a_id: 'op-active-only', _count: { id: 2 } }];
            }
            if (groupCalls === 7) {
                return [];
            }
            if (groupCalls === 8) {
                return [{ asignado_a_id: 'op-active-only', _count: { id: 2 } }];
            }
            return [];
        };
        prisma.user.findMany = async () => [];
        prisma.ticket.findMany = async () => [];

        let renderedData = null;
        const req = { user: { nombre: 'Coord' } };
        const res = { render: (v, d) => { renderedData = d; }, status: () => res, send: () => {} };

        await getReports(req, res);

        assert(Array.isArray(renderedData.rankingOperadores) && renderedData.rankingOperadores.length === 1, 'Debe incluir al operador activo');
        const op = renderedData.rankingOperadores[0];
        assert.strictEqual(op.id, 'op-active-only');
        assert.strictEqual(op.cargaActual, 2, 'Debe registrar 2 tickets activos');
        assert.strictEqual(op.asignadosTotales, 2, 'Debe registrar 2 tickets asignados');
        assert.strictEqual(op.eficiencia, 0, 'Debe tener 0% de eficiencia');
    } finally {
        prisma.ticket.count = origCount;
        prisma.ticket.aggregate = origAgg;
        prisma.ticket.groupBy = origGroupBy;
        prisma.ticket.findMany = origFindManyTicket;
        prisma.user.findMany = origFindManyUser;
    }
});

// 16. Adversarial: Desempate de volumen por área a favor de mayor saturación (R1.7)
runAsyncTest('R1.7: [Adversarial] Desempate de volumen por área a favor de mayor saturación', async () => {
    const prisma = require('../src/config/prisma');
    const { getReports } = require('../src/controllers/reportController');

    const origCount = prisma.ticket.count;
    const origAgg = prisma.ticket.aggregate;
    const origGroupBy = prisma.ticket.groupBy;
    const origFindManyTicket = prisma.ticket.findMany;
    const origFindManyUser = prisma.user.findMany;

    try {
        prisma.ticket.count = async () => 20;
        prisma.ticket.aggregate = async () => ({ _sum: { puntos_complejidad: 0 } });
        let groupCalls = 0;
        prisma.ticket.groupBy = async () => {
            groupCalls++;
            if (groupCalls === 1) {
                return [
                    { area_designada: 'WAN', _count: { id: 10 } },
                    { area_designada: 'SEGURIDAD', _count: { id: 10 } }
                ];
            }
            if (groupCalls === 2) {
                return [
                    { area_designada: 'WAN', _count: { id: 9 } },
                    { area_designada: 'SEGURIDAD', _count: { id: 2 } }
                ];
            }
            if (groupCalls === 3) {
                return [
                    { area_designada: 'WAN', _count: { id: 1 } },
                    { area_designada: 'SEGURIDAD', _count: { id: 8 } }
                ];
            }
            return [];
        };
        prisma.user.findMany = async () => [];
        prisma.ticket.findMany = async () => [];

        let renderedData = null;
        const req = { user: { nombre: 'Coord' } };
        const res = { render: (v, d) => { renderedData = d; }, status: () => res, send: () => {} };

        await getReports(req, res);

        const areas = renderedData.volumenPorArea.detalles;
        assert.strictEqual(areas[0].area, 'SEGURIDAD', 'SEGURIDAD con 8 abiertos debe aparecer antes que WAN con 1 abierto cuando el volumen total está empatado');
    } finally {
        prisma.ticket.count = origCount;
        prisma.ticket.aggregate = origAgg;
        prisma.ticket.groupBy = origGroupBy;
        prisma.ticket.findMany = origFindManyTicket;
        prisma.user.findMany = origFindManyUser;
    }
});

// 16b. Carga activa completa y sobrecarga frente al promedio del área (R1.8)
runAsyncTest('R1.8: La carga activa cuenta todos los estados no cerrados y marca sobrecarga frente al promedio del área', async () => {
    const prisma = require('../src/config/prisma');
    const { getReports } = require('../src/controllers/reportController');

    const origCount = prisma.ticket.count;
    const origAgg = prisma.ticket.aggregate;
    const origGroupBy = prisma.ticket.groupBy;
    const origFindManyTicket = prisma.ticket.findMany;
    const origFindManyUser = prisma.user.findMany;

    try {
        prisma.ticket.count = async () => 0;
        prisma.ticket.aggregate = async () => ({ _sum: { puntos_complejidad: 0 }, _avg: { puntos_complejidad: 0 } });
        prisma.ticket.findMany = async () => [];
        prisma.user.findMany = async () => ['w1', 'w2', 'w3', 'w4'].map(id => ({
            id, nombre: `Operador ${id}`, email: `${id}@inter.com`, rol: 'OPERADOR',
            area_designada: 'WAN', estado_operativo: 'DISPONIBLE', tickets_resueltos: 0
        }));

        // Promedio del área = 4; el umbral de alerta es 6, así que w1 (7) debe marcarse
        let activeLoadQuery = null;
        prisma.ticket.groupBy = async (args) => {
            if (args.by[0] === 'asignado_a_id' && args.where && args.where.estado_actual && args.where.estado_actual.in) {
                activeLoadQuery = args;
                return [
                    { asignado_a_id: 'w1', _count: { id: 7 } },
                    { asignado_a_id: 'w2', _count: { id: 3 } },
                    { asignado_a_id: 'w3', _count: { id: 3 } },
                    { asignado_a_id: 'w4', _count: { id: 3 } }
                ];
            }
            return [];
        };

        let renderedData = null;
        const req = { user: { nombre: 'Coord' } };
        const res = { render: (v, d) => { renderedData = d; }, status: () => res, send: () => {} };
        await getReports(req, res);

        assert(activeLoadQuery, 'Debe consultar la carga activa por operador');
        const states = activeLoadQuery.where.estado_actual.in;
        ['NUEVO', 'EN_PROGRESO', 'EN_PAUSA', 'EN_ESPERA_TERCEROS'].forEach(state => {
            assert(states.includes(state), `La carga activa debe incluir ${state}`);
        });
        assert(!states.includes('CERRADO'), 'La carga activa no debe incluir CERRADO');

        const byId = Object.fromEntries(renderedData.rankingOperadores.map(o => [o.id, o]));
        assert.strictEqual(byId.w1.cargaActual, 7);
        assert.strictEqual(byId.w1.promedioAreaCarga, 4, 'El promedio del área debe ser 4');
        assert.strictEqual(byId.w1.indiceCarga, 1.75);
        assert.strictEqual(byId.w1.sobrecarga, true, 'w1 supera 1.5 veces el promedio del área');
        assert.strictEqual(byId.w2.sobrecarga, false, 'w2 está por debajo del promedio');
    } finally {
        prisma.ticket.count = origCount;
        prisma.ticket.aggregate = origAgg;
        prisma.ticket.groupBy = origGroupBy;
        prisma.ticket.findMany = origFindManyTicket;
        prisma.user.findMany = origFindManyUser;
    }
});

// 16c. "Cerrados hoy" no debe depender de updatedAt (R1.9)
runAsyncTest('R1.9: Un ticket cerrado sin fecha de cierre no cuenta como cerrado hoy aunque su updatedAt sea de hoy', async () => {
    const prisma = require('../src/config/prisma');
    const { getReports } = require('../src/controllers/reportController');

    const origCount = prisma.ticket.count;
    const origAgg = prisma.ticket.aggregate;
    const origGroupBy = prisma.ticket.groupBy;
    const origFindManyTicket = prisma.ticket.findMany;
    const origFindManyUser = prisma.user.findMany;

    try {
        const startOfToday = getDayBounds().start;
        const queries = [];
        prisma.ticket.count = async (args) => { queries.push(JSON.stringify(args || {})); return 0; };
        prisma.ticket.aggregate = async () => ({ _sum: { puntos_complejidad: 0 }, _avg: { puntos_complejidad: 0 } });
        prisma.ticket.groupBy = async () => [];
        prisma.user.findMany = async () => [];
        prisma.ticket.findMany = async (args) => {
            queries.push(JSON.stringify(args || {}));
            // Ticket antiguo y cerrado, sin fechas de cierre, editado hoy a las 09:00
            return [{
                id: 't-editado',
                createdAt: new Date(startOfToday.getTime() - 48 * 3600000),
                fecha_cierre: null,
                resueltoEn: null,
                updatedAt: new Date(startOfToday.getTime() + 9 * 3600000),
                estado_actual: 'CERRADO'
            }];
        };

        let renderedData = null;
        const req = { user: { nombre: 'Coord' } };
        const res = { render: (v, d) => { renderedData = d; }, status: () => res, send: () => {} };
        await getReports(req, res);

        assert(renderedData.flujoPorHora.cerrados.every(n => n === 0), 'No debe registrar cierres por una simple edición');
        assert.strictEqual(renderedData.kpis.cerradosHoy, 0, 'cerradosHoy debe ser 0');
        assert(queries.every(q => !q.includes('updatedAt')), 'Ninguna consulta debe filtrar por updatedAt');
    } finally {
        prisma.ticket.count = origCount;
        prisma.ticket.aggregate = origAgg;
        prisma.ticket.groupBy = origGroupBy;
        prisma.ticket.findMany = origFindManyTicket;
        prisma.user.findMany = origFindManyUser;
    }
});

// 17. Adversarial: Renderizado con variables planas de KPI sin envoltura kpis (R2.17)
runTest('R2.17: [Adversarial] Renderizado con variables planas de KPI sin envoltura kpis', () => {
    const flatData = {
        titulo: 'NOC Portal - Reportes',
        currentUser: null,
        ticketsTotales: 15,
        ticketsJornada: 8,
        resueltos: 7,
        tasa: '47%',
        puntosTotales: 65,
        areaCritica: { nombre: 'WAN', abiertos: 3 },
        volumenPorArea: { labels: ['WAN'], data: [15] },
        puntosPorArea: { labels: ['WAN'], data: [65], tipo: 'Puntos' },
        ranking: [],
        rankingOperadores: [],
        operadores: [],
        reportData: {}
    };

    const rendered = ejs.render(templateContent, flatData, { filename: templatePath });
    assert(rendered.includes('15'), 'Debe mostrar 15 tickets totales');
    assert(rendered.includes('8'), 'Debe mostrar 8 tickets de jornada');
    assert(rendered.includes('7'), 'Debe mostrar 7 tickets resueltos');
    assert(rendered.includes('47%'), 'Debe mostrar tasa 47%');
    assert(rendered.includes('65 pts'), 'Debe mostrar 65 pts');
});

// El resumen se imprime cuando terminan todas las pruebas asíncronas
asyncQueue.then(() => {
    console.log('\n================================================================');
    console.log(`   RESUMEN: ${passedTests}/${totalTests} pruebas pasaron correctamente`);
    console.log('================================================================\n');

    if (passedTests !== totalTests) {
        process.exit(1);
    }
});
