// Revisión transversal de la UI (Fase 8): las 6 pantallas del rediseño, sin datos.
// Reemplaza a test-phase-a-ui.js y a las pruebas de vista de test-reports.js (vistas anteriores).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const { buildCoordinatorPanel } = require('../src/services/dashboardService');
const { buildQueue } = require('../src/services/ticketQueueService');
const { buildShiftBoard } = require('../src/services/shiftBoardService');
const { getWeekStart } = require('../src/services/shiftService');
const { mergeConfig, EVENTOS, DESTINATARIOS } = require('../src/services/configService');
const { LIMITS } = require('../src/services/rulesService');
const { buildPeriodReport } = require('../src/services/periodReportService');
const { buildReportView } = require('../src/services/reportViewService');
const { buildAuditView } = require('../src/services/auditViewService');
const { getPeriodBounds } = require('../src/services/metricsService');

let total = 0, passed = 0;
async function t(name, fn) { total++; try { await fn(); passed++; console.log(`  ✅ [PASS] ${name}`); } catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.message}`); } }

const usuario = { nombre: 'Coord', email: 'c@x.com', rol: 'COORDINADOR' };
const now = new Date();
const PANTALLAS = {
    dashboard: ['Dashboard General', { panel: buildCoordinatorPanel({ now }) }],
    tickets: ['Tickets', { cola: buildQueue({ now }), traspaso: null, guardias: [], enPapelera: 0, siguienteCodigo: 'INC-001', enTurno: 0 }],
    turno: ['Gestión de Turno', { tablero: buildShiftBoard({ weekStart: getWeekStart(now), now }), activos: 0 }],
    admin: ['Administración', {
        config: mergeConfig(), areas: [], coordinadores: [], eventos: EVENTOS, destinatarios: DESTINATARIOS,
        limites: { ...LIMITS, plantillas: 12, texto: 120 }, vistaPrevia: { sobrecarga: [], antiguedad: [] }, activos: 0, enTurno: 0, totalOperadores: 0
    }],
    reportes: ['Reportes', {
        vista: buildReportView(buildPeriodReport({ tickets: [], operators: [], range: getPeriodBounds('jornada') }), { periodo: 'jornada', now }),
        areasCatalogo: [], activos: 0
    }],
    auditoria: ['Auditoría', { vista: buildAuditView({ now }), activos: 0 }]
};
const html = {};

(async () => {
    console.log('\n=== PRUEBAS: UI DEL REDISEÑO (revisión final) ===\n');

    await t('Las 6 pantallas renderizan sin datos', async () => {
        for (const [vista, [, datos]] of Object.entries(PANTALLAS)) {
            html[vista] = await ejs.renderFile(path.join(root, 'views', vista + '.ejs'), { currentUser: usuario, ...datos });
        }
    });

    await t('Cabecera común: portal.css, IBM Plex, tema antes de pintar y accesibilidad de ventanas', () => {
        for (const [vista, h] of Object.entries(html)) {
            assert.ok(h.includes('/css/portal.css'), vista);
            assert.ok(h.includes('IBM+Plex+Sans') && h.includes('IBM+Plex+Mono'), vista);
            assert.ok(h.includes("localStorage.getItem('kip.theme')"), vista);
            assert.ok(h.includes('/js/foco.js'), vista);
            assert.ok(!h.includes('cdn.tailwindcss.com') && !h.includes('figma-assets'), vista + ': sin estilos viejos');
        }
    });

    await t('Barra lateral: la pantalla actual marcada y minimizable', () => {
        for (const [vista, [titulo]] of Object.entries(PANTALLAS)) {
            const menu = { dashboard: 'Dashboard General', tickets: 'Tickets', turno: 'Gestión de Turno', admin: 'Administración', reportes: 'Reportes', auditoria: 'Auditoría' }[vista];
            assert.ok(html[vista].includes(`title="${menu}" aria-current="page"`), vista);
            assert.ok(html[vista].includes('data-sidebar-toggle'), vista);
            assert.ok(html[vista].includes(`<title>${titulo} · Operaciones IP</title>`), vista);
        }
    });

    await t('Sin palabras prohibidas (SLA, DERS) ni "mediana"', () => {
        for (const [vista, h] of Object.entries(html)) assert.ok(!/\bSLA\b|\bDERS\b|[Mm]ediana/.test(h), vista);
    });

    await t('Sin colores fijos en línea: todo sale de los tokens', () => {
        for (const [vista, h] of Object.entries(html)) {
            const estilos = (h.match(/style="[^"]*"/g) || []).join(' ');
            assert.ok(!/#[0-9A-Fa-f]{3,6}\b/.test(estilos), vista + ': ' + (estilos.match(/#[0-9A-Fa-f]{3,6}\b/g) || []).join(','));
        }
        for (const f of ['dashboard', 'tickets', 'turno', 'admin', 'reportes', 'menus', 'foco', 'sidebar']) {
            const js = fs.readFileSync(path.join(root, 'public', 'js', f + '.js'), 'utf8');
            assert.ok(!/['"]#[0-9A-Fa-f]{6}['"]/.test(js), f + '.js');
        }
    });

    await t('CSS: contraste AA, modo oscuro, movimiento reducido y [hidden]', () => {
        const css = fs.readFileSync(path.join(root, 'public', 'css', 'portal.css'), 'utf8');
        assert.ok(css.includes('--t3: #6E6E73'), 't3 claro con 5,0:1');
        assert.ok(css.includes('--solid: #0270AE') && css.includes('--solid: #2F6FB8'), 'botón principal AA en claro y oscuro');
        assert.ok(css.includes('[data-theme=dark]') && css.includes('color-scheme: dark'));
        assert.ok(/@media \(prefers-reduced-motion: reduce\)/.test(css));
        assert.ok(css.includes('[hidden] { display: none !important; }'));
        assert.ok(css.includes('nav.side[data-collapsed=true]'));
    });

    await t('Vistas y rutas anteriores retiradas', () => {
        ['index.ejs', 'reports.ejs', 'audit.ejs', 'components/shift-section.ejs'].forEach(v => assert.ok(!fs.existsSync(path.join(root, 'views', v)), v));
        const rutas = fs.readFileSync(path.join(root, 'src', 'routes', 'dashboardRoutes.js'), 'utf8');
        assert.ok(!rutas.includes('vista-anterior'));
        assert.ok(!require('../src/controllers/reportController').getReports);
    });

    console.log(`\n   RESUMEN: ${passed}/${total} pruebas pasaron correctamente\n`);
    if (passed !== total) process.exit(1);
})();
