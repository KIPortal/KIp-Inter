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

    await t('Actualización en vivo: sello de cambios y páginas que se recargan solas', async () => {
        const { buildStamp, loadStamp } = require('../src/services/changeStampService');
        const d = new Date('2026-10-15T14:00:00Z');
        assert.strictEqual(buildStamp([{ n: 3, max: d }, null]), '3@2026-10-15T14:00:00.000Z|-');
        let max = d;
        const agg = campo => ({ aggregate: async () => ({ _count: { _all: 2 }, _max: { [campo]: max } }) });
        const fake = { INCLUDE_DELETED: {}, ticket: agg('updatedAt'), user: agg('updatedAt'), mensaje: agg('createdAt'), auditLog: { aggregate: async () => { throw new Error('sin tabla'); } } };
        const antes = await loadStamp(fake);
        assert.ok(antes.endsWith('|-'), 'una tabla que falla no rompe el sello');
        max = new Date('2026-10-15T14:05:00Z');
        assert.notStrictEqual(await loadStamp(fake), antes, 'una asignación o resolución cambia el sello');
        ['dashboard', 'tickets', 'reportes', 'contactos', 'turno'].forEach(v =>
            assert.ok(fs.readFileSync(path.join(root, 'views', v + '.ejs'), 'utf8').includes('<body data-vivo>'), v));
        assert.ok(fs.readFileSync(path.join(root, 'views', 'partials', 'head.ejs'), 'utf8').includes('/js/vivo.js'));
        assert.ok(fs.readFileSync(path.join(root, 'public', 'js', 'turno.js'), 'utf8').includes('window.kipOcupado = () => paintDirty() > 0'), 'Turno no recarga con cambios sin guardar');
        assert.ok(fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8').includes("app.get('/api/cambios', requireAuth"));
    });

    await t('Actualización empujada: una consulta para todas las pestañas y aviso solo si cambia', async () => {
        const { crearDifusor } = require('../src/services/liveUpdatesService');
        const { EventEmitter } = require('events');
        let sello = 'A', consultas = 0;
        const timers = { setInterval: () => ({}), clearInterval: () => {} };
        const d = crearDifusor({ cargarSello: async () => { consultas++; return sello; }, timers });
        const conectar = () => {
            const req = new EventEmitter();
            const res = { escrito: '', set() {}, write(x) { this.escrito += x; } };
            return { req, res, listo: d.suscribir(req, res) };
        };
        const p1 = conectar(), p2 = conectar();
        await Promise.all([p1.listo, p2.listo]);
        assert.match(p1.res.escrito, /event: cambio\ndata: \{"sello":"A"\}/, 'al conectar recibe el sello actual');
        assert.strictEqual(d.conectados(), 2);
        consultas = 0; p1.res.escrito = p2.res.escrito = '';
        await d.avisar();
        assert.strictEqual(consultas, 1, 'una sola consulta para todas');
        assert.strictEqual(p1.res.escrito, '', 'sin cambios no avisa');
        sello = 'B';
        await d.avisar();
        assert.ok(p1.res.escrito.includes('"sello":"B"') && p2.res.escrito.includes('"sello":"B"'), 'con cambios avisa a todas');
        p1.req.emit('close'); p2.req.emit('close');
        assert.strictEqual(d.conectados(), 0);
        consultas = 0;
        await d.avisar();
        assert.strictEqual(consultas, 0, 'sin pestañas abiertas no consulta la base');
        const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
        assert.ok(app.includes("app.get('/api/cambios/stream', requireAuth"));
        const vivo = fs.readFileSync(path.join(root, 'public', 'js', 'vivo.js'), 'utf8');
        assert.ok(vivo.includes("new EventSource('/api/cambios/stream')") && vivo.includes('cerrarCanal'), 'la pestaña escucha el canal y lo cierra al ocultarse');
    });

    await t('Sello en caché: varias pestañas comparten una consulta y se renueva al vencer', async () => {
        const { cachedStamp } = require('../src/services/changeStampService');
        let reloj = 0, consultas = 0;
        const sello = cachedStamp(async () => `s${++consultas}`, { ms: 5000, clock: () => reloj });
        const juntas = await Promise.all([sello(), sello(), sello()]);
        assert.deepStrictEqual(juntas, ['s1', 's1', 's1']);
        reloj = 4999;
        assert.strictEqual(await sello(), 's1');
        reloj = 5000;
        assert.strictEqual(await sello(), 's2');
        assert.strictEqual(consultas, 2);
        const conError = cachedStamp(async () => { throw new Error('sin base'); });
        await assert.rejects(conError(), /sin base/);
        await assert.rejects(conError(), /sin base/, 'un error no queda guardado');
    });

    await t('Avisos del coordinador: resueltos que esperan cierre, campana y matriz', async () => {
        const { buildPorCerrar } = require('../src/services/closeNoticeService');
        const { mergeAvisos, EVENTOS } = require('../src/services/configService');
        const now = new Date('2026-10-15T15:00:00Z');
        const lista = buildPorCerrar([
            { codigo_incidencia: 'INC-001', asunto: 'Caída', estado_actual: 'RESUELTO', area_designada: 'WAN', resueltoEn: new Date('2026-10-15T14:30:00Z'), asignado_a: { nombre: 'Ana' } },
            { codigo_incidencia: 'INC-002', asunto: 'Lento', estado_actual: 'RESUELTO', area_designada: 'WAN', resueltoEn: new Date('2026-10-15T14:59:40Z'), asignado_a: null },
            { codigo_incidencia: 'INC-003', asunto: 'Abierto', estado_actual: 'EN_PROGRESO', area_designada: 'WAN' }
        ], now);
        assert.deepStrictEqual(lista.map(a => a.codigo), ['INC-002', 'INC-001'], 'solo RESUELTO, el más reciente primero');
        assert.strictEqual(lista[0].hace, 'Ahora');
        assert.strictEqual(lista[0].operador, 'Sin operador');
        assert.strictEqual(lista[1].operador, 'Ana');
        assert.ok(EVENTOS.some(e => e.clave === 'resuelto'));
        assert.deepStrictEqual(mergeAvisos({}).resuelto, [true, null, null], 'llega al coordinador por defecto');
        assert.deepStrictEqual(mergeAvisos({ resuelto: [false, true, true] }).resuelto, [false, null, null], 'se puede apagar; operadores y guardia no aplican');
        const sidebar = path.join(root, 'views', 'partials', 'sidebar.ejs');
        const coord = await ejs.renderFile(sidebar, { currentUser: { nombre: 'C', rol: 'JEFE' }, activo: 'dashboard' });
        const oper = await ejs.renderFile(sidebar, { currentUser: { nombre: 'O', rol: 'OPERADOR' }, activo: 'panel' });
        assert.ok(coord.includes('data-avisos-coord'), 'coordinador, jefe y gerente ven la campana');
        assert.ok(!oper.includes('data-avisos-coord'), 'el operador no');
        assert.ok(fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8').includes("app.use('/api/avisos', avisosRoutes)"));
        assert.ok(fs.readFileSync(path.join(root, 'src', 'routes', 'avisosRoutes.js'), 'utf8').includes('requireAuth, authorizeSupervisor'));
    });

    console.log(`\n   RESUMEN: ${passed}/${total} pruebas pasaron correctamente\n`);
    if (passed !== total) process.exit(1);
})();
