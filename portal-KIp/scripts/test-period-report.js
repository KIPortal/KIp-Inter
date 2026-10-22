// Pruebas del reporte por periodo y la exportación a Excel. Sin base de datos.
const assert = require('assert');
const ExcelJS = require('exceljs');
const prisma = require('../src/config/prisma');
const m = require('../src/services/metricsService');
const { buildPeriodReport, priorityOfTicket } = require('../src/services/periodReportService');
const { buildWorkbook } = require('../src/services/excelExportService');
const reportController = require('../src/controllers/reportController');

let total = 0, passed = 0;
async function t(name, fn) {
    total++;
    try { await fn(); passed++; console.log(`  ✅ [PASS] ${name}`); }
    catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.message}`); }
}
const d = s => new Date(s);
const mockRes = () => {
    const r = { code: 200, body: null, headers: {} };
    r.status = c => { r.code = c; return r; };
    r.json = b => { r.body = b; return r; };
    r.send = b => { r.body = b; return r; };
    r.setHeader = (k, v) => { r.headers[k] = v; };
    return r;
};

(async () => {
    console.log('\n=== PRUEBAS: REPORTE POR PERIODO Y EXCEL ===\n');

    await t('Periodos: jornada = día de Caracas 00:00-24:00 (UTC-4)', () => {
        const r = m.getPeriodBounds('jornada', '2026-10-07');
        assert.strictEqual(r.start.toISOString(), '2026-10-07T04:00:00.000Z');
        assert.strictEqual(r.end.toISOString(), '2026-10-08T04:00:00.000Z');
        assert.strictEqual(r.etiqueta, '2026-10-07');
    });
    await t('Periodos: semana va de lunes a domingo (un domingo pertenece a la semana que termina)', () => {
        const r = m.getPeriodBounds('semana', '2026-10-11'); // domingo
        assert.strictEqual(r.desde, '2026-10-05');
        assert.strictEqual(r.hasta, '2026-10-11');
        const lunes = m.getPeriodBounds('semana', '2026-10-05');
        assert.strictEqual(lunes.desde, '2026-10-05');
    });
    await t('Periodos: mes completo (febrero 2026 termina el 28; diciembre cierra el año)', () => {
        assert.strictEqual(m.getPeriodBounds('mes', '2026-02-15').hasta, '2026-02-28');
        const dic = m.getPeriodBounds('mes', '2026-12-31');
        assert.strictEqual(dic.desde, '2026-12-01');
        assert.strictEqual(dic.hasta, '2026-12-31');
    });
    await t('Periodos: rechaza periodo o fecha inválidos (2026-02-30, texto)', () => {
        assert.strictEqual(m.getPeriodBounds('anio', '2026-01-01'), null);
        assert.strictEqual(m.getPeriodBounds('jornada', '2026-02-30'), null);
        assert.strictEqual(m.getPeriodBounds('jornada', 'hoy'), null);
    });
    await t('Tiempo en horario: viernes 16:00 a lunes 10:00 = 3 h (1 h + 2 h); fin de semana no cuenta', () => {
        assert.strictEqual(m.businessMinutesBetween('2026-10-09T20:00:00Z', '2026-10-12T14:00:00Z'), 180);
        assert.strictEqual(m.businessMinutesBetween('2026-10-10T14:00:00Z', '2026-10-11T20:00:00Z'), 0);
        assert.strictEqual(m.businessMinutesBetween('2026-10-07T20:00:00Z', '2026-10-07T10:00:00Z'), 0);
    });
    await t('Prioridad: la guardada en el ticket; en fotos viejas, según puntos', () => {
        // Fotos viejas sin el campo `prioridad`: sale de los puntos de antes
        assert.deepStrictEqual([8, 5, 1, 0].map(p => priorityOfTicket({ puntos_complejidad: p })), ['P1', 'P2', 'P3', 'Sin prioridad']);
        // Con el campo, la prioridad es la guardada y los puntos (nivel) no la cambian
        assert.deepStrictEqual([['P2', 10], [null, 8], ['X', 2]].map(([prioridad, puntos_complejidad]) => priorityOfTicket({ prioridad, puntos_complejidad })), ['P2', 'Sin prioridad', 'Sin prioridad']);
    });

    // Fixture: miércoles 2026-10-07 (Caracas). 12:00Z = 08:00 Caracas.
    const range = m.getPeriodBounds('jornada', '2026-10-07');
    const op = (id, area, estado = 'DISPONIBLE') => ({ id, nombre: `Op ${id}`, area_designada: area, estado_operativo: estado });
    const operators = [op('a', 'WAN'), op('b', 'WAN'), op('c', 'WAN'), op('d', 'WAN'), op('e', 'SEGURIDAD')];
    const tk = (code, o) => ({ codigo_incidencia: code, asunto: code, area_designada: 'WAN', estado_actual: 'NUEVO', puntos_complejidad: 0, createdAt: null, fecha_asignacion: null, resueltoEn: null, fecha_cierre: null, asignado_a: null, ...o });
    const tickets = [
        // Creado 09:00 Caracas, resuelto 11:00 y cerrado 12:00 el mismo día (120 min, todo en horario)
        tk('INC-1', { createdAt: d('2026-10-07T13:00:00Z'), fecha_asignacion: d('2026-10-07T13:30:00Z'), resueltoEn: d('2026-10-07T15:00:00Z'), fecha_cierre: d('2026-10-07T16:00:00Z'), estado_actual: 'CERRADO', puntos_complejidad: 8, asignado_a: { id: 'a', nombre: 'Op a' } }),
        // Creado 16:00 Caracas (20:00Z), resuelto 10:00 del jueves: 240 min en total... 60 en horario del miércoles + 120 del jueves
        tk('INC-2', { createdAt: d('2026-10-07T20:00:00Z'), resueltoEn: d('2026-10-08T14:00:00Z'), estado_actual: 'RESUELTO', asignado_a: { id: 'b', nombre: 'Op b' } }),
        // Activo creado antes del periodo, asignado a 'a'
        tk('INC-3', { createdAt: d('2026-10-05T14:00:00Z'), fecha_asignacion: d('2026-10-05T15:00:00Z'), estado_actual: 'EN_PROGRESO', puntos_complejidad: 5, asignado_a: { id: 'a', nombre: 'Op a' } }),
        tk('INC-4', { createdAt: d('2026-10-06T14:00:00Z'), estado_actual: 'EN_PAUSA', asignado_a: { id: 'a', nombre: 'Op a' } }),
        tk('INC-5', { createdAt: d('2026-10-06T15:00:00Z'), estado_actual: 'NUEVO', asignado_a: { id: 'a', nombre: 'Op a' } }),
        // Cerrado hace semanas: no debe salir en detalle ni conteos
        tk('INC-OLD', { createdAt: d('2026-09-01T14:00:00Z'), resueltoEn: d('2026-09-01T15:00:00Z'), fecha_cierre: d('2026-09-01T16:00:00Z'), estado_actual: 'CERRADO' }),
        // Otra área
        tk('INC-S', { area_designada: 'SEGURIDAD', createdAt: d('2026-10-07T14:00:00Z'), estado_actual: 'NUEVO', asignado_a: { id: 'e', nombre: 'Op e' } })
    ];
    const rep = buildPeriodReport({ tickets, operators, range });

    await t('Resumen: volumen del periodo y activos (resuelto y cerrado no son activos)', () => {
        const r = rep.resumen;
        assert.strictEqual(r.creados, 3, 'INC-1, INC-2 e INC-S llegaron el 7');
        assert.strictEqual(r.asignados, 1);
        assert.strictEqual(r.resueltos, 1, 'INC-1 resuelto el 7; INC-2 se resolvió el 8');
        assert.strictEqual(r.cerrados, 1);
        assert.strictEqual(r.activos, 4, 'INC-3, 4, 5 y S');
        assert.strictEqual(r.area, 'Todas');
    });
    await t('Tiempos: total y en horario con promedio (no mediana), medidos desde la llegada', () => {
        const r = rep.resumen;
        assert.strictEqual(r.tiempoTotalMin, 120);
        assert.strictEqual(r.tiempoHorarioMin, 120);
        const sem = buildPeriodReport({ tickets, operators, range: m.getPeriodBounds('semana', '2026-10-07') }).resumen;
        // INC-1 = 120 min; INC-2 = 1080 min total (16:00 mié a 10:00 jue) y 180 en horario (60 + 120)
        assert.strictEqual(sem.tiempoTotalMin, (120 + 1080) / 2);
        assert.strictEqual(sem.tiempoHorarioMin, (120 + 180) / 2);
    });
    await t('Por área: cada área con su volumen; una sin datos muestra N/A en tiempos', () => {
        const wan = rep.porArea.find(a => a.area === 'WAN');
        assert.strictEqual(wan.creados, 2);
        assert.strictEqual(wan.activos, 3);
        const tel = rep.porArea.find(a => a.area === 'TELEFONIA');
        assert.strictEqual(tel.creados, 0);
        assert.strictEqual(tel.tiempoTotal, 'N/A');
        assert.strictEqual(rep.porArea.length, 7);
    });
    await t('Por operador: carga actual, sobrecarga (3 activos vs promedio 0.75 del área) y área de un solo operador sin índice', () => {
        const a = rep.porOperador.find(o => o.id === 'a');
        assert.strictEqual(a.activos, 3);
        assert.strictEqual(a.resueltos, 1);
        assert.strictEqual(a.sobrecarga, true);
        assert(a.indiceCarga > 1.5);
        const e = rep.porOperador.find(o => o.id === 'e');
        assert.strictEqual(e.indiceCarga, null);
        assert.strictEqual(e.sobrecarga, false);
    });
    await t('Flujo horario: recibidos por hora de Caracas (09:00 y 16:00 y 10:00)', () => {
        assert.strictEqual(rep.flujoHorario.length, 24);
        assert.strictEqual(rep.flujoHorario[9].recibidos, 1);
        assert.strictEqual(rep.flujoHorario[10].recibidos, 1); // INC-S 14:00Z = 10:00
        assert.strictEqual(rep.flujoHorario[16].recibidos, 1);
        assert.strictEqual(rep.flujoHorario.reduce((s, h) => s + h.recibidos, 0), 3);
    });
    await t('Detalle: incluye eventos del periodo y activos; excluye cerrados antiguos; marca prioridad', () => {
        const codes = rep.detalle.map(x => x.codigo);
        assert(!codes.includes('INC-OLD'));
        ['INC-1', 'INC-2', 'INC-3', 'INC-4', 'INC-5', 'INC-S'].forEach(c => assert(codes.includes(c), c));
        assert.strictEqual(rep.detalle.find(x => x.codigo === 'INC-1').prioridad, 'P1');
        assert.strictEqual(rep.detalle.find(x => x.codigo === 'INC-4').operador, 'Op a');
    });
    await t('Filtro por área: solo WAN; la sobrecarga se sigue comparando contra el área', () => {
        const w = buildPeriodReport({ tickets, operators, range, area: 'WAN' });
        assert.strictEqual(w.resumen.area, 'WAN');
        assert.strictEqual(w.resumen.creados, 2);
        assert.strictEqual(w.porArea.length, 1);
        assert(w.porOperador.every(o => o.area === 'WAN'));
        assert(!w.detalle.some(x => x.codigo === 'INC-S'));
    });
    await t('Periodo vacío: no falla, todo en cero y N/A', () => {
        const vacio = buildPeriodReport({ tickets: [], operators: [], range });
        assert.strictEqual(vacio.resumen.creados, 0);
        assert.strictEqual(vacio.resumen.tiempoTotal, 'N/A');
        assert.strictEqual(vacio.detalle.length, 0);
    });

    await t('Excel: 5 hojas (resumen, operadores, flujo, detalle, casos comunes), totales con fórmula y hora de Caracas', async () => {
        const buffer = await buildWorkbook(rep, { generadoPor: 'Coordinador', generadoEn: d('2026-10-07T20:00:00Z') });
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        assert.deepStrictEqual(wb.worksheets.map(s => s.name), ['Resumen Ejecutivo', 'Productividad Operadores', 'Flujo Horario', 'Detalle de Tickets', 'Casos Comunes']);
        const det = wb.getWorksheet('Detalle de Tickets');
        assert.strictEqual(det.rowCount, 4 + rep.detalle.length);
        assert.strictEqual(wb.getWorksheet('Flujo Horario').rowCount, 4 + 24 + 1);
        let row;
        det.eachRow(r => { if (r.getCell(1).value === 'INC-1') row = r; });
        assert(row, 'fila INC-1');
        assert.strictEqual(new Date(row.getCell(2).value).getUTCHours(), 9, 'llegada 09:00 hora de Caracas');
        assert.strictEqual(row.getCell(6).value, 120, 'duración total en minutos');
        const res = wb.getWorksheet('Resumen Ejecutivo');
        assert(String(res.getCell('A1').value).includes('REPORTE GERENCIAL OPERACIONES IP'));
        assert(String(res.getCell('A2').value).includes('2026-10-07'));
        assert.strictEqual(res.getCell('A5').value, 3, 'tarjeta de creados');
        // Totales como fórmula, con el resultado guardado
        let totalCell;
        res.eachRow(r => { if (r.getCell(1).value === 'TOTAL') totalCell = r.getCell(4); });
        assert(totalCell.value.formula.startsWith('SUM('), 'total con fórmula');
        assert.strictEqual(totalCell.value.result, rep.porArea.reduce((sum, a) => sum + a.resueltos, 0));
        assert(wb.getWorksheet('Productividad Operadores').getCell('A5').value, 'primer operador');
    });
    await t('Reporte: puntos, % participación (suma 100%), estado de carga y lecturas clave', () => {
        assert.strictEqual(rep.resumen.puntos, 8, 'solo INC-1 (P1) se resolvió el 7');
        const wan = rep.porArea.find(a => a.area === 'WAN');
        assert.strictEqual(wan.puntos, 8);
        assert.strictEqual(wan.estadoCarga, 'Sobrecarga');
        assert.strictEqual(rep.porArea.find(a => a.area === 'SEGURIDAD').estadoCarga, 'Sin comparación');
        assert.strictEqual(rep.porArea.find(a => a.area === 'TELEFONIA').estadoCarga, 'Sin operadores');
        assert.strictEqual(Math.round(rep.porArea.reduce((s, a) => s + a.participacion, 0) * 1000) / 1000, 1);
        const a = rep.porOperador.find(o => o.id === 'a');
        assert.strictEqual(a.p1, 1);
        assert.strictEqual(a.estadoCarga, 'Sobrecarga');
        assert.strictEqual(rep.porOperador[0].id, 'a', 'ordenado por puntos');
        assert(rep.lecturas.some(l => l.includes('Hora pico')), 'hora pico');
        assert(rep.lecturas.some(l => l.includes('Operadores en sobrecarga')), 'sobrecarga');
    });

    await t('Endpoint /data: valida parámetros y devuelve las 5 secciones', async () => {
        prisma.ticket.findMany = async () => tickets;
        prisma.user.findMany = async () => operators;
        prisma.registroJornada.findMany = async () => [];
        const bad = mockRes();
        await reportController.getPeriodData({ query: { periodo: 'anio' } }, bad);
        assert.strictEqual(bad.code, 400);
        const noDate = mockRes();
        await reportController.getPeriodData({ query: { periodo: 'especifica' } }, noDate);
        assert.strictEqual(noDate.code, 400);
        const badArea = mockRes();
        await reportController.getPeriodData({ query: { periodo: 'jornada', area: 'XX' } }, badArea);
        assert.strictEqual(badArea.code, 400);
        const ok = mockRes();
        await reportController.getPeriodData({ query: { periodo: 'especifica', fecha: '2026-10-07' } }, ok);
        assert.strictEqual(ok.body.success, true);
        ['resumen', 'porArea', 'porOperador', 'flujoHorario', 'detalle', 'lecturas'].forEach(k => assert(ok.body[k], k));
    });
    await t('Endpoint /excel: cabeceras de descarga y archivo válido', async () => {
        prisma.ticket.findMany = async () => tickets;
        prisma.user.findMany = async () => operators;
        prisma.registroJornada.findMany = async () => [];
        const res = mockRes();
        await reportController.downloadExcel({ query: { periodo: 'semana', fecha: '2026-10-07' }, user: { nombre: 'Coord' } }, res);
        assert(res.headers['Content-Type'].includes('spreadsheetml'));
        assert.strictEqual(res.headers['Content-Disposition'], 'attachment; filename="reporte-semana-2026-10-05_2026-10-11.xlsx"');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(res.body);
        assert.strictEqual(wb.worksheets.length, 5);
    });
    await t('Rutas: /data y /excel exigen rol COORDINADOR', () => {
        const router = require('../src/routes/reportRoutes');
        for (const p of ['/data', '/excel']) {
            const layer = router.stack.find(l => l.route && l.route.path === p);
            assert(layer && layer.route.stack.length >= 2, p);
        }
    });

    console.log(`\n   RESUMEN: ${passed}/${total} pruebas pasaron correctamente\n`);
    if (passed !== total) process.exit(1);
})();
