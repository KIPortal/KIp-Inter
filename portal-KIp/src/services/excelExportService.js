'use strict';

/**
 * Plantilla Excel del reporte por periodo (spec §11).
 * Hojas: Resumen Ejecutivo, Productividad Operadores, Flujo Horario y Detalle de Tickets.
 * Estilo tomado del reporte gerencial anterior de Operaciones IP.
 */

const ExcelJS = require('exceljs');
const { UTC_OFFSET_HOURS } = require('./metricsService');

const C = {
    navy: 'FF1E3A8A', ink: 'FF1E293B', grey: 'FF64748B', card: 'FFEFF6FF', line: 'FFE2E8F0',
    white: 'FFFFFFFF', green: 'FFDCFCE7', red: 'FFFEE2E2', amber: 'FFFEF3C7', neutral: 'FFF1F5F9', bar: 'FF93C5FD'
};
const DATE_FORMAT = 'yyyy-mm-dd hh:mm';
const MIN_FORMAT = '#,##0.0';
const FONT = { name: 'Calibri', size: 10, color: { argb: C.ink } };

const STATE_FILL = {
    'Sobrecarga': C.red, 'Normal': C.green, 'Sin comparación': C.neutral, 'Ausente': C.neutral, 'Sin operadores': C.neutral
};

// Las fechas se guardan en UTC; se desplazan a hora de Caracas para que el Excel
// muestre la misma hora que ve el coordinador en el portal.
const toCaracas = value => (value ? new Date(new Date(value).getTime() + UTC_OFFSET_HOURS * 3600000) : null);
const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thinBottom = { bottom: { style: 'thin', color: { argb: C.line } } };
const periodName = r => (r.periodo === 'especifica' ? 'Fecha específica' : r.periodo.charAt(0).toUpperCase() + r.periodo.slice(1));

function title(sheet, lastCol, report, generadoPor, generadoEn, text) {
    sheet.mergeCells(1, 1, 1, lastCol);
    const t = sheet.getCell(1, 1);
    t.value = text;
    t.font = { name: 'Calibri', size: 15, bold: true, color: { argb: C.navy } };
    sheet.mergeCells(2, 1, 2, lastCol);
    const r = report.resumen;
    const s = sheet.getCell(2, 1);
    s.value = `División: Operaciones IP | Área: ${r.area} | Periodo: ${periodName(r)} (${r.etiqueta}) | Generado: ${toCaracas(generadoEn).toISOString().slice(0, 16).replace('T', ' ')}${generadoPor ? ` por ${generadoPor}` : ''}`;
    s.font = { name: 'Calibri', size: 10, italic: true, color: { argb: C.grey } };
    sheet.getRow(1).height = 24;
}

function headerRow(sheet, rowNumber, headers) {
    const row = sheet.getRow(rowNumber);
    headers.forEach((h, i) => {
        const cell = row.getCell(i + 1);
        cell.value = h;
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: C.white } };
        cell.fill = fill(C.navy);
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    row.height = 32;
}

function styleBody(sheet, fromRow, toRow, cols, { leftCols = [1] } = {}) {
    for (let r = fromRow; r <= toRow; r++) {
        for (let c = 1; c <= cols; c++) {
            const cell = sheet.getCell(r, c);
            cell.font = { ...FONT, ...(cell.font || {}) };
            cell.border = thinBottom;
            if (!cell.alignment) cell.alignment = { vertical: 'middle', horizontal: leftCols.includes(c) ? 'left' : 'center' };
        }
    }
}

function totalRow(sheet, rowNumber, cols) {
    for (let c = 1; c <= cols; c++) {
        const cell = sheet.getCell(rowNumber, c);
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: C.ink } };
        cell.fill = fill(C.card);
        cell.border = { top: { style: 'thin', color: { argb: C.navy } } };
        cell.alignment = { horizontal: c === 1 ? 'left' : 'center', vertical: 'middle' };
    }
}

function colorState(cell) {
    const argb = STATE_FILL[cell.value];
    if (argb) cell.fill = fill(argb);
    if (cell.value === 'Sobrecarga') cell.font = { ...FONT, bold: true, color: { argb: 'FF991B1B' } };
}

function dataBar(sheet, ref) {
    sheet.addConditionalFormatting({
        ref,
        rules: [{ type: 'dataBar', cfvo: [{ type: 'num', value: 0 }, { type: 'max' }], color: { argb: C.bar }, gradient: false, showValue: true }]
    });
}

const PAGE = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } };
const num = v => (v === null || v === undefined ? null : v);

async function buildWorkbook(report, { generadoPor = '', generadoEn = new Date() } = {}) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Portal KIp - Operaciones IP';
    wb.created = generadoEn;
    const r = report.resumen;

    // ============ 1. Resumen Ejecutivo ============
    const s1 = wb.addWorksheet('Resumen Ejecutivo', { pageSetup: PAGE, views: [{ showGridLines: false }] });
    [30, 12, 12, 12, 14, 15, 12, 17, 19, 18].forEach((w, i) => { s1.getColumn(i + 1).width = w; });
    title(s1, 10, report, generadoPor, generadoEn, 'INTER TELECOMUNICACIONES — REPORTE GERENCIAL OPERACIONES IP');

    const sobrecargados = report.porOperador.filter(o => o.sobrecarga).length;
    const cards = [
        [['TICKETS CREADOS', r.creados], ['RESUELTOS', r.resueltos], ['CERRADOS', r.cerrados], ['ACTIVOS (POR REVISAR)', r.activos], ['PUNTOS RESUELTOS', `${r.puntos} pts`]],
        [['PUNTOS POR TICKET', r.ptsPorTicket], ['TIEMPO PROM. TOTAL', r.tiempoTotal], ['TIEMPO PROM. EN HORARIO', r.tiempoHorario], ['TICKETS ASIGNADOS', r.asignados], ['OPERADORES EN SOBRECARGA', sobrecargados]]
    ];
    // Cada tarjeta ocupa columnas: A | B:C | D:E | F:G | H:I... ajustadas a los anchos
    const spans = [[1, 1], [2, 3], [4, 5], [6, 7], [8, 9]];
    cards.forEach((rowCards, ri) => {
        const labelRow = 4 + ri * 3;
        rowCards.forEach(([label, value], i) => {
            const [a, b] = spans[i];
            [labelRow, labelRow + 1].forEach(rr => { if (b > a) s1.mergeCells(rr, a, rr, b); });
            const l = s1.getCell(labelRow, a);
            l.value = label;
            l.font = { name: 'Calibri', size: 9, bold: true, color: { argb: C.grey } };
            const v = s1.getCell(labelRow + 1, a);
            v.value = value;
            v.font = { name: 'Calibri', size: 18, bold: true, color: { argb: C.navy } };
            for (let c = a; c <= b; c++) {
                s1.getCell(labelRow, c).fill = fill(C.card);
                s1.getCell(labelRow + 1, c).fill = fill(C.card);
            }
            l.alignment = v.alignment = { horizontal: 'center', vertical: 'middle' };
        });
        s1.getRow(labelRow + 1).height = 30;
    });

    // Balance de carga por área
    const secRow = 11;
    s1.getCell(secRow, 1).value = 'BALANCE DE CARGA POR ÁREA';
    s1.getCell(secRow, 1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: C.ink } };
    headerRow(s1, secRow + 1, ['Área', 'Operadores', 'Creados', 'Resueltos', 'Puntos', '% Participación (pts)', 'Activos ahora', 'Tiempo prom. total (min)', 'Tiempo prom. en horario (min)', 'Estado de carga']);
    const first = secRow + 2;
    const last = first + report.porArea.length - 1;
    report.porArea.forEach((a, i) => {
        const row = first + i;
        s1.getRow(row).values = [a.nombre, a.operadores, a.creados, a.resueltos, a.puntos, null, a.activos, num(a.tiempoTotalMin), num(a.tiempoHorarioMin), a.estadoCarga];
        s1.getCell(row, 6).value = { formula: `IF($E$${last + 1}=0,0,E${row}/$E$${last + 1})`, result: a.participacion };
    });
    styleBody(s1, first, last, 10);
    const totalR = last + 1;
    s1.getRow(totalR).values = ['TOTAL', null, null, null, null, null, null, num(r.tiempoTotalMin), num(r.tiempoHorarioMin), null];
    ['B', 'C', 'D', 'E', 'G'].forEach((col, i) => {
        const idx = [2, 3, 4, 5, 7][i];
        const key = ['operadores', 'creados', 'resueltos', 'puntos', 'activos'][i];
        s1.getCell(totalR, idx).value = { formula: `SUM(${col}${first}:${col}${last})`, result: report.porArea.reduce((sum, a) => sum + a[key], 0) };
    });
    s1.getCell(totalR, 6).value = { formula: `SUM(F${first}:F${last})`, result: report.porArea.reduce((sum, a) => sum + a.participacion, 0) };
    totalRow(s1, totalR, 10);
    for (let rr = first; rr <= totalR; rr++) {
        s1.getCell(rr, 6).numFmt = '0.0%';
        s1.getCell(rr, 8).numFmt = MIN_FORMAT;
        s1.getCell(rr, 9).numFmt = MIN_FORMAT;
    }
    report.porArea.forEach((_, i) => colorState(s1.getCell(first + i, 10)));
    dataBar(s1, `E${first}:E${last}`);

    // Lecturas clave
    const lecRow = totalR + 2;
    s1.getCell(lecRow, 1).value = 'LECTURAS CLAVE';
    s1.getCell(lecRow, 1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: C.ink } };
    (report.lecturas || []).forEach((text, i) => {
        const rr = lecRow + 1 + i;
        s1.mergeCells(rr, 1, rr, 10);
        const cell = s1.getCell(rr, 1);
        cell.value = `•  ${text}`;
        cell.font = FONT;
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.border = thinBottom;
    });
    const noteRow = lecRow + 2 + (report.lecturas || []).length;
    s1.mergeCells(noteRow, 1, noteRow, 10);
    s1.getCell(noteRow, 1).value = 'Tiempos: promedio (suma ÷ tickets resueltos) desde que llegó el ticket. "En horario" cuenta solo lunes a viernes de 8:00 a 17:00 (Caracas). Los tickets sin prioridad suman 0 puntos hasta que el coordinador les asigne P1, P2 o P3. Estado de carga y "Activos ahora" reflejan el momento de la descarga.';
    s1.getCell(noteRow, 1).font = { name: 'Calibri', size: 9, italic: true, color: { argb: C.grey } };
    s1.getCell(noteRow, 1).alignment = { wrapText: true, vertical: 'top' };
    s1.getRow(noteRow).height = 40;

    // ============ 2. Productividad Operadores ============
    const s2 = wb.addWorksheet('Productividad Operadores', { pageSetup: PAGE, views: [{ state: 'frozen', xSplit: 1, ySplit: 4, showGridLines: false }] });
    [26, 22, 11, 10, 11, 10, 10, 10, 12, 15, 16, 11, 10, 17].forEach((w, i) => { s2.getColumn(i + 1).width = w; });
    title(s2, 14, report, generadoPor, generadoEn, 'RENDIMIENTO Y DESGLOSE POR OPERADOR');
    headerRow(s2, 4, ['Operador', 'Área', 'Tickets resueltos', 'Puntos', 'Pts / Ticket', 'P1 (8 pts)', 'P2 (5 pts)', 'P3 (1 pt)', 'Sin prioridad', 'Tiempo prom. total (min)', 'Tiempo prom. en horario (min)', 'Activos ahora', 'Índice de carga', 'Estado de carga']);
    const f2 = 5;
    report.porOperador.forEach((o, i) => {
        s2.getRow(f2 + i).values = [o.nombre, o.areaNombre, o.resueltos, o.puntos, null, o.p1, o.p2, o.p3, o.sinPrioridad, num(o.tiempoTotalMin), num(o.tiempoHorarioMin), o.activos, num(o.indiceCarga), o.estadoCarga];
        s2.getCell(f2 + i, 5).value = { formula: `IF(C${f2 + i}=0,0,ROUND(D${f2 + i}/C${f2 + i},1))`, result: o.ptsPorTicket };
    });
    const l2 = f2 + report.porOperador.length - 1;
    if (report.porOperador.length > 0) {
        styleBody(s2, f2, l2, 14, { leftCols: [1, 2] });
        for (let rr = f2; rr <= l2; rr++) {
            s2.getCell(rr, 5).numFmt = '0.0';
            s2.getCell(rr, 10).numFmt = MIN_FORMAT;
            s2.getCell(rr, 11).numFmt = MIN_FORMAT;
            s2.getCell(rr, 13).numFmt = '0.00';
            colorState(s2.getCell(rr, 14));
        }
        dataBar(s2, `D${f2}:D${l2}`);
        const tr = l2 + 1;
        s2.getRow(tr).values = ['TOTAL'];
        [3, 4, 6, 7, 8, 9, 12].forEach(idx => {
            const col = String.fromCharCode(64 + idx);
            const keys = { 3: 'resueltos', 4: 'puntos', 6: 'p1', 7: 'p2', 8: 'p3', 9: 'sinPrioridad', 12: 'activos' };
            s2.getCell(tr, idx).value = { formula: `SUM(${col}${f2}:${col}${l2})`, result: report.porOperador.reduce((sum, o) => sum + o[keys[idx]], 0) };
        });
        s2.getCell(tr, 5).value = { formula: `IF(C${tr}=0,0,ROUND(D${tr}/C${tr},1))`, result: r.ptsPorTicket };
        s2.getCell(tr, 10).value = num(r.tiempoTotalMin);
        s2.getCell(tr, 11).value = num(r.tiempoHorarioMin);
        totalRow(s2, tr, 14);
        s2.getCell(tr, 5).numFmt = '0.0';
        s2.getCell(tr, 10).numFmt = MIN_FORMAT;
        s2.getCell(tr, 11).numFmt = MIN_FORMAT;
        s2.autoFilter = { from: { row: 4, column: 1 }, to: { row: l2, column: 14 } };
    }

    // ============ 3. Flujo Horario ============
    const s3 = wb.addWorksheet('Flujo Horario', { pageSetup: PAGE, views: [{ state: 'frozen', ySplit: 4, showGridLines: false }] });
    [14, 18, 16].forEach((w, i) => { s3.getColumn(i + 1).width = w; });
    title(s3, 3, report, generadoPor, generadoEn, 'TICKETS RECIBIDOS POR HORA (HORA DE CARACAS)');
    headerRow(s3, 4, ['Hora', 'Tickets recibidos', '% del total']);
    const f3 = 5;
    const l3 = f3 + 23;
    const totalRec = report.flujoHorario.reduce((sum, h) => sum + h.recibidos, 0);
    report.flujoHorario.forEach((h, i) => {
        s3.getRow(f3 + i).values = [h.etiqueta, h.recibidos, null];
        s3.getCell(f3 + i, 3).value = { formula: `IF($B$${l3 + 1}=0,0,B${f3 + i}/$B$${l3 + 1})`, result: totalRec ? h.recibidos / totalRec : 0 };
        s3.getCell(f3 + i, 3).numFmt = '0.0%';
    });
    styleBody(s3, f3, l3, 3);
    s3.getRow(l3 + 1).values = ['TOTAL', null, null];
    s3.getCell(l3 + 1, 2).value = { formula: `SUM(B${f3}:B${l3})`, result: totalRec };
    totalRow(s3, l3 + 1, 3);
    s3.addConditionalFormatting({
        ref: `B${f3}:B${l3}`,
        rules: [{ type: 'colorScale', cfvo: [{ type: 'min' }, { type: 'max' }], color: [{ argb: 'FFFFFFFF' }, { argb: 'FF60A5FA' }] }]
    });

    // ============ 4. Detalle de Tickets ============
    const s4 = wb.addWorksheet('Detalle de Tickets', { pageSetup: PAGE, views: [{ state: 'frozen', xSplit: 1, ySplit: 4, showGridLines: false }] });
    [12, 17, 17, 17, 17, 13, 13, 9, 14, 24, 20, 22, 48, 36, 8].forEach((w, i) => { s4.getColumn(i + 1).width = w; });
    title(s4, 15, report, generadoPor, generadoEn, 'DETALLE Y TRAZABILIDAD DE TICKETS');
    headerRow(s4, 4, ['Ticket', 'Llegada', 'Asignación', 'Resolución', 'Cierre', 'Duración total (min)', 'Duración en horario (min)', 'Puntos', 'Prioridad', 'Operador', 'Área', 'Estado', 'Asunto', 'Tipo de caso', 'Nivel']);
    report.detalle.forEach((d, i) => {
        s4.getRow(5 + i).values = [d.codigo, toCaracas(d.llegada), toCaracas(d.asignacion), toCaracas(d.resolucion), toCaracas(d.cierre), num(d.duracionTotalMin), num(d.duracionHorarioMin), d.puntos, d.prioridad, d.operador, d.area, d.estado, d.asunto, d.tipoCaso || '', num(d.nivel)];
    });
    const l4 = 4 + report.detalle.length;
    if (report.detalle.length > 0) {
        styleBody(s4, 5, l4, 15, { leftCols: [1, 10, 11, 12, 13, 14] });
        for (let rr = 5; rr <= l4; rr++) {
            [2, 3, 4, 5].forEach(c => { s4.getCell(rr, c).numFmt = DATE_FORMAT; });
            [6, 7].forEach(c => { s4.getCell(rr, c).numFmt = MIN_FORMAT; });
        }
        s4.autoFilter = { from: { row: 4, column: 1 }, to: { row: l4, column: 15 } };
    }

    // ============ 5. Casos comunes (ocurrencia por tipo de caso) ============
    const cc = report.casosComunes || { filas: [], dias: 1, clasificados: 0, recibidos: 0 };
    const s5 = wb.addWorksheet('Casos Comunes', { pageSetup: PAGE, views: [{ state: 'frozen', xSplit: 1, ySplit: 4, showGridLines: false }] });
    [44, 20, 8, 10, 10, 10, 12, 11, 14, 14, 10].forEach((w, i) => { s5.getColumn(i + 1).width = w; });
    title(s5, 11, report, generadoPor, generadoEn, `CASOS COMUNES · ${cc.clasificados} DE ${cc.recibidos} CASOS RECIBIDOS CON TIPO`);
    headerRow(s5, 4, ['Tipo de caso', 'Área', 'Nivel', 'Veces', '% con tipo', 'Por día', 'Frecuencia', 'Resueltos', 'Estimado (min)', 'Real prom. (min)', 'Puntos']);
    cc.filas.forEach((f, i) => {
        s5.getRow(5 + i).values = [f.nombre, f.area, f.nivel, f.ocurrencias, f.participacion, f.porDia, f.frecuencia || '', f.resueltos, num(f.minutosEstimados), num(f.tiempoPromedioMin), f.puntos];
    });
    const l5 = 4 + cc.filas.length;
    if (cc.filas.length > 0) {
        styleBody(s5, 5, l5, 11, { leftCols: [1, 2, 7] });
        for (let rr = 5; rr <= l5; rr++) {
            s5.getCell(rr, 5).numFmt = '0.0%';
            [9, 10].forEach(c => { s5.getCell(rr, c).numFmt = MIN_FORMAT; });
            if (cc.filas[rr - 5].sobreEstimado) s5.getCell(rr, 10).font = { bold: true, color: { argb: 'FFB45309' } };
        }
        s5.autoFilter = { from: { row: 4, column: 1 }, to: { row: l5, column: 11 } };
    }

    return wb.xlsx.writeBuffer();
}

module.exports = { buildWorkbook };
