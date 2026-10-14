// Pruebas de Gestión de Turno (shiftBoardService, vista y controlador). Sin base de datos.
const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const prisma = require('../src/config/prisma');
const { buildShiftBoard, weekLabel, weekDays } = require('../src/services/shiftBoardService');
const { getWeekStart } = require('../src/services/shiftService');

let total = 0, passed = 0;
async function t(name, fn) { total++; try { await fn(); passed++; console.log(`  ✅ [PASS] ${name}`); } catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.message}`); } }

const at = (hhmm, dia = '2026-10-13') => new Date(`${dia}T${hhmm}:00-04:00`); // martes
const NOW = at('10:00');
const operators = [
    { id: 'a', nombre: 'Ana Pérez', email: 'ana@x', area_designada: 'WAN', estado_operativo: 'DISPONIBLE' },
    { id: 'b', nombre: 'Beto Ruiz', email: 'beto@x', area_designada: 'WAN', estado_operativo: 'DISPONIBLE' },
    { id: 'c', nombre: 'Carla Díaz', email: 'carla@x', area_designada: 'TELEFONIA', estado_operativo: 'DISPONIBLE' },
    { id: 'd', nombre: 'Dani Soto', email: 'dani@x', area_designada: 'TELEFONIA', estado_operativo: 'AUSENTE' }
];
const horarios = new Map([['b', { dias: [1, 2, 3, 4, 5], hora_inicio: '13:00', hora_fin: '22:00' }]]);

(async () => {
    console.log('\n=== PRUEBAS: GESTIÓN DE TURNO ===\n');
    const semana = getWeekStart(NOW);
    const tb = buildShiftBoard({ operators, horarios, guardiaPorDia: new Map([['2026-10-13', new Set(['c'])], ['2026-10-14', new Set(['c', 'a'])]]), guardiaActual: new Set(['c']), weekStart: semana, now: NOW });
    const op = id => tb.operadores.find(o => o.id === id);

    await t('Estado actual: en turno, fuera por horario propio, de guardia y ausente', () => {
        assert.strictEqual(op('a').estado.grupo, 'turno');
        assert.strictEqual(op('b').estado.grupo, 'fuera', 'su horario empieza a las 13:00');
        assert.strictEqual(op('c').estado.etiqueta, 'De guardia');
        assert.strictEqual(op('d').estado.codigo, 'AUSENTE');
        assert.deepStrictEqual(tb.equipo, { total: 4, turno: 1, guardia: 1, fuera: 2 });
    });

    await t('Horario: el guardado o el de por defecto (L–V 08:00–17:00)', () => {
        assert.deepStrictEqual(op('b').horario, { dias: [1, 2, 3, 4, 5], inicio: '13:00', fin: '22:00' });
        assert.strictEqual(op('b').horarioPersonalizado, true);
        assert.deepStrictEqual(op('a').horario, { dias: [1, 2, 3, 4, 5], inicio: '08:00', fin: '17:00' });
    });

    await t('Semana: navegación, etiqueta y tira de 7 días con la ventana de guardia', () => {
        assert.strictEqual(tb.semana.inicio, '2026-10-12');
        assert.strictEqual(tb.semana.anterior, '2026-10-05');
        assert.strictEqual(tb.semana.siguiente, '2026-10-19');
        assert.strictEqual(tb.semana.etiqueta, '12 – 18 oct 2026');
        assert.strictEqual(tb.semana.esActual, true);
        const dias = tb.semana.dias;
        assert.deepStrictEqual(dias.map(d => d.nombre), ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']);
        assert.strictEqual(dias[0].horas, '17:00–24:00');
        assert.strictEqual(dias[5].horas, '08:00–24:00');
        assert.strictEqual(dias[5].tipo, 'Fin de semana · desde casa');
        assert.strictEqual(dias.filter(d => d.hoy).length, 1);
        assert.strictEqual(dias[1].hoy, true);
        assert.strictEqual(weekLabel(getWeekStart(at('10:00', '2026-09-30'))), '28 sep – 4 oct 2026');
        assert.strictEqual(weekDays(getWeekStart(at('10:00', '2026-10-20')), NOW).some(d => d.hoy), false);
    });

    await t('Guardia de otra semana: casillas de esa semana, estado con la guardia de hoy', () => {
        const otra = buildShiftBoard({ operators, horarios, guardiaPorDia: new Map([['2026-10-24', new Set(['a'])]]), guardiaActual: new Set(['c']), weekStart: getWeekStart(at('10:00', '2026-10-20')), now: NOW });
        assert.deepStrictEqual(otra.operadores.find(o => o.id === 'a').guardiaDias, ['2026-10-24']);
        assert.deepStrictEqual(otra.semana.dias[5].guardias.map(g => g.id), ['a']);
        assert.strictEqual(otra.semana.sinGuardia, 6);
        assert.strictEqual(otra.operadores.find(o => o.id === 'a').estado.grupo, 'turno');
        assert.strictEqual(otra.semana.esActual, false);
    });

    await t('Vista: tablero, días L–D, casilla de guardia y datos seguros', async () => {
        const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'turno.ejs'), { tablero: tb, activos: 3, currentUser: { nombre: 'Coord', rol: 'COORDINADOR' } });
        assert.ok(html.includes('Guardia por día'));
        assert.ok(html.includes('5 días de esta semana sin guardia'));
        assert.ok(html.includes('data-gdate="2026-10-14" aria-pressed="true" aria-label="Guardia de Carla Díaz'), 'botón de guardia por día');
        assert.ok(/data-wday-guards="2026-10-14">\s*<i title="Ana Pérez">AP<\/i><i title="Carla Díaz">CD<\/i>/.test(html), 'la tira muestra quién está cada día');
        assert.strictEqual((html.match(/data-op="/g) || []).length, 4);
        assert.ok(html.includes('data-day="0" aria-pressed="false"'), 'domingo apagado por defecto');
        assert.ok(/title="Gestión de Turno" aria-current="page"/.test(html));
        const vacio = buildShiftBoard({ weekStart: semana, now: NOW });
        const html2 = await ejs.renderFile(path.join(__dirname, '..', 'views', 'turno.ejs'), { tablero: vacio, activos: 0, currentUser: { nombre: 'Coord', rol: 'COORDINADOR' } });
        assert.ok(html2.includes('Todavía no hay operadores'));
        assert.ok(html2.includes('7 días de esta semana sin guardia'));
    });

    await t('Controlador: /gestion-turno renderiza la semana pedida y redirige al operador', async () => {
        const ctrl = require('../src/controllers/turnoController');
        prisma.user.findMany = async () => operators;
        prisma.ticket.count = async () => 5;
        const pedidas = [];
        prisma.horarioOperador = { findMany: async () => [] };
        prisma.guardiaDia = { findMany: async ({ where }) => { pedidas.push(where.OR[0].fecha.gte.toISOString()); return []; } };
        let vista, data;
        await ctrl.renderTurno({ user: { rol: 'COORDINADOR' }, query: { semana: '2026-10-21' } }, { render: (v, d) => { vista = v; data = d; }, status: () => ({ send() {} }) });
        assert.strictEqual(vista, 'turno');
        assert.strictEqual(data.tablero.semana.inicio, '2026-10-19');
        assert.strictEqual(data.activos, 5);
        assert.ok(pedidas.includes(getWeekStart(new Date('2026-10-21T12:00:00Z')).toISOString()));
        let redir;
        await ctrl.renderTurno({ user: { rol: 'OPERADOR' }, query: {} }, { redirect: (c, u) => { redir = u; } });
        assert.strictEqual(redir, '/');
    });

    await t('Auditoría con nombres: guardia y horario', async () => {
        const ctrl = require('../src/controllers/turnoController');
        const logs = [];
        prisma.auditLog = { create: async ({ data }) => { logs.push(data); } };
        prisma.user.findMany = async () => [{ id: 'a', nombre: 'Ana Pérez' }];
        prisma.$transaction = async () => [];
        prisma.guardiaDia = { deleteMany: () => ({}), createMany: () => ({}) };
        const res = { status() { return this; }, json(b) { this.body = b; return this; } };
        await ctrl.setGuardia({ body: { semana: '2026-10-13', dias: { '2026-10-13': ['a'], '2026-10-18': ['a'] } }, user: { id: 'u' } }, res);
        assert.strictEqual(logs[0].detalles, 'Semana del 2026-10-12. Lun 12: nadie; Mar 13: Ana Pérez; Mié 14: nadie; Jue 15: nadie; Vie 16: nadie; Sáb 17: nadie; Dom 18: Ana Pérez');
        prisma.user.findFirst = async () => ({ id: 'a', nombre: 'Ana Pérez' });
        prisma.horarioOperador = { upsert: async () => ({}) };
        await ctrl.setHorario({ params: { operatorId: 'a' }, body: { dias: [1, 3, 5], inicio: '09:00', fin: '18:00' }, user: { id: 'u' } }, res);
        assert.strictEqual(logs[1].detalles, 'Ana Pérez: L X V · 09:00–18:00');
    });

    console.log(`\n   RESUMEN: ${passed}/${total} pruebas pasaron correctamente\n`);
    if (passed !== total) process.exit(1);
})();
