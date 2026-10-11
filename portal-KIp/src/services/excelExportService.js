'use strict';

/**
 * Plantilla Excel del reporte por periodo (spec §11): cinco hojas
 * (Resumen, Por área, Por operador, Flujo horario, Detalle).
 */

const ExcelJS = require('exceljs');
const { UTC_OFFSET_HOURS } = require('./metricsService');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C3D6E' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const DATE_FORMAT = 'yyyy-mm-dd hh:mm';

// Las fechas se guardan en UTC; se desplazan a hora de Caracas para que el Excel
// muestre la misma hora que ve el coordinador en el portal.
const toCaracas = value => (value ? new Date(new Date(value).getTime() + UTC_OFFSET_HOURS * 3600000) : null);

function styleHeader(sheet) {
    const row = sheet.getRow(1);
    row.font = HEADER_FONT;
    row.fill = HEADER_FILL;
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    row.height = 30;
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function addTable(sheet, columns, rows) {
    sheet.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width || 16, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
    rows.forEach(r => sheet.addRow(r));
    styleHeader(sheet);
    if (rows.length > 0) {
        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    }
}

async function buildWorkbook(report, { generadoPor = '', generadoEn = new Date() } = {}) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Portal KIp - Operaciones IP';
    wb.created = generadoEn;

    // 1. Resumen
    const r = report.resumen;
    const resumen = wb.addWorksheet('Resumen');
    resumen.columns = [{ width: 34 }, { width: 28 }];
    const rows = [
        ['Reporte de operaciones', ''],
        ['Periodo', r.periodo === 'especifica' ? 'Fecha específica' : r.periodo.charAt(0).toUpperCase() + r.periodo.slice(1)],
        ['Rango (hora de Caracas)', r.etiqueta],
        ['Área', r.area],
        ['Generado', toCaracas(generadoEn)],
        ['Generado por', generadoPor || '-'],
        ['', ''],
        ['VOLUMEN', ''],
        ['Tickets creados', r.creados],
        ['Tickets asignados', r.asignados],
        ['Tickets resueltos', r.resueltos],
        ['Tickets cerrados', r.cerrados],
        ['Tickets activos (por revisar) al generar', r.activos],
        ['', ''],
        ['TIEMPO DE SOLUCIÓN (promedio, desde que llegó el ticket)', ''],
        ['Tiempo total', r.tiempoTotal],
        ['Tiempo en horario (L-V 8:00 a 17:00)', r.tiempoHorario]
    ];
    rows.forEach(row => resumen.addRow(row));
    resumen.getRow(1).font = { bold: true, size: 14 };
    [8, 15].forEach(n => { resumen.getRow(n).font = { bold: true, color: { argb: 'FF1C3D6E' } }; });
    resumen.getCell('B5').numFmt = DATE_FORMAT;
    resumen.getColumn(2).alignment = { horizontal: 'left' };

    // 2. Por área
    addTable(wb.addWorksheet('Por área'), [
        { header: 'Área', key: 'nombre', width: 24 },
        { header: 'Creados', key: 'creados' },
        { header: 'Asignados', key: 'asignados' },
        { header: 'Resueltos', key: 'resueltos' },
        { header: 'Cerrados', key: 'cerrados' },
        { header: 'Activos', key: 'activos' },
        { header: 'Tiempo total promedio (min)', key: 'tiempoTotalMin', width: 22, numFmt: '0.0' },
        { header: 'Tiempo en horario promedio (min)', key: 'tiempoHorarioMin', width: 24, numFmt: '0.0' }
    ], report.porArea);

    // 3. Por operador
    addTable(wb.addWorksheet('Por operador'), [
        { header: 'Operador', key: 'nombre', width: 26 },
        { header: 'Área', key: 'areaNombre', width: 22 },
        { header: 'Asignados', key: 'asignados' },
        { header: 'Resueltos', key: 'resueltos' },
        { header: 'Activos ahora', key: 'activos' },
        { header: 'Tiempo total promedio (min)', key: 'tiempoTotalMin', width: 22, numFmt: '0.0' },
        { header: 'Tiempo en horario promedio (min)', key: 'tiempoHorarioMin', width: 24, numFmt: '0.0' },
        { header: 'Índice de carga', key: 'indiceCarga', numFmt: '0.00' },
        { header: 'Sobrecarga', key: 'sobrecargaTxt' }
    ], report.porOperador.map(o => ({ ...o, sobrecargaTxt: o.sobrecarga ? 'SÍ' : 'No' })));

    // 4. Flujo horario
    addTable(wb.addWorksheet('Flujo horario'), [
        { header: 'Hora', key: 'etiqueta' },
        { header: 'Tickets recibidos', key: 'recibidos', width: 20 }
    ], report.flujoHorario);

    // 5. Detalle
    addTable(wb.addWorksheet('Detalle'), [
        { header: 'Código', key: 'codigo', width: 12 },
        { header: 'Asunto', key: 'asunto', width: 48 },
        { header: 'Área', key: 'area', width: 20 },
        { header: 'Prioridad', key: 'prioridad', width: 14 },
        { header: 'Puntos', key: 'puntos', width: 10 },
        { header: 'Operador', key: 'operador', width: 24 },
        { header: 'Estado', key: 'estado', width: 22 },
        { header: 'Llegada', key: 'llegada', width: 18, numFmt: DATE_FORMAT },
        { header: 'Asignación', key: 'asignacion', width: 18, numFmt: DATE_FORMAT },
        { header: 'Resolución', key: 'resolucion', width: 18, numFmt: DATE_FORMAT },
        { header: 'Cierre', key: 'cierre', width: 18, numFmt: DATE_FORMAT }
    ], report.detalle.map(d => ({
        ...d,
        llegada: toCaracas(d.llegada),
        asignacion: toCaracas(d.asignacion),
        resolucion: toCaracas(d.resolucion),
        cierre: toCaracas(d.cierre)
    })));

    return wb.xlsx.writeBuffer();
}

module.exports = { buildWorkbook };
