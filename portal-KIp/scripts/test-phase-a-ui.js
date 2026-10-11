/**
 * Automated Verification Test Suite for UI Fase A
 * 
 * Verifies:
 * - R1: Dashboard (views/index.ejs) - KPIs, Clean text (no SLA/DERS), Alertas de Sobrecarga, Counter
 * - R2: Tickets Table & Modals (views/index.ejs) - Checkbox, P1/P2/P3 selects, Cerrar button, Guard shift modal
 * - R3: Reports (views/reports.ejs) - Periodo select (Jornada, Semana, Mes, Fecha específica), Descargar Excel button
 */

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const assert = require('assert');

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

console.log('\n================================================================');
console.log('       EJECUTANDO PRUEBAS: UI FASE A (DASHBOARD, TICKETS, REPORTES)');
console.log('================================================================\n');

const indexPath = path.join(__dirname, '..', 'views', 'index.ejs');
const reportsPath = path.join(__dirname, '..', 'views', 'reports.ejs');

const indexContent = fs.readFileSync(indexPath, 'utf8');
const reportsContent = fs.readFileSync(reportsPath, 'utf8');

// -------------------------------------------------------------
// R1: Dashboard KPIs and Clean Text
// -------------------------------------------------------------
runTest('R1.1: Textos limpios de "SLA" y "DERS" en index.ejs y reports.ejs', () => {
    assert(!/\bSLA\b/i.test(indexContent.replace(/translate/gi, '')), 'index.ejs no debe contener la palabra "SLA"');
    assert(!/\bDERS\b/i.test(indexContent), 'index.ejs no debe contener la palabra "DERS"');
    assert(!/\bSLA\b/i.test(reportsContent), 'reports.ejs no debe contener la palabra "SLA"');
    assert(!/\bDERS\b/i.test(reportsContent), 'reports.ejs no debe contener la palabra "DERS"');
});

runTest('R1.2: Tarjetas KPI con textos requeridos ("HOY", "PROMEDIO ATENCIÓN", "CRÍTICOS SIN ASIGNAR")', () => {
    assert(indexContent.includes('TICKETS<br>ACTIVOS') || indexContent.includes('TICKETS ACTIVOS'), 'Debe existir tarjeta TICKETS ACTIVOS');
    assert(indexContent.includes('TICKETS<br>HOY') || indexContent.includes('TICKETS HOY'), 'Debe existir tarjeta TICKETS HOY');
    assert(indexContent.includes('PROMEDIO<br>ATENCIÓN') || indexContent.includes('PROMEDIO ATENCIÓN'), 'Debe existir tarjeta PROMEDIO ATENCIÓN');
    assert(indexContent.includes('CRÍTICOS<br>SIN ASIGNAR') || indexContent.includes('CRÍTICOS SIN ASIGNAR'), 'Debe existir tarjeta CRÍTICOS SIN ASIGNAR');
});

runTest('R1.3: Variables EJS preparadas para Claude (ticketsCreadosHoy, tiempoAtencion, criticosSinAsignar)', () => {
    assert(indexContent.includes('ticketsCreadosHoy'), 'Debe contemplar variable ticketsCreadosHoy');
    assert(indexContent.includes('tiempoAtencion'), 'Debe contemplar variable tiempoAtencion');
    assert(indexContent.includes('criticosSinAsignar'), 'Debe contemplar variable criticosSinAsignar');
});

runTest('R1.4: Panel Alertas de Sobrecarga - Visible solo para COORDINADOR con campos requeridos', () => {
    assert(indexContent.includes("currentUser.rol === 'COORDINADOR'"), 'Debe validar que currentUser.rol sea COORDINADOR');
    assert(indexContent.includes('overloadAlertsSection'), 'Debe existir sección #overloadAlertsSection');
    
    // Renderizado con Coordinador y alertas
    const dataCoordConAlertas = {
        titulo: 'NOC Portal',
        currentUser: { rol: 'COORDINADOR', nombre: 'Coordinador Test' },
        ticketsActivos: 10,
        ticketsCreadosHoy: 5,
        tiempoAtencion: '15 min',
        criticosSinAsignar: 2,
        operadoresDisponibles: 4,
        totalOperadores: 6,
        operadoresConectados: 5,
        operadoresTurno: [],
        tickets: [],
        alertasSobrecarga: [
            {
                nombre: 'Carlos Mendoza',
                area_designada: 'REDES_FTTH',
                ticketsActivos: 8,
                promedioArea: 3.5,
                indiceCarga: 2.28
            }
        ]
    };
    const renderedCoord = ejs.render(indexContent, dataCoordConAlertas, { filename: indexPath });
    assert(renderedCoord.includes('Alertas de Sobrecarga Operativa'), 'Coordinador debe ver el panel de sobrecarga');
    assert(renderedCoord.includes('Carlos Mendoza'), 'Debe renderizar el nombre del operador sobrecargado');
    assert(renderedCoord.includes('REDES_FTTH'), 'Debe renderizar el área designada');
    assert(renderedCoord.includes('8'), 'Debe renderizar los tickets activos');
    assert(renderedCoord.includes('3.5'), 'Debe renderizar el promedio del área');

    // Renderizado con Operador (NO debe ver alertas)
    const dataOperador = {
        ...dataCoordConAlertas,
        currentUser: { rol: 'OPERADOR', nombre: 'Operador Test' }
    };
    const renderedOp = ejs.render(indexContent, dataOperador, { filename: indexPath });
    assert(!renderedOp.includes('Alertas de Sobrecarga Operativa'), 'Operador no debe ver el panel de sobrecarga');
});

runTest('R1.5: Fix JS Contador - Cuenta dinámica de filas visibles en el DOM', () => {
    assert(indexContent.includes('activeTicketsCounter'), 'Debe existir elemento #activeTicketsCounter');
    assert(indexContent.includes("visibleCount"), 'El script JS debe acumular visibleCount');
    assert(indexContent.includes("counter.textContent = visibleCount"), 'Debe actualizar el contador con visibleCount');
});

// -------------------------------------------------------------
// R2: Tabla de Gestión de Tickets (Maqueta visual)
// -------------------------------------------------------------
runTest('R2.1: Header / Filtros por Área, Estado y Operador', () => {
    assert(indexContent.includes('filterAreaDropdown') || indexContent.includes('filterAreaText'), 'Debe existir filtro por Área');
    assert(indexContent.includes('filterStatusSelect') || indexContent.includes('filterByState'), 'Debe existir filtro por Estado');
    assert(indexContent.includes('filterOperatorSelect') || indexContent.includes('filterByOperator'), 'Debe existir filtro por Operador');
});

runTest('R2.2: Checkbox para selección múltiple en la tabla', () => {
    assert(indexContent.includes('row-checkbox'), 'Cada fila debe tener checkbox .row-checkbox');
    assert(indexContent.includes('selectAllCheckbox'), 'Debe existir checkbox maestro #selectAllCheckbox');
});

runTest('R2.3: Selector de Prioridad nativo con P1 (rojo), P2 (naranja) y P3 (verde)', () => {
    assert(indexContent.includes('priority-native-select'), 'Debe existir clase priority-native-select');
    assert(indexContent.includes('P1 (Crítica)'), 'Debe ofrecer opción P1');
    assert(indexContent.includes('P2 (Media)'), 'Debe ofrecer opción P2');
    assert(indexContent.includes('P3 (Baja)'), 'Debe ofrecer opción P3');
    assert(indexContent.includes('handlePrioritySelectChange'), 'Debe manejar el cambio de prioridad vía JS');
});

runTest('R2.4: Botón individual "Cerrar" en las filas de la tabla', () => {
    assert(indexContent.includes('closeTicketDirectly'), 'Debe existir función closeTicketDirectly');
    assert(indexContent.includes('>Cerrar<') || indexContent.includes('Cerrar\n'), 'Debe existir botón Cerrar en las filas');
});

runTest('R2.5: Botón "Traspasar a guardia" y Modal con backdrop-blur y textarea obligatoria', () => {
    assert(indexContent.includes('guardShiftBtn'), 'Debe existir botón #guardShiftBtn ("Traspasar a guardia")');
    assert(indexContent.includes('guardShiftOverlay'), 'Debe existir modal #guardShiftOverlay');
    assert(indexContent.includes('backdrop-blur'), 'El modal debe tener backdrop-blur');
    assert(indexContent.includes('guardShiftNote'), 'Debe existir textarea #guardShiftNote');
    assert(indexContent.includes('confirmGuardShift'), 'Debe existir función confirmGuardShift');
    assert(indexContent.includes('guardShiftError'), 'Debe mostrar error si textarea está vacía');
});

// -------------------------------------------------------------
// R3: Reportes (views/reports.ejs)
// -------------------------------------------------------------
runTest('R3.1: Selector de Periodo en cabecera (Jornada, Semana, Mes, Fecha específica)', () => {
    assert(reportsContent.includes('id="periodoSelect"'), 'Debe existir select #periodoSelect');
    assert(reportsContent.includes('value="jornada"'), 'Debe incluir opción jornada');
    assert(reportsContent.includes('value="semana"'), 'Debe incluir opción semana');
    assert(reportsContent.includes('value="mes"'), 'Debe incluir opción mes');
    assert(reportsContent.includes('value="especifica"'), 'Debe incluir opción fecha específica');
});

runTest('R3.2: Botón verde/sky "Descargar Excel" sin lógica asíncrona', () => {
    assert(reportsContent.includes('id="btnDescargarExcel"'), 'Debe existir botón #btnDescargarExcel');
    assert(reportsContent.includes('Descargar Excel'), 'Debe contener el texto Descargar Excel');
    assert(reportsContent.includes('emerald') || reportsContent.includes('teal') || reportsContent.includes('sky'), 'Debe usar estilo verde/sky');
});

// -------------------------------------------------------------
// R4: Robustez y Casos Límite (Edge Cases SSR y Client Script)
// -------------------------------------------------------------
runTest('R4.1: Renderizado SSR de index.ejs sin variables mínimas (Edge cases: undefined/null)', () => {
    const minimalData = {
        titulo: 'NOC Portal Test',
        currentUser: { rol: 'COORDINADOR', nombre: 'Test Coord' }
    };
    const html = ejs.render(indexContent, minimalData, { filename: indexPath });
    assert(html.includes('No hay alertas de sobrecarga activas'), 'Debe renderizar mensaje cuando no hay alertas');
    assert(html.includes('id="activeTicketsCounter"'), 'Debe renderizar contador de tickets');
    assert(html.includes('Carlos Mendoza'), 'Debe renderizar maqueta estática cuando tickets es undefined');
});

runTest('R4.2: Renderizado SSR de reports.ejs sin variables de usuario ni KPIs', () => {
    const minimalReportsData = {
        titulo: 'Reportes Test'
    };
    const html = ejs.render(reportsContent, minimalReportsData, { filename: reportsPath });
    assert(html.includes('id="periodoSelect"'), 'Debe renderizar selector de periodo');
    assert(html.includes('id="btnDescargarExcel"'), 'Debe renderizar botón de descarga');
});

runTest('R4.3: TableSelectionManager previene doble inicialización de event listeners', () => {
    assert(indexContent.includes('dashboardTableInitialized'), 'Debe tener variable guard dashboardTableInitialized');
    assert(indexContent.includes('initialized: false'), 'TableSelectionManager debe incluir flag initialized');
});

runTest('R4.4: closeTicketDirectly deselecciona tickets y actualiza KPIs', () => {
    assert(indexContent.includes('TableSelectionManager.selectedCodes.delete(code)'), 'closeTicketDirectly debe remover ticket de selección');
    assert(indexContent.includes('updateKPIStats();'), 'closeTicketDirectly debe invocar updateKPIStats');
});

runTest('R4.5: Filtro por Operador incluye fallback con operadores de la maqueta', () => {
    const htmlNoOps = ejs.render(indexContent, { titulo: 'Test', currentUser: { rol: 'OPERADOR' } }, { filename: indexPath });
    assert(htmlNoOps.includes('value="Carlos Mendoza"'), 'Debe incluir Carlos Mendoza en opciones fallback');
    assert(htmlNoOps.includes('value="Laura Rivas"'), 'Debe incluir Laura Rivas en opciones fallback');
    assert(htmlNoOps.includes('value="Andrés Silva"'), 'Debe incluir Andrés Silva en opciones fallback');
});

console.log(`\n================================================================`);
console.log(`RESUMEN: ${passedTests}/${totalTests} pruebas pasadas con éxito.`);
console.log(`================================================================\n`);

if (passedTests === totalTests) {
    process.exit(0);
} else {
    process.exit(1);
}
