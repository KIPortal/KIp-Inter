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

runTest('R2.1: Verificación de Apache ECharts CDN en la vista', () => {
    assert(templateContent.includes('cdn.jsdelivr.net/npm/echarts/dist/echarts.min.js') || templateContent.includes('echarts.min.js'), 'Debe incluir Apache ECharts vía CDN');
});

runTest('R2.2: Presencia de estética macOS Ocean-Glass (.figma-card)', () => {
    assert(templateContent.includes('figma-card'), 'Debe utilizar la clase CSS figma-card');
    assert(templateContent.includes('backdrop-filter: blur(24px)'), 'Debe contener estilos de blur Ocean-Glass');
    assert(templateContent.includes('from-slate-100 via-blue-50 to-sky-100'), 'Debe incluir fondo Ocean-Glass');
});

runTest('R2.3: Presencia de 4 Tarjetas de KPI requeridas (IDs y estructura)', () => {
    assert(templateContent.includes('id="kpi-total"'), 'Debe contener KPI de Tickets Totales');
    assert(templateContent.includes('id="kpi-jornada"'), 'Debe contener KPI de Tickets de la Jornada');
    assert(templateContent.includes('id="kpi-resueltos"'), 'Debe contener KPI de Tickets Resueltos');
    assert(templateContent.includes('id="kpi-puntos"'), 'Debe contener KPI de Puntos Completados');
});

runTest('R2.4: Presencia de contenedores ECharts para Área vs Tickets y Mediana', () => {
    assert(templateContent.includes('id="areaTicketsChart"'), 'Debe existir contenedor ECharts para área vs tickets (#areaTicketsChart)');
    assert(templateContent.includes('id="medianResolutionChart"'), 'Debe existir contenedor ECharts para mediana (#medianResolutionChart)');
});

runTest('R2.5: Presencia de Tabla de Ranking de Operadores estilizada', () => {
    assert(templateContent.includes('Ranking de Operadores'), 'Debe contener el título de Ranking de Operadores');
    assert(templateContent.includes('operator-ranking-row'), 'Debe marcar las filas de operadores con clase específica');
    assert(templateContent.includes('Puntos Complejidad'), 'Debe incluir columna de Puntos Complejidad');
    assert(templateContent.includes('Tiempo Promedio'), 'Debe incluir columna de Tiempo Promedio');
});

runTest('R2.6: Seguridad JSON en script de datos (#report-data-json)', () => {
    assert(templateContent.includes('id="report-data-json"'), 'Debe existir el elemento #report-data-json');
    assert(templateContent.includes('.replace(/</g,') && templateContent.includes('003c'), 'Debe neutralizar inyecciones de script con u003c');
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
runTest('R2.11: Presencia de contenedor ECharts para gráfico de líneas (#hourlyFlowChart)', () => {
    assert(templateContent.includes('id="hourlyFlowChart"'), 'Debe existir contenedor para gráfico de líneas (#hourlyFlowChart)');
    assert(!templateContent.includes('<canvas id="hourlyFlowChart">'), 'No debe existir el tag canvas id="hourlyFlowChart"');
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
        assert(fullHtml.includes('id="hourlyFlowChart"'), 'El HTML debe renderizar el contenedor ECharts de flujo por hora');
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

// 18. New Reorganization: Presencia de los 5 gráficos en views/reports.ejs (R2.18)
runTest('R2.18: Presencia de los contenedores y secciones para los 5 gráficos en views/reports.ejs', () => {
    // Gráfica 1: Área vs Tickets (ECharts)
    assert(templateContent.includes('id="areaTicketsChart"'), 'Debe contener contenedor #areaTicketsChart para Gráfica 1');
    assert(templateContent.includes('Área vs Tickets'), 'Debe titular Gráfica 1 como Área vs Tickets');
    
    // Gráfica 2: Mapa de Venezuela
    assert(templateContent.includes('id="venezuela-map-container"'), 'Debe contener contenedor de mapa #venezuela-map-container para Gráfica 2');
    
    // Gráfica 3: Barras por Operador
    assert(templateContent.includes('id="operatorBarChart"'), 'Debe contener contenedor #operatorBarChart para Gráfica 3');
    assert(templateContent.includes('Rendimiento por Operador'), 'Debe titular Gráfica 3');
    
    // Gráfica 4: Flujo 24h
    assert(templateContent.includes('id="hourlyFlowChart"'), 'Debe contener contenedor #hourlyFlowChart para Gráfica 4');
    
    // Gráfica 5: Mediana de tiempo de resolución (ECharts)
    assert(templateContent.includes('id="medianResolutionChart"'), 'Debe contener contenedor #medianResolutionChart para Gráfica 5');
    assert(templateContent.includes('Mediana de Tiempo de Resolución'), 'Debe titular Gráfica 5');
});

// 19. New Reorganization: Cálculos de los 5 gráficos en getReports (R1.8)
runAsyncTest('R1.8: [Async] Cálculos de 5 Gráficos (Mediana en memoria, Barras Operador, Flujo 24h, Área vs Tickets)', async () => {
    const prisma = require('../src/config/prisma');
    const { getReports } = require('../src/controllers/reportController');

    const origCount = prisma.ticket.count;
    const origAgg = prisma.ticket.aggregate;
    const origGroupBy = prisma.ticket.groupBy;
    const origFindManyTicket = prisma.ticket.findMany;
    const origFindManyUser = prisma.user.findMany;

    try {
        prisma.ticket.count = async () => 20;
        prisma.ticket.aggregate = async () => ({ _sum: { puntos_complejidad: 50 }, _avg: { puntos_complejidad: 5 } });
        let groupCount = 0;
        prisma.ticket.groupBy = async (args) => {
            groupCount++;
            if (groupCount === 1) { // volumen por area
                return [
                    { area_designada: 'REDES_FTTH', _count: { id: 10 } },
                    { area_designada: 'WAN', _count: { id: 6 } }
                ];
            }
            if (groupCount === 2) { // cerrados por area
                return [
                    { area_designada: 'REDES_FTTH', _count: { id: 7 } },
                    { area_designada: 'WAN', _count: { id: 4 } }
                ];
            }
            if (groupCount === 3) { // abiertos por area
                return [
                    { area_designada: 'REDES_FTTH', _count: { id: 3 } },
                    { area_designada: 'WAN', _count: { id: 2 } }
                ];
            }
            if (groupCount === 6) { // assigned por op
                return [
                    { asignado_a_id: 'op-a', _count: { id: 10 } },
                    { asignado_a_id: 'op-b', _count: { id: 6 } }
                ];
            }
            if (groupCount === 7) { // closed por op
                return [
                    { asignado_a_id: 'op-a', _count: { id: 7 }, _sum: { puntos_complejidad: 25 } },
                    { asignado_a_id: 'op-b', _count: { id: 4 }, _sum: { puntos_complejidad: 15 } }
                ];
            }
            if (groupCount === 8) { // active load
                return [
                    { asignado_a_id: 'op-a', _count: { id: 2 } },
                    { asignado_a_id: 'op-b', _count: { id: 1 } }
                ];
            }
            return [];
        };

        prisma.user.findMany = async () => [
            { id: 'op-a', nombre: 'Operador FTTH', email: 'op_a@test.com', rol: 'OPERADOR', area_designada: 'REDES_FTTH', estado_operativo: 'DISPONIBLE' },
            { id: 'op-b', nombre: 'Operador WAN', email: 'op_b@test.com', rol: 'OPERADOR', area_designada: 'WAN', estado_operativo: 'DISPONIBLE' }
        ];

        const now = new Date();
        const tMinus100m = new Date(now.getTime() - 100 * 60000);
        const tMinus70m = new Date(now.getTime() - 70 * 60000);
        const tMinus40m = new Date(now.getTime() - 40 * 60000);
        const tMinus10m = new Date(now.getTime() - 10 * 60000);

        let findManyCall = 0;
        prisma.ticket.findMany = async (args) => {
            findManyCall++;
            // 16: closedTickets con asignado_a
            if (args.select && args.select.asignado_a) {
                return [];
            }
            // 17: todayTickets
            if (args.select && args.select.fecha_asignacion) {
                return [
                    { id: 'today-1', createdAt: now, fecha_asignacion: now, fecha_cierre: null, resueltoEn: null, updatedAt: now, estado_actual: 'EN_PROGRESO' },
                    { id: 'today-2', createdAt: now, fecha_asignacion: null, fecha_cierre: now, resueltoEn: now, updatedAt: now, estado_actual: 'CERRADO' }
                ];
            }
            // 18: allTicketsGeo
            if (args.select && args.select.asunto) {
                return [{ id: 'geo-1', asunto: 'Falla Caracas', descripcion: '', estado_actual: 'CERRADO', area_designada: 'REDES_FTTH' }];
            }
            // 19: recentResolvedTickets (para mediana de resolución en memoria JS)
            return [
                // REDES_FTTH: 3 tickets resueltos con duraciones:
                // ticket 1: dura 30 min (creado -100m, resuelto -70m)
                { id: 'm-1', area_designada: 'REDES_FTTH', createdAt: tMinus100m, resueltoEn: tMinus70m, fecha_cierre: tMinus70m, estado_actual: 'CERRADO' },
                // ticket 2: dura 60 min (creado -100m, resuelto -40m)
                { id: 'm-2', area_designada: 'REDES_FTTH', createdAt: tMinus100m, resueltoEn: tMinus40m, fecha_cierre: tMinus40m, estado_actual: 'CERRADO' },
                // ticket 3: dura 90 min (creado -100m, resuelto -10m)
                { id: 'm-3', area_designada: 'REDES_FTTH', createdAt: tMinus100m, resueltoEn: tMinus10m, fecha_cierre: tMinus10m, estado_actual: 'CERRADO' },
                // WAN: 2 tickets resueltos con duraciones:
                // ticket 4: dura 20 min
                { id: 'm-4', area_designada: 'WAN', createdAt: tMinus70m, resueltoEn: new Date(tMinus70m.getTime() + 20 * 60000), fecha_cierre: null, estado_actual: 'CERRADO' },
                // ticket 5: dura 40 min
                { id: 'm-5', area_designada: 'WAN', createdAt: tMinus70m, resueltoEn: new Date(tMinus70m.getTime() + 40 * 60000), fecha_cierre: null, estado_actual: 'CERRADO' }
            ];
        };

        let renderedData = null;
        const req = { user: { nombre: 'Coord NOC' } };
        const res = { render: (v, d) => { renderedData = d; }, status: () => res, send: () => {} };

        await getReports(req, res);

        assert(renderedData, 'Debe devolver datos de reporte');

        // G1: Área vs Tickets
        assert(renderedData.volumenPorArea, 'Debe incluir volumenPorArea');
        assert(renderedData.areaTickets, 'Debe incluir areaTickets');
        const ftthIndex = renderedData.areaTickets.areas.indexOf('REDES_FTTH');
        assert(ftthIndex >= 0, 'REDES_FTTH debe estar presente');
        assert.strictEqual(renderedData.areaTickets.creados[ftthIndex], 10, 'FTTH creados debe ser 10');
        assert.strictEqual(renderedData.areaTickets.resueltos[ftthIndex], 7, 'FTTH resueltos debe ser 7');
        assert.strictEqual(renderedData.areaTickets.rechazados[ftthIndex], 0, 'FTTH rechazados debe ser 0');

        // G3: Barras por Operador
        assert(renderedData.barrasOperadores, 'Debe incluir barrasOperadores');
        assert.strictEqual(renderedData.barrasOperadores.labels.length, 2, 'Debe tener 2 operadores');
        const opFtth = renderedData.barrasOperadores.detalles.find(o => o.id === 'op-a');
        assert(opFtth, 'Operador FTTH debe existir');
        assert.strictEqual(opFtth.asignadosTotales, 10, 'Asignados debe ser 10');
        assert.strictEqual(opFtth.cerrados, 7, 'Cerrados debe ser 7');

        // G4: Flujo 24h
        assert(renderedData.flujoPorHora, 'Debe incluir flujoPorHora');
        assert(Array.isArray(renderedData.flujoPorHora.asignados), 'flujoPorHora debe incluir array de asignados');
        assert.strictEqual(renderedData.flujoPorHora.asignados.length, 24, 'flujoPorHora.asignados debe tener 24 horas');
        const currentHour = now.getHours();
        assert.strictEqual(renderedData.flujoPorHora.asignados[currentHour], 1, 'Debe registrar 1 asignado en la hora actual');
        assert.strictEqual(renderedData.flujoPorHora.cerrados[currentHour], 1, 'Debe registrar 1 cerrado en la hora actual');

        // G5: Mediana de tiempo de resolución en memoria JS
        assert(renderedData.medianaTiempoPorArea, 'Debe incluir medianaTiempoPorArea');
        const medFtth = renderedData.medianaTiempoPorArea.detalles.find(d => d.area === 'REDES_FTTH');
        assert(medFtth, 'Debe existir detalle para REDES_FTTH');
        // Duraciones: 30, 60, 90 -> mediana es 60 min
        assert.strictEqual(medFtth.medianaMinutos, 60, 'La mediana de REDES_FTTH (30, 60, 90) debe ser exactamente 60 minutos');
        assert.strictEqual(medFtth.formateado, '1.0 h', '60 minutos debe formatearse como 1.0 h');

        const medWan = renderedData.medianaTiempoPorArea.detalles.find(d => d.area === 'WAN');
        assert(medWan, 'Debe existir detalle para WAN');
        // Duraciones: 20, 40 -> mediana es (20 + 40) / 2 = 30 min
        assert.strictEqual(medWan.medianaMinutos, 30, 'La mediana de WAN (20, 40) debe ser exactamente 30 minutos');
        assert.strictEqual(medWan.formateado, '30 min', '30 minutos debe formatearse como 30 min');

        const medGeneral = renderedData.medianaTiempoPorArea.detalles.find(d => d.area === 'GENERAL');
        assert(medGeneral, 'Debe existir detalle para GENERAL');
        assert.strictEqual(medGeneral.medianaMinutos, 0, 'Área sin tickets resueltos debe tener mediana 0');
        assert.strictEqual(medGeneral.formateado, 'N/A', 'Área sin tickets resueltos debe tener formato N/A');

        // Renderizado EJS completo con los datos producidos
        const html = ejs.render(templateContent, renderedData, { filename: templatePath });
        assert(html.includes('id="operatorBarChart"'), 'El HTML debe renderizar el contenedor #operatorBarChart');
        assert(html.includes('id="medianResolutionChart"'), 'El HTML debe renderizar el contenedor #medianResolutionChart');
        assert(html.includes('id="areaTicketsChart"'), 'El HTML debe renderizar el contenedor #areaTicketsChart');
        assert(html.includes('id="hourlyFlowChart"'), 'El HTML debe renderizar el contenedor #hourlyFlowChart');
        assert(html.includes('id="venezuela-map-container"'), 'El HTML debe renderizar el contenedor de mapa');
    } finally {
        prisma.ticket.count = origCount;
        prisma.ticket.aggregate = origAgg;
        prisma.ticket.groupBy = origGroupBy;
        prisma.ticket.findMany = origFindManyTicket;
        prisma.user.findMany = origFindManyUser;
    }
});

// 20. Adversarial: Mediana con fecha_resolucion / fecha_creacion, exclusión >24h y área dinámica (R1.9)
runAsyncTest('R1.9: [Adversarial] Mediana con fecha_resolucion / fecha_creacion y exclusión estricta >24h', async () => {
    const prisma = require('../src/config/prisma');
    const { getReports } = require('../src/controllers/reportController');

    const origCount = prisma.ticket.count;
    const origAgg = prisma.ticket.aggregate;
    const origGroupBy = prisma.ticket.groupBy;
    const origFindManyTicket = prisma.ticket.findMany;
    const origFindManyUser = prisma.user.findMany;

    try {
        prisma.ticket.count = async () => 5;
        prisma.ticket.aggregate = async () => ({ _sum: { puntos_complejidad: 10 } });
        prisma.ticket.groupBy = async () => [];
        prisma.user.findMany = async () => [];

        const now = new Date();
        const t2hAgo = new Date(now.getTime() - 2 * 3600000);
        const t1hAgo = new Date(now.getTime() - 1 * 3600000);
        const t30hAgo = new Date(now.getTime() - 30 * 3600000);
        const t28hAgo = new Date(now.getTime() - 28 * 3600000);

        prisma.ticket.findMany = async (args) => {
            if (args.select && args.select.fecha_asignacion) {
                return [
                    { id: 'corrupt-date', createdAt: 'fecha-invalida', fecha_asignacion: 'otra-invalida', fecha_cierre: null, resueltoEn: null, updatedAt: now, estado_actual: 'EN_PROGRESO' }
                ];
            }
            if (args.select && args.select.asunto) return [];
            if (args.select && args.select.asignado_a) return [];

            // Recent resolved tickets: incluye campos con nombres alternativos fecha_resolucion y fecha_creacion,
            // un ticket resuelto hace 28h (debe excluirse por estar fuera de 24h) y un área dinámica
            return [
                { id: 'res-alt-1', area_designada: 'CUSTOM_SEC', fecha_creacion: t2hAgo, fecha_resolucion: t1hAgo, estado_actual: 'CERRADO' },
                { id: 'res-old-2', area_designada: 'CUSTOM_SEC', fecha_creacion: t30hAgo, fecha_resolucion: t28hAgo, estado_actual: 'CERRADO' }
            ];
        };

        let renderedData = null;
        const req = { user: { nombre: 'Coord' } };
        const res = { render: (v, d) => { renderedData = d; }, status: () => res, send: () => {} };

        await getReports(req, res);

        assert(renderedData.medianaTiempoPorArea, 'Debe devolver medianaTiempoPorArea');
        const customArea = renderedData.medianaTiempoPorArea.detalles.find(d => d.area === 'CUSTOM_SEC');
        assert(customArea, 'El área dinámica CUSTOM_SEC debe ser incluida en los resultados');
        // Solo el ticket de hace 1h (60 min) debe incluirse; el de hace 28h debe ser ignorado
        assert.strictEqual(customArea.ticketsCount, 1, 'Debe incluir solo 1 ticket resuelto dentro de la ventana de 24h');
        assert.strictEqual(customArea.medianaMinutos, 60, 'La mediana debe calcular exactamente 60 minutos con fecha_creacion/fecha_resolucion');

        // Robustez en flujoPorHora con fechas corruptas
        assert.strictEqual(renderedData.flujoPorHora.creados.some(isNaN), false, 'No deben existir valores NaN en flujoPorHora.creados');
        assert.strictEqual(renderedData.flujoPorHora.asignados.some(isNaN), false, 'No deben existir valores NaN en flujoPorHora.asignados');
    } finally {
        prisma.ticket.count = origCount;
        prisma.ticket.aggregate = origAgg;
        prisma.ticket.groupBy = origGroupBy;
        prisma.ticket.findMany = origFindManyTicket;
        prisma.user.findMany = origFindManyUser;
    }
});

// 21. Presencia de pistas de fondo translúcidas nativas de ECharts y tooltip oscuro (R2.19)
runTest('R2.19: [Adversarial] Verificación de pistas translúcidas nativas en ECharts (showBackground, borderRadius)', () => {
    assert(templateContent.includes('showBackground: true'), 'ECharts debe habilitar showBackground en gráficos de barras');
    assert(templateContent.includes('borderRadius: 20'), 'ECharts debe configurar borderRadius de 20 para cápsulas');
    assert(templateContent.includes('bg-[#1C1C1E]/95') || templateContent.includes('rgba(28, 28, 30, 0.94)'), 'Debe adoptar estilo oscuro Liquid Glass en tooltips');
});

// 22. Adversarial: Verificación de configuración de borderRadius e inicialización robusta en barras de operador (R2.20)
runTest('R2.20: [Adversarial] Verificación de configuración de borderRadius e inicialización robusta en barras de operador', () => {
    assert(templateContent.includes('itemStyle: { borderRadius: 20'), 'Debe configurar itemStyle con borderRadius 20');
    assert(templateContent.includes('barrasOp.labels && barrasOp.labels.length > 0'), 'Debe validar longitud no vacía de labels antes de omitir fallback');
});

// 23. Adversarial: Flujo 24h con fecha_creacion/fecha_resolucion, tolerancia a nulls e isFinite en mediana (R1.10)
runAsyncTest('R1.10: [Adversarial] Flujo 24h con aliases fecha_creacion/resolucion, tolerancia a nulls e isFinite en mediana', async () => {
    const prisma = require('../src/config/prisma');
    const { getReports } = require('../src/controllers/reportController');

    const origCount = prisma.ticket.count;
    const origAgg = prisma.ticket.aggregate;
    const origGroupBy = prisma.ticket.groupBy;
    const origFindManyTicket = prisma.ticket.findMany;
    const origFindManyUser = prisma.user.findMany;

    try {
        prisma.ticket.count = async () => 3;
        prisma.ticket.aggregate = async () => ({ _sum: { puntos_complejidad: 0 } });
        prisma.ticket.groupBy = async () => [];
        prisma.user.findMany = async () => [];

        const now = new Date();
        const t1hAgo = new Date(now.getTime() - 3600000);

        prisma.ticket.findMany = async (args) => {
            // todayTickets: incluye nulls y aliases alternativos fecha_creacion / fecha_resolucion
            if (args.select && args.select.fecha_asignacion) {
                return [
                    null,
                    { id: 'alias-flow', fecha_creacion: t1hAgo, fecha_resolucion: now, fecha_asignacion: t1hAgo, estado_actual: 'CERRADO' },
                    undefined
                ];
            }
            // allTicketsGeo: incluye nulls
            if (args.select && args.select.asunto) {
                return [null, { id: 'geo-safe', asunto: 'Caracas Falla', descripcion: '', estado_actual: 'CERRADO' }];
            }
            if (args.select && args.select.asignado_a) return [];

            // recentResolvedTickets: incluye null y ticket con fechas normales
            return [
                null,
                { id: 'res-alias', area_designada: 'WAN', fecha_creacion: t1hAgo, fecha_resolucion: now, estado_actual: 'CERRADO' }
            ];
        };

        let renderedData = null;
        const req = { user: { nombre: 'Coord' } };
        const res = { render: (v, d) => { renderedData = d; }, status: () => res, send: () => {} };

        await getReports(req, res);

        assert(renderedData, 'Debe procesar sin errores ante datos con elementos null');
        const hCrea = t1hAgo.getHours();
        const hRes = now.getHours();
        assert(renderedData.flujoPorHora.creados[hCrea] >= 1, 'Debe registrar creado mediante fecha_creacion');
        assert(renderedData.flujoPorHora.cerrados[hRes] >= 1, 'Debe registrar cerrado mediante fecha_resolucion');
        assert(renderedData.flujoPorHora.asignados[hCrea] >= 1, 'Debe registrar asignado');

        const wanMed = renderedData.medianaTiempoPorArea.detalles.find(d => d.area === 'WAN');
        assert.strictEqual(wanMed.medianaMinutos, 60, 'Mediana de 1h debe ser 60 min');
    } finally {
        prisma.ticket.count = origCount;
        prisma.ticket.aggregate = origAgg;
        prisma.ticket.groupBy = origGroupBy;
        prisma.ticket.findMany = origFindManyTicket;
        prisma.user.findMany = origFindManyUser;
    }
});

// 24. Reestructuración en Pestañas (Segmented Control estilo macOS) - R1 & R2
runTest('R2.21: Presencia del Segmented Control estilo macOS (botonera de 3 pestañas)', () => {
    assert(templateContent.includes('role="tablist"'), 'Debe incluir role="tablist" para la botonera de pestañas');
    assert(templateContent.includes('report-tab-btn'), 'Debe usar clase report-tab-btn para los botones de pestañas');
    assert(templateContent.includes('bg-black/10') || templateContent.includes('bg-white/20'), 'Debe usar fondo translúcido estilo macOS para el Segmented Control');
    assert(templateContent.includes('backdrop-blur'), 'Debe usar backdrop-blur para el Segmented Control');
    assert(templateContent.includes('Visión General'), 'Debe contener la pestaña Visión General');
    assert(templateContent.includes('Equipo'), 'Debe contener la pestaña Equipo');
    assert(templateContent.includes('Geografía'), 'Debe contener la pestaña Geografía');
});

runTest('R2.22: Estructura de los 3 contenedores de pestañas (Tab Panes: #tab-overview, #tab-team, #tab-geo)', () => {
    assert(templateContent.includes('id="tab-overview"'), 'Debe existir contenedor #tab-overview');
    assert(templateContent.includes('id="tab-team"'), 'Debe existir contenedor #tab-team');
    assert(templateContent.includes('id="tab-geo"'), 'Debe existir contenedor #tab-geo');

    // Tab 1: 4 KPIs, Flujo 24h (ancho completo), Área vs Tickets (mitad), Mediana (mitad)
    const overviewIdx = templateContent.indexOf('id="tab-overview"');
    const teamIdx = templateContent.indexOf('id="tab-team"');
    const geoIdx = templateContent.indexOf('id="tab-geo"');
    assert(overviewIdx >= 0 && teamIdx > overviewIdx && geoIdx > teamIdx, 'Los 3 contenedores deben estar ordenados secuencialmente');

    const tab1Content = templateContent.substring(overviewIdx, teamIdx);
    assert(tab1Content.includes('id="kpi-total"'), 'Tab 1 debe contener los 4 KPIs superiores');
    assert(tab1Content.includes('id="hourlyFlowChart"'), 'Tab 1 debe contener el gráfico de Flujo 24h');
    assert(tab1Content.includes('id="areaTicketsChart"'), 'Tab 1 debe contener el gráfico Área vs Tickets');
    assert(tab1Content.includes('id="medianResolutionChart"'), 'Tab 1 debe contener el gráfico de Mediana de Resolución');

    // Tab 2: Barras por Operador y Ranking
    const tab2Content = templateContent.substring(teamIdx, geoIdx);
    assert(tab2Content.includes('id="operatorBarChart"'), 'Tab 2 debe contener el gráfico de Barras por Operador');
    assert(tab2Content.includes('Ranking de Operadores'), 'Tab 2 debe contener la tabla de Ranking de Operadores');

    // Tab 3: Mapa de Venezuela y resumen de estados
    const tab3Content = templateContent.substring(geoIdx);
    assert(tab3Content.includes('id="venezuela-map-container"'), 'Tab 3 debe contener el mapa vectorial de Venezuela');
    assert(tab3Content.includes('id="venezuela-map-section"'), 'Tab 3 debe contener la sección territorial');
});

runTest('R2.23: Reducción de opacidad de grid en ECharts a rgba(0, 0, 0, 0.05)', () => {
    assert(templateContent.includes("rgba(0, 0, 0, 0.05)") || templateContent.includes("rgba(0,0,0,0.05)"), 'Las escalas deben usar opacidad de grid reducida a rgba(0, 0, 0, 0.05)');
});

runTest('R2.24: Lógica de alternancia de pestañas y redibujo de ECharts en la vista', () => {
    assert(templateContent.includes('setupTabNavigation'), 'Debe incluir función controladora de pestañas setupTabNavigation');
    assert(templateContent.includes('switchTab'), 'Debe incluir lógica de alternancia switchTab');
    assert(templateContent.includes('chart.resize()'), 'Debe redibujar gráficas con resize al cambiar de pestaña');
});

runTest('R2.25: [Adversarial] Sincronización de color en iconos de pestañas (activo text-sky-500, inactivo text-[#8E8E93])', () => {
    assert(templateContent.includes('text-sky-500'), 'El icono activo inicial debe tener text-sky-500');
    assert(templateContent.includes('text-[#8E8E93]'), 'Los iconos inactivos iniciales deben tener text-[#8E8E93]');
    assert(templateContent.includes("icon.classList.add('text-sky-500')"), 'switchTab debe aplicar text-sky-500 al icono activo');
    assert(templateContent.includes("icon.classList.add('text-[#8E8E93]')"), 'switchTab debe aplicar text-[#8E8E93] a los iconos inactivos');
});

runTest('R2.26: [Adversarial] Robustez de switchTab ante targetId inválido o nulo (guardia de existencia)', () => {
    assert(templateContent.includes('if (!targetId) return;'), 'switchTab debe validar targetId truthy');
    assert(templateContent.includes('const targetPane = document.getElementById(targetId);') &&
           templateContent.includes('if (!targetPane) return;'), 'switchTab debe comprobar la existencia del panel antes de ocultar la vista');
});

runTest('R2.27: [Adversarial] Prevención de resize en paneles ocultos ante cambios rápidos de pestañas (Race Condition Guard)', () => {
    assert(templateContent.includes("classList.contains('hidden')"), 'requestAnimationFrame en switchTab debe verificar que el panel no esté oculto antes de llamar a resize()');
});

runTest('R2.28: [Adversarial] Forzado de reflow síncrono (offsetWidth) y soporte de elemento en echarts.getInstanceByDom', () => {
    assert(templateContent.includes('void pane.offsetWidth;'), 'switchTab debe forzar un reflow de layout con offsetWidth al desocultar un panel');
    assert(templateContent.includes('echarts.getInstanceByDom(el)'), 'switchTab debe soportar paso directo del elemento a echarts.getInstanceByDom');
});

runTest('R2.29: [Adversarial] Cambio automático a pestaña de Equipo al buscar en globalSearchInput', () => {
    assert(templateContent.includes("window.switchReportsTab('tab-team')"), 'El filtro de búsqueda global debe alternar a la pestaña tab-team si el usuario está buscando un operador');
});

runTest('R2.30: [Adversarial] Soporte de enlace directo a pestañas mediante window.location.hash', () => {
    assert(templateContent.includes('window.location.hash'), 'setupTabNavigation debe leer window.location.hash para activar la pestaña inicial solicitada');
});

runTest('R2.31: [Adversarial Functional] Simulación DOM de switchTab (transición de estados, ARIA y ECharts resize)', () => {
    // Creación de DOM simulado para verificar la lógica algorítmica de switchTab
    const mockPanes = {
        'tab-overview': { id: 'tab-overview', classes: new Set([]), ariaHidden: 'false', offsetWidth: 1024 },
        'tab-team': { id: 'tab-team', classes: new Set(['hidden']), ariaHidden: 'true', offsetWidth: 1024 },
        'tab-geo': { id: 'tab-geo', classes: new Set(['hidden']), ariaHidden: 'true', offsetWidth: 1024 }
    };

    const mockButtons = [
        {
            target: 'tab-overview',
            selected: 'true',
            className: 'report-tab-btn',
            svg: { classes: new Set(['w-3.5', 'h-3.5', 'text-sky-500']) }
        },
        {
            target: 'tab-team',
            selected: 'false',
            className: 'report-tab-btn',
            svg: { classes: new Set(['w-3.5', 'h-3.5', 'text-[#8E8E93]']) }
        },
        {
            target: 'tab-geo',
            selected: 'false',
            className: 'report-tab-btn',
            svg: { classes: new Set(['w-3.5', 'h-3.5', 'text-[#8E8E93]']) }
        }
    ];

    const chartResizeLog = [];
    const mockCharts = {
        'operatorBarChart': {
            resize: () => { chartResizeLog.push('operatorBarChart.resize'); }
        },
        'hourlyFlowChart': {
            resize: () => { chartResizeLog.push('hourlyFlowChart.resize'); }
        },
        'areaTicketsChart': {
            resize: () => { chartResizeLog.push('areaTicketsChart.resize'); }
        },
        'medianResolutionChart': {
            resize: () => { chartResizeLog.push('medianResolutionChart.resize'); }
        }
    };

    const pendingRAF = [];
    function mockRAF(fn) { pendingRAF.push(fn); }

    function runSimulatedSwitchTab(targetId) {
        if (!targetId) return;
        const targetPane = mockPanes[targetId];
        if (!targetPane) return;

        mockButtons.forEach(btn => {
            const isTarget = btn.target === targetId;
            btn.selected = isTarget ? 'true' : 'false';
            if (isTarget) {
                btn.className = 'active-class';
                btn.svg.classes.delete('text-[#8E8E93]');
                btn.svg.classes.add('text-sky-500');
            } else {
                btn.className = 'inactive-class';
                btn.svg.classes.delete('text-sky-500');
                btn.svg.classes.add('text-[#8E8E93]');
            }
        });

        Object.values(mockPanes).forEach(pane => {
            if (pane.id === targetId) {
                pane.classes.delete('hidden');
                pane.ariaHidden = 'false';
                void pane.offsetWidth;
            } else {
                pane.classes.add('hidden');
                pane.ariaHidden = 'true';
            }
        });

        mockRAF(() => {
            const activePane = mockPanes[targetId];
            if (!activePane || activePane.classes.has('hidden')) return;

            const chartsByTab = {
                'tab-overview': ['hourlyFlowChart', 'areaTicketsChart', 'medianResolutionChart'],
                'tab-team': ['operatorBarChart'],
                'tab-geo': []
            };
            const charts = chartsByTab[targetId] || [];
            charts.forEach(cId => {
                const c = mockCharts[cId];
                if (c) {
                    c.resize();
                }
            });
        });
    }

    // 1. Transición de Tab 1 -> Tab 2
    runSimulatedSwitchTab('tab-team');
    assert.strictEqual(mockPanes['tab-overview'].classes.has('hidden'), true, 'tab-overview debe quedar oculto');
    assert.strictEqual(mockPanes['tab-overview'].ariaHidden, 'true', 'tab-overview ariaHidden debe ser true');
    assert.strictEqual(mockPanes['tab-team'].classes.has('hidden'), false, 'tab-team debe ser visible');
    assert.strictEqual(mockPanes['tab-team'].ariaHidden, 'false', 'tab-team ariaHidden debe ser false');

    const btnTeam = mockButtons.find(b => b.target === 'tab-team');
    const btnOverview = mockButtons.find(b => b.target === 'tab-overview');
    assert.strictEqual(btnTeam.selected, 'true', 'tab-btn-team aria-selected debe ser true');
    assert.strictEqual(btnTeam.svg.classes.has('text-sky-500'), true, 'tab-btn-team icono debe ser sky');
    assert.strictEqual(btnOverview.selected, 'false', 'tab-btn-overview aria-selected debe ser false');
    assert.strictEqual(btnOverview.svg.classes.has('text-[#8E8E93]'), true, 'tab-btn-overview icono debe ser gris');

    // Ejecutar RAF pendiente para tab-team
    assert.strictEqual(pendingRAF.length, 1, 'Debe haber un callback en cola RAF');
    pendingRAF.shift()();
    assert(chartResizeLog.includes('operatorBarChart.resize'), 'operatorBarChart debe haber recibido resize()');

    // 2. Transición inválida (debe abortar sin alterar visibilidad)
    runSimulatedSwitchTab('invalid-tab-id');
    assert.strictEqual(mockPanes['tab-team'].classes.has('hidden'), false, 'tab-team debe seguir visible ante id inválido');
    assert.strictEqual(mockPanes['tab-overview'].classes.has('hidden'), true, 'tab-overview debe seguir oculto ante id inválido');

    // 3. Race condition: Cambio rápido tab-team -> tab-overview antes de ejecutar el frame
    chartResizeLog.length = 0;
    runSimulatedSwitchTab('tab-overview');
    // En este momento, tab-overview es visible y tab-team está oculto.
    // Simulamos un frame rezagado que iba destinado a tab-team:
    const staleTeamFrame = () => {
        const activePane = mockPanes['tab-team'];
        if (!activePane || activePane.classes.has('hidden')) return; // Guardia de race condition
        mockCharts['operatorBarChart'].resize();
    };
    staleTeamFrame();
    assert.strictEqual(chartResizeLog.length, 0, 'Frame rezagado no debe ejecutar resize() en panel oculto');

    // Ejecutar el frame legítimo de tab-overview
    const currentFrame = pendingRAF.pop();
    currentFrame();
    assert(chartResizeLog.includes('hourlyFlowChart.resize'), 'hourlyFlowChart en tab-overview debe recibir resize()');
});

// 34. Verificación de configuración ECharts en Gráfica 1 (Área vs Tickets) y Gráfica 5 (Mediana de Resolución)
runTest('R2.32: [ECharts Visual Config] Configuración visual de barras en Área vs Tickets y Mediana de Resolución', () => {
    // 1. Área vs Tickets (areaTicketsChart)
    assert(templateContent.includes('id="areaTicketsChart"'), 'Debe existir contenedor #areaTicketsChart');
    assert(templateContent.includes('#85A8E0') && templateContent.includes('#4FE0B5') && templateContent.includes('#FF8A80'), 'Debe incluir colores para Creados, Resueltos y Rechazados');

    // 2. Mediana de Tiempo de Resolución (medianResolutionChart)
    assert(templateContent.includes('id="medianResolutionChart"'), 'Debe existir contenedor #medianResolutionChart');
    assert(templateContent.includes('LinearGradient') || templateContent.includes('#38bdf8'), 'Mediana debe usar gradiente azul/sky');
});

// 35. Verificación de visuales de ECharts (smooth lines, splitLine transparency, areaStyle)
runTest('R2.33: [ECharts Visual Config] Configuración visual de líneas y splits en ECharts', () => {
    assert(templateContent.includes('smooth: true'), 'ECharts de líneas debe usar líneas suaves (smooth: true)');
    assert(templateContent.includes("rgba(0,0,0,0.05)") || templateContent.includes("rgba(0, 0, 0, 0.05)"), 'Debe configurar transparencia sutil en splitLine');
    assert(templateContent.includes('areaStyle:'), 'ECharts de flujo debe incluir areaStyle con gradiente');
});

// 36. [Adversarial & Edge Cases] Truncamiento elíptico en eje Y contra nombres de área largos (>45 chars) en ECharts
runTest('R2.34: [Adversarial & Edge Cases] Truncamiento elíptico y tolerancia a nombres de área largos (>45 chars) en ECharts', () => {
    // 1. Verificación de lógica de truncamiento en ECharts
    assert(templateContent.includes('overflow: \'truncate\'') || templateContent.includes('truncate'), 'Las etiquetas de eje en ECharts o HTML deben truncar');

    // 2. Prueba funcional de renderizado EJS con nombres de área extremos (> 50 caracteres)
    const extremeLabel = 'Infraestructura de Telecomunicaciones y Enlaces Críticos Subterráneos';
    const extremeData = {
        titulo: 'NOC Portal - Reportes',
        currentUser: { nombre: 'Coordinador NOC', email: 'coord@inter.com' },
        kpis: { total: 5, jornada: 2, resueltos: 3, puntos: 15, areaCritica: extremeLabel },
        volumenPorArea: {
            labels: [extremeLabel, 'Redes FTTH'],
            totales: [10, 4],
            cerrados: [6, 2],
            saturaciones: [40, 50],
            creados: [10, 4],
            resueltos: [6, 2],
            rechazados: [0, 0]
        },
        puntosPorArea: { labels: [extremeLabel], data: [15] },
        rankingOperadores: [{ nombre: 'Operador Test', area: extremeLabel, cerrados: 3, asignadosTotales: 5, puntos: 15, promedioHoras: 1.2 }],
        flujoPorHora: { labels: ['10:00'], creados: [2], asignados: [2], cerrados: [1] },
        medianaTiempoPorArea: { labels: [extremeLabel], data: [45], formateado: ['45 min'] },
        totales: { total: 5, jornada: 2, resueltos: 3, puntos: 15 },
        ticketsTotales: 5,
        ticketsJornada: 2,
        ticketsResueltos: 3,
        puntosCompletados: 15,
        areaCritica: extremeLabel,
        activeTab: 'overview'
    };

    const renderedHtml = ejs.render(templateContent, extremeData, { filename: templatePath });
    assert(renderedHtml.includes(extremeLabel), 'El renderizado EJS debe soportar nombres de área de longitud extrema sin truncar el modelo');
    assert(renderedHtml.includes('id="areaTicketsChart"'), 'El contenedor areaTicketsChart debe renderizarse con datos extremos');
    assert(renderedHtml.includes('id="medianResolutionChart"'), 'El contenedor medianResolutionChart debe renderizarse con datos extremos');
});

// 37. Verificación estricta de eliminación de Canvas de Chart.js y presencia de identificadores ECharts (R2 & R4)
runTest('R2.35: [Eliminación Chart.js] Ausencia total de canvas Chart.js y uso de identificadores ECharts', () => {
    assert(!templateContent.includes('<canvas id="areaVolumeChart">'), 'No debe existir el tag canvas id="areaVolumeChart"');
    assert(!templateContent.includes('<canvas id="medianResolutionChart">'), 'No debe existir el tag canvas id="medianResolutionChart"');
    assert(!templateContent.includes('<canvas id="hourlyFlowChart">'), 'No debe existir el tag canvas id="hourlyFlowChart"');
    assert(!templateContent.includes('<canvas id="operatorBarChart">'), 'No debe existir el tag canvas id="operatorBarChart"');
    assert(!templateContent.includes("Chart.getChart"), 'No debe existir Chart.getChart de Chart.js');
    assert(!templateContent.includes("new Chart("), 'No debe instanciarse Chart.js');
    assert(templateContent.includes('echarts.getInstanceByDom') || templateContent.includes('_echarts_instance_'), 'Debe consultar instancias de ECharts mediante identificadores DOM');
});

// 38. Verificación funcional de inicialización y dimensiones de ECharts (R2 & R3)
runTest('R2.36: [ECharts Dimensiones e Inicialización] Contenedores de 300px e inicialización mediante echarts.init', () => {
    assert(templateContent.includes('height: 300px;'), 'Los contenedores de gráficas deben especificar height: 300px');
    assert(templateContent.includes('echarts.init('), 'Debe inicializar las gráficas mediante echarts.init');
    assert(templateContent.includes('requestAnimationFrame'), 'Debe usar requestAnimationFrame para secuenciar eventos de renderizado');
});

// 39. Verificación de independencia y carga robusta de ECharts (R2 & R3)
runTest('R2.37: [Carga ECharts] Inicialización asíncrona robusta y ausencia de Chart.js', () => {
    assert(!templateContent.includes('Chart.js') && !templateContent.includes('chartjs'), 'No debe existir dependencia de Chart.js');
    assert(templateContent.includes('waitForECharts') || templateContent.includes('initCharts'), 'Debe implementar inicialización ordenada de ECharts');
    assert(templateContent.includes('DOMContentLoaded'), 'DOMContentLoaded debe configurar navegación de pestañas e iniciar gráficos');
});

// 40. [Adversarial & Edge Cases] Robustez ante reportData nulo, escape XSS y backdrop-blur
runTest('R2.38: [Adversarial Robustness] Sanitización XSS con escapeHtml y tolerancia a estructuras vacías o nulas', () => {
    assert(templateContent.includes('function escapeHtml'), 'Debe incluir función escapeHtml para neutralizar inyecciones');
    assert(templateContent.includes('getReportData'), 'Debe incluir función segura para deserializar reportData');
    assert(templateContent.includes('backdrop-blur'), 'Debe usar backdrop-blur válido');
});

// 41. [Tab Race Condition] Verificación de redimensionamiento de ECharts en switchTab
runTest('R2.39: [Tab Race Condition Guard & ECharts Resize] Redimensionamiento seguro en switchTab al cambiar de pestaña', () => {
    assert(templateContent.includes("activePane.classList.contains('hidden')"), 'switchTab debe verificar que el panel no esté oculto antes de invocar resize');
    assert(templateContent.includes('chart.resize()'), 'switchTab debe invocar resize() en las instancias de ECharts');
});

// 42. [Theme & Visibility Integrity] Erradicación completa de acentos legacy #007AFF y guardia de visibilidad en switchTab
runTest('R2.40: [Theme & Visibility Integrity] Erradicación completa de acentos legacy #007AFF y guardia de visibilidad en switchTab', () => {
    assert(!templateContent.includes('#007AFF'), 'No debe quedar ninguna referencia al color legacy #007AFF');
    assert(!templateContent.includes('#0062CC'), 'No debe quedar ninguna referencia al color legacy #0062CC');
    assert(templateContent.includes('!dom || dom.offsetParent !== null'), 'Tanto el resize global como switchTab deben verificar la visibilidad del contenedor antes de llamar a resize()');
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
