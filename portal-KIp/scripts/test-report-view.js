// Pruebas de la vista de Reportes (reportViewService, controlador y vista). Sin base de datos.
const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const prisma = require('../src/config/prisma');
const { buildReportView, navigation, periodLabel } = require('../src/services/reportViewService');
const { buildPeriodReport } = require('../src/services/periodReportService');
const { getPeriodBounds } = require('../src/services/metricsService');

let total = 0, passed = 0;
async function t(name, fn) { total++; try { await fn(); passed++; console.log(`  ✅ [PASS] ${name}`); } catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.message}`); } }
const at = (hhmm, dia = '2026-10-13') => new Date(`${dia}T${hhmm}:00-04:00`);
const NOW = at('15:00');

const operators = [
    { id: 'a', nombre: 'Ana Pérez', area_designada: 'WAN', estado_operativo: 'DISPONIBLE' },
    { id: 'b', nombre: 'Beto Ruiz', area_designada: 'WAN', estado_operativo: 'DISPONIBLE' }
];
const tk = o => Object.assign({ asunto: 'x', area_designada: 'WAN', estado_actual: 'NUEVO', puntos_complejidad: 0 }, o);
const tickets = [
    tk({ codigo_incidencia: 'INC-1', createdAt: at('08:00'), fecha_asignacion: at('08:10'), resueltoEn: at('10:00'), estado_actual: 'RESUELTO', puntos_complejidad: 8, asignado_a: { id: 'a', nombre: 'Ana Pérez' } }),
    tk({ codigo_incidencia: 'INC-2', createdAt: at('09:00'), fecha_asignacion: at('09:10'), resueltoEn: at('13:00'), fecha_cierre: at('14:00'), estado_actual: 'CERRADO', puntos_complejidad: 5, asignado_a: { id: 'b', nombre: 'Beto Ruiz' } }),
    tk({ codigo_incidencia: 'INC-3', createdAt: at('11:00'), fecha_asignacion: at('11:05'), estado_actual: 'EN_PROGRESO', asignado_a: { id: 'a', nombre: 'Ana Pérez' } }),
    tk({ codigo_incidencia: 'INC-4', createdAt: at('12:00'), area_designada: 'TELEFONIA' })
];

(async () => {
    console.log('\n=== PRUEBAS: VISTA DE REPORTES ===\n');
    const report = buildPeriodReport({ tickets, operators, range: getPeriodBounds('jornada', '2026-10-13') });
    const v = buildReportView(report, { periodo: 'jornada', fecha: '2026-10-13', now: NOW });

    await t('Navegación: día, semana y mes; no avanza más allá de hoy', () => {
        assert.deepStrictEqual(navigation('jornada', '2026-10-13', NOW), { anterior: '2026-10-12', siguiente: null });
        assert.deepStrictEqual(navigation('semana', '2026-10-05', NOW), { anterior: '2026-09-28', siguiente: '2026-10-12' });
        assert.deepStrictEqual(navigation('mes', '2026-09-01', NOW), { anterior: '2026-08-01', siguiente: '2026-10-01' });
        assert.strictEqual(navigation('mes', '2026-10-01', NOW).siguiente, null);
        assert.strictEqual(navigation('mes', '2026-01-01', NOW).anterior, '2025-12-01');
    });

    await t('Etiquetas del periodo', () => {
        assert.strictEqual(periodLabel('jornada', '2026-10-13', '2026-10-13'), '13 oct 2026');
        assert.strictEqual(periodLabel('semana', '2026-09-28', '2026-10-04'), '28 sep – 4 oct 2026');
        assert.strictEqual(periodLabel('mes', '2026-10-01', '2026-10-31'), 'Octubre 2026');
    });

    await t('Cifras: casos, resueltos, % (máx. 100), promedio en horas y puntos', () => {
        assert.strictEqual(v.kpis.casos, 4);
        assert.strictEqual(v.kpis.resueltos, 2);
        assert.strictEqual(v.kpis.pctResueltos, 50);
        assert.strictEqual(v.kpis.promedioHoras, 3, 'INC-1 2 h e INC-2 4 h (promedio, no mediana)');
        assert.strictEqual(v.kpis.puntos, 13);
    });

    await t('Áreas y operadores: barras, % por área y top de resueltos', () => {
        const wan = v.areas.find(a => a.codigo === 'WAN');
        assert.deepStrictEqual([wan.casos, wan.resueltos, wan.pct, wan.ancho], [3, 2, 67, 100]);
        assert.strictEqual(v.areas.find(a => a.codigo === 'TELEFONIA').pct, 0);
        assert.deepStrictEqual(v.topResueltos.map(o => o.nombre), ['Ana Pérez', 'Beto Ruiz']);
        const ana = v.operadores.find(o => o.id === 'a');
        assert.deepStrictEqual([ana.casos, ana.resueltos, ana.pct, ana.puntos, ana.p1, ana.iniciales], [2, 1, 50, 8, 1, 'AP']);
        assert.ok(v.lecturas.length > 0);
    });

    await t('Vista: periodo, Excel con los mismos filtros, secciones y textos escapados', async () => {
        const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'reportes.ejs'), {
            vista: { ...v, lecturas: ['<b>x</b>'] }, areasCatalogo: [{ codigo: 'WAN', nombre: 'WAN' }], activos: 1,
            currentUser: { nombre: 'Coord', rol: 'COORDINADOR' }
        });
        assert.ok(html.includes('id="periodoSelect"'));
        assert.ok(html.includes('id="btnDescargarExcel" href="/reportes/excel?periodo=jornada&amp;fecha=2026-10-13"'));
        assert.ok(html.includes('data-tab="op"') && html.includes('data-section="area"'));
        assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
        assert.ok(!/\bSLA\b|\bDERS\b|[Mm]ediana/.test(html));
        assert.ok(/title="Reportes" aria-current="page"/.test(html));
        assert.ok(!html.includes('aria-label="Periodo siguiente"'), 'hoy no hay periodo siguiente');
    });

    await t('Controlador: periodo inválido redirige; operador va al inicio', async () => {
        const { renderReportes } = require('../src/controllers/reportController');
        let redir;
        await renderReportes({ user: { rol: 'COORDINADOR' }, query: { periodo: 'semana', fecha: 'xx' } }, { redirect: (c, u) => { redir = u; } });
        assert.strictEqual(redir, '/reportes');
        await renderReportes({ user: { rol: 'OPERADOR' }, query: {} }, { redirect: (c, u) => { redir = u; } });
        assert.strictEqual(redir, '/');
    });

    await t('Controlador: renderiza con el reporte del periodo y el área pedida', async () => {
        const { renderReportes } = require('../src/controllers/reportController');
        prisma.ticket.findMany = async () => tickets;
        prisma.ticket.count = async () => 1;
        prisma.user.findMany = async () => operators;
        let vista, data;
        await renderReportes({ user: { rol: 'COORDINADOR' }, query: { periodo: 'jornada', fecha: '2026-10-13', area: 'WAN' } }, { render: (x, d) => { vista = x; data = d; }, status: () => ({ send() {} }), redirect() {} });
        assert.strictEqual(vista, 'reportes');
        assert.strictEqual(data.vista.area, 'WAN');
        assert.strictEqual(data.vista.kpis.casos, 3, 'solo WAN');
        assert.ok(data.areasCatalogo.length >= 7);
    });

    await t('Metas: ámbar bajo el % meta y sobre el promedio meta; editables y acotadas', () => {
        const { mergeRules } = require('../src/services/rulesService');
        const { describeChanges, mergeConfig } = require('../src/services/configService');
        const wan = v.areas.find(a => a.codigo === 'WAN');
        assert.deepStrictEqual([wan.pct, wan.pctBajoMeta, wan.promedioHoras, wan.promSobreMeta], [67, true, 3, false], 'metas por defecto 93 % y 4 h');
        const estricta = buildReportView(report, { periodo: 'jornada', now: NOW, metas: { resueltoPct: 60, promedioHoras: 2.5 } });
        const wan2 = estricta.areas.find(a => a.codigo === 'WAN');
        assert.deepStrictEqual([wan2.pctBajoMeta, wan2.promSobreMeta], [false, true]);
        assert.deepStrictEqual(mergeRules({ metas: { resueltoPct: 120, promedioHoras: 'x' } }).metas, { resueltoPct: 100, promedioHoras: 4 });
        const antes = mergeConfig({});
        const despues = mergeConfig({ reglas: { metas: { resueltoPct: 90, promedioHoras: 3.5 } } });
        assert.deepStrictEqual(describeChanges(antes, despues), ['Meta de resueltos: 90 %', 'Meta de promedio: 3,5 h']);
    });

    await t('Carga ahora: barra relativa por operador y color según la regla de sobrecarga', () => {
        const wan = v.areas.find(a => a.codigo === 'WAN');
        const tel = v.areas.find(a => a.codigo === 'TELEFONIA');
        assert.deepStrictEqual([wan.activos, wan.cargaAncho, wan.cargaTono], [1, 100, 'blue']);
        assert.deepStrictEqual([tel.operadores, tel.cargaAncho, tel.cargaTono], [0, 0, 'gray'], 'sin operadores: sin barra y en gris');
    });

    console.log(`\n   RESUMEN: ${passed}/${total} pruebas pasaron correctamente\n`);
    if (passed !== total) process.exit(1);
})();
