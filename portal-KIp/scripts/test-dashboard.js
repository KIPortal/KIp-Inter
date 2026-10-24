// Pruebas del Dashboard General (dashboardService) y de su vista. Sin base de datos.
const assert = require('assert');
const path = require('path');
const { MAPA_VIEWBOX, SHAPES } = require('../src/services/mapaVenezuelaShapes');
const ejs = require('ejs');
const { mergeRules } = require('../src/services/rulesService');
const { buildCoordinatorPanel, agingTickets, jornadaStatus, formatAge, ventanaDashboard } = require('../src/services/dashboardService');
const { ticketsAlAzar, cumple } = require('./ventana-tickets-helper');

let total = 0, passed = 0;
async function t(name, fn) { total++; try { await fn(); passed++; console.log(`  ✅ [PASS] ${name}`); } catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.message}`); } }

// Martes 13/10/2026 14:30 en Caracas (UTC-4)
const NOW = new Date('2026-10-13T18:30:00Z');
const at = (hhmm, dia = '2026-10-13') => new Date(`${dia}T${hhmm}:00-04:00`);

const turno = (codigo, etiqueta) => ({ codigo, etiqueta });
const operators = [
    { id: 'a', nombre: 'Ana Pérez', area_designada: 'WAN', estado_operativo: 'DISPONIBLE', turno: turno('EN_TURNO', 'En turno'), tickets_asignados: [1, 2, 3, 4, 5, 6] },
    { id: 'b', nombre: 'Beto Ruiz', area_designada: 'WAN', estado_operativo: 'DISPONIBLE', turno: turno('EN_TURNO', 'En turno'), tickets_asignados: [1] },
    { id: 'c', nombre: 'Carla Díaz', area_designada: 'WAN', estado_operativo: 'DISPONIBLE', turno: turno('DE_GUARDIA', 'De guardia'), tickets_asignados: [1] },
    { id: 'd', nombre: 'Dani Soto', area_designada: 'TELEFONIA', estado_operativo: 'AUSENTE', turno: turno('AUSENTE', 'Ausente'), tickets_asignados: [] }
];
const ticket = (o) => Object.assign({ estado_actual: 'NUEVO', area_designada: 'WAN', puntos_complejidad: 0, asignado_a_id: null }, o);
const tickets = [
    // Activos de hoy
    ticket({ codigo_incidencia: 'INC-010', createdAt: at('09:00'), puntos_complejidad: 8 }),                      // P1 sin asignar 5 h 30 → crítico y atrasado
    ticket({ codigo_incidencia: 'INC-011', createdAt: at('14:10'), puntos_complejidad: 1 }),                      // P3 sin asignar 20 min → a tiempo
    ticket({ codigo_incidencia: 'INC-012', createdAt: at('10:00'), estado_actual: 'EN_PROGRESO', asignado_a_id: 'a', fecha_asignacion: at('10:05'), updatedAt: at('14:00') }),
    ticket({ codigo_incidencia: 'INC-013', createdAt: at('11:00'), estado_actual: 'EN_PAUSA', asignado_a_id: 'b', fecha_asignacion: at('11:30'), updatedAt: at('11:30') }),
    // Pendiente de ayer (arrastrado)
    ticket({ codigo_incidencia: 'INC-005', createdAt: at('16:00', '2026-10-12'), estado_actual: 'EN_PROGRESO', asignado_a_id: 'c', area_designada: 'WAN', updatedAt: at('13:00') }),
    // Resueltos hoy
    ticket({ codigo_incidencia: 'INC-007', createdAt: at('08:00'), estado_actual: 'RESUELTO', asignado_a_id: 'a', puntos_complejidad: 8, resueltoEn: at('10:00') }),
    ticket({ codigo_incidencia: 'INC-008', createdAt: at('09:00'), estado_actual: 'CERRADO', asignado_a_id: 'b', puntos_complejidad: 5, resueltoEn: at('13:00'), fecha_cierre: at('13:30') }),
    ticket({ codigo_incidencia: 'INC-009', createdAt: at('12:00'), estado_actual: 'CERRADO', asignado_a_id: 'd', area_designada: 'TELEFONIA', puntos_complejidad: 1, fecha_cierre: at('13:00') }),
    // Cerrado ayer: no cuenta en "hoy" pero sí en la semana
    ticket({ codigo_incidencia: 'INC-003', createdAt: at('08:00', '2026-10-12'), estado_actual: 'CERRADO', asignado_a_id: 'a', puntos_complejidad: 5, resueltoEn: at('12:00', '2026-10-12') })
];

(async () => {
    console.log('\n=== PRUEBAS: DASHBOARD GENERAL ===\n');
    const panel = buildCoordinatorPanel({ tickets, operators, now: NOW });

    await t('KPIs: activos, sin asignar, creados, resueltos y pendientes de cierre', () => {
        const k = panel.kpis;
        assert.strictEqual(k.activos, 5);
        assert.strictEqual(k.sinAsignar, 2);
        assert.strictEqual(k.creadosHoy, 7);
        assert.strictEqual(k.resueltosHoy, 3, 'resuelto o cerrado hoy según resueltoEn / fecha_cierre');
        assert.strictEqual(k.pendientesCierre, 1);
        assert.strictEqual(k.criticosSinAsignar, 1);
        assert.deepStrictEqual(k.criticoMasAntiguo, { codigo: 'INC-010', edad: '5 h 30' });
    });

    await t('Carga por área: saturación = puntos de la jornada (abiertos + resueltos hoy) ÷ capacidad de quienes están en turno', () => {
        const wan = panel.areas.find(a => a.codigo === 'WAN');
        assert.strictEqual(wan.abiertos, 5);
        assert.strictEqual(wan.total, 7 - 1 + 1, '6 recibidos hoy en WAN + 1 de ayer');
        assert.strictEqual(wan.puntosAbiertos, 8 + 1 + 2 + 2 + 2, 'sin puntos pesa como nivel 1 (2 pts)');
        assert.strictEqual(wan.puntosResueltos, 8 + 5, 'lo resuelto hoy; lo de ayer no');
        assert.strictEqual(wan.puntos, 15 + 13);
        assert.strictEqual(wan.personas, 3, 'en turno y de guardia');
        assert.strictEqual(wan.capacidad, 3 * 16);
        assert.strictEqual(wan.porcentaje, Math.round(28 / 48 * 100));
        assert.strictEqual(wan.operadores.length, 3);
        const tel = panel.areas.find(a => a.codigo === 'TELEFONIA');
        assert.ok(tel, 'área con operador aparece aunque no tenga abiertos');
        assert.strictEqual(tel.personas, 0, 'el ausente no suma capacidad');
        assert.strictEqual(tel.porcentaje, 0);
        assert.strictEqual(panel.areas[0].codigo, 'WAN', 'ordenadas por saturación');
    });

    await t('Carga por área: un P1 suelto no satura un área con gente; sin nadie en turno, sí', () => {
        const ops = [
            { id: 'x', nombre: 'Xavi', area_designada: 'WAN', estado_operativo: 'DISPONIBLE', turno: turno('EN_TURNO', 'En turno'), tickets_asignados: [1] },
            { id: 'y', nombre: 'Yara', area_designada: 'SEGURIDAD', estado_operativo: 'DISPONIBLE', turno: turno('EN_TURNO', 'En turno'), tickets_asignados: [] },
            { id: 'z', nombre: 'Zoe', area_designada: 'SEGURIDAD', estado_operativo: 'DISPONIBLE', turno: turno('EN_TURNO', 'En turno'), tickets_asignados: [] },
            { id: 'w', nombre: 'Walter', area_designada: 'TELEFONIA', estado_operativo: 'DISPONIBLE', turno: turno('FUERA_DE_TURNO', 'Fuera de turno'), tickets_asignados: [] }
        ];
        const tk = [
            ticket({ codigo_incidencia: 'INC-100', createdAt: at('14:00'), puntos_complejidad: 8, estado_actual: 'EN_PROGRESO', asignado_a_id: 'x' }),
            ticket({ codigo_incidencia: 'INC-101', createdAt: at('14:00'), puntos_complejidad: 8, area_designada: 'SEGURIDAD' }),
            ticket({ codigo_incidencia: 'INC-102', createdAt: at('14:00'), puntos_complejidad: 1, area_designada: 'TELEFONIA' })
        ];
        const p = buildCoordinatorPanel({ tickets: tk, operators: ops, now: NOW });
        const pct = c => p.areas.find(a => a.codigo === c).porcentaje;
        assert.strictEqual(pct('WAN'), 50, 'un P1 con una persona');
        assert.strictEqual(pct('SEGURIDAD'), 25, 'un P1 con dos personas');
        assert.strictEqual(pct('TELEFONIA'), 100, 'nadie en turno');
        // Sin abiertos, lo resuelto hoy sigue contando; fuera de turno se mide contra todo el área
        const hecho = [ticket({ codigo_incidencia: 'INC-103', createdAt: at('09:00'), puntos_complejidad: 8, estado_actual: 'RESUELTO', area_designada: 'TELEFONIA', asignado_a_id: 'w', resueltoEn: at('10:00') })];
        const p3 = buildCoordinatorPanel({ tickets: hecho, operators: ops, now: NOW }).areas.find(a => a.codigo === 'TELEFONIA');
        assert.deepStrictEqual([p3.abiertos, p3.puntos, p3.capacidad, p3.porcentaje], [0, 8, 16, 50]);
        const p2 = buildCoordinatorPanel({ tickets: tk, operators: ops, now: NOW, rules: mergeRules({ capacidad: { puntosPorPersona: 8 } }) });
        assert.strictEqual(p2.areas.find(a => a.codigo === 'WAN').porcentaje, 100, 'la capacidad sale de Reglas');
    });

    await t('Resolución por área: promedio desde la llegada, solo del periodo', () => {
        // WAN hoy: INC-007 2 h, INC-008 4 h → 3 h. Telefonía: INC-009 1 h. General: 7/3 ≈ 2,3 h
        const wan = panel.resolucion.areas.find(a => a.codigo === 'WAN');
        assert.strictEqual(wan.horas, 3);
        assert.strictEqual(panel.resolucion.areas.find(a => a.codigo === 'TELEFONIA').horas, 1);
        assert.strictEqual(panel.resolucion.promedioHoras, 2.3);
    });

    await t('Operadores: puntos y P1/P2/P3 de lo resuelto; semana suma lo de ayer', () => {
        const ana = panel.areas.find(a => a.codigo === 'WAN').operadores.find(o => o.id === 'a');
        assert.strictEqual(ana.carga, 6);
        assert.strictEqual(ana.puntos, 8);
        assert.strictEqual(ana.p1, 1);
        const semana = buildCoordinatorPanel({ tickets, operators, now: NOW, periodo: 'semana' });
        const anaSemana = semana.areas.find(a => a.codigo === 'WAN').operadores.find(o => o.id === 'a');
        assert.strictEqual(anaSemana.puntos, 13);
        assert.strictEqual(semana.periodo, 'semana');
        assert.strictEqual(buildCoordinatorPanel({ tickets, operators, now: NOW, periodo: 'xx' }).periodo, 'jornada');
    });

    await t('Alertas: sobrecarga (1.5× y mínimo 3) y antigüedad por prioridad', () => {
        const sobre = panel.alertas.filter(a => a.tipo === 'sobrecarga');
        assert.strictEqual(sobre.length, 1);
        assert.ok(sobre[0].titulo.startsWith('Ana Pérez'));
        const viejos = panel.alertas.filter(a => a.tipo === 'antiguedad').map(a => a.titulo);
        assert.deepStrictEqual(viejos, ['INC-010 · P1 sin asignar', 'INC-005 · sin prioridad, sin movimiento'], 'P3 de 20 min y EN_PAUSA no alertan');
    });

    await t('Cola de espera: sin asignar y nadie disponible en su área → KPI y alerta', () => {
        // En el escenario nadie está marcado disponible: los 2 sin asignar de WAN quedan en cola
        assert.strictEqual(panel.kpis.enCola, 2);
        const cola = panel.alertas.find(a => a.tipo === 'cola');
        assert.ok(cola && cola.titulo === 'En cola de espera · 2 tickets' && cola.valor === 'WAN');
        assert.strictEqual(panel.alertas[0].tipo, 'cola', 'va primero');
        const conBeto = operators.map(o => o.id === 'b' ? { ...o, turno: { ...o.turno, disponible: true } } : o);
        assert.strictEqual(buildCoordinatorPanel({ tickets, operators: conBeto, now: NOW }).kpis.enCola, 0);
    });

    await t('Antigüedad: sin movimiento usa la última actualización; pausa no cuenta', () => {
        const lista = agingTickets([
            ticket({ codigo_incidencia: 'X1', createdAt: at('08:00'), estado_actual: 'EN_PROGRESO', asignado_a_id: 'a', updatedAt: at('14:20') }),
            ticket({ codigo_incidencia: 'X2', createdAt: at('08:00'), estado_actual: 'EN_PROGRESO', asignado_a_id: 'a', updatedAt: at('13:50') }),
            ticket({ codigo_incidencia: 'X3', createdAt: at('08:00'), estado_actual: 'EN_ESPERA_TERCEROS' })
        ], NOW);
        assert.deepStrictEqual(lista.map(x => x.codigo), ['X2'], 'sin prioridad: 30 min');
    });

    await t('Turno: grupos (en turno, de guardia, fuera) y avance de la jornada', () => {
        const [enTurno, guardia, fuera] = panel.turno.grupos;
        assert.deepStrictEqual([enTurno.personas.length, guardia.personas.length, fuera.personas.length], [2, 1, 1]);
        assert.deepStrictEqual(jornadaStatus(NOW), { porcentaje: 72, detalle: 'Faltan 2 h 30', horario: '08:00 – 17:00', finDeSemana: false });
        assert.strictEqual(jornadaStatus(new Date('2026-10-17T15:00:00Z')).finDeSemana, true);
        assert.strictEqual(formatAge(45), '45 min');
    });

    await t('Flujo de hoy: creados, cerrados y asignados por hora de Caracas', () => {
        const f = panel.flujo;
        assert.strictEqual(f.horaActual, 14);
        assert.strictEqual(f.creados[9], 2);
        assert.strictEqual(f.cerrados[13], 2, 'INC-008 por resueltoEn 13:00 e INC-009 por fecha_cierre');
        assert.strictEqual(f.asignados[10], 1);
        assert.strictEqual(f.asignados[11], 1);
    });

    await t('Ranking: ordenado por puntos, con índice de carga', () => {
        assert.deepStrictEqual(panel.ranking.map(o => o.id), ['a', 'b', 'd']);
        assert.strictEqual(panel.ranking[0].sobrecarga, true);
    });

    await t('Sin datos: no falla y la vista muestra los estados vacíos', async () => {
        const vacio = buildCoordinatorPanel({ now: NOW });
        assert.strictEqual(vacio.kpis.activos, 0);
        const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'dashboard.ejs'), { panel: vacio, currentUser: { nombre: 'Coord', rol: 'COORDINADOR' } });
        assert.ok(html.includes('Todo en orden'));
        assert.ok(html.includes('Todavía no hay tickets'));
    });

    await t('Vista: dibuja áreas, alertas, ranking y no usa las palabras prohibidas', async () => {
        const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'dashboard.ejs'), { panel, currentUser: { nombre: 'Coord', email: 'c@x.com', rol: 'COORDINADOR' } });
        assert.ok(html.includes('data-area="WAN"'));
        assert.ok(html.includes('INC-010 · P1 sin asignar'));
        assert.ok(html.includes('id="panel-flujo"'));
        assert.ok(!/\bSLA\b|\bDERS\b/.test(html));
        assert.ok(html.includes('aria-current="page"'));
    });

    await t('Mapa: cuenta tickets activos por estado y deja aparte los que no tienen estado', async () => {
        const { buildTerritorialMap } = require('../src/services/dashboardService');
        const act = [{ estado_ve: 'VEA' }, { estado_ve: 'VEA' }, { estado_ve: 'VEV' }, { estado_ve: null }, { estado_ve: 'XX' }];
        const mapa = buildTerritorialMap(act);
        assert.strictEqual(mapa.totalActivos, 3);
        assert.strictEqual(mapa.sinEstado, 2);
        assert.strictEqual(mapa.estados.VEA.activos, 2);
        assert.strictEqual(mapa.estados.VEA.porcentaje, 67);
        assert.deepStrictEqual(mapa.ranking.map(e => e.codigo), ['VEA', 'VEV']);
        assert.ok(mapa.resumen.includes('Distrito Capital 2'));
        assert.strictEqual(Object.keys(SHAPES).length, Object.keys(mapa.estados).length);
    });

    await t('Estado de Venezuela: valida el valor recibido (vacío = sin estado)', () => {
        const { parseEstadoVe } = require('../src/services/estadosVeService');
        assert.deepStrictEqual(parseEstadoVe('VEA'), { valor: 'VEA' });
        assert.deepStrictEqual(parseEstadoVe(''), { valor: null });
        assert.deepStrictEqual(parseEstadoVe(null), { valor: null });
        assert.ok(parseEstadoVe('Caracas').error);
    });

    await t('Vista: dibuja el mapa con los estados y el ranking territorial', async () => {
        const conMapa = buildCoordinatorPanel({ tickets: [{ codigo_incidencia: 'INC-1', estado_actual: 'NUEVO', area_designada: 'WAN', estado_ve: 'VEV', createdAt: NOW, updatedAt: NOW }], now: NOW });
        const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'dashboard.ejs'), { panel: conMapa, mapaViewBox: MAPA_VIEWBOX, mapaShapes: SHAPES, currentUser: { nombre: 'Coord', rol: 'COORDINADOR' } });
        assert.ok(html.includes('data-estado="VEV"'));
        assert.strictEqual((html.match(/class="mapa-estado/g) || []).length, 25);
        assert.ok(html.includes('data-estado-btn="VEV"'));
        assert.ok(html.includes('Zulia'));
    });

    await t('Ventana del Dashboard: sin los cerrados viejos da el mismo panel (hoy y semana)', () => {
        const todos = ticketsAlAzar(NOW);
        for (const periodo of ['jornada', 'semana']) {
            const ventana = todos.filter(x => cumple(x, ventanaDashboard({ periodo, now: NOW })));
            assert.ok(ventana.length < todos.length, 'la ventana debe dejar fuera cerrados viejos');
            const completo = buildCoordinatorPanel({ tickets: todos, operators, now: NOW, periodo });
            const filtrado = buildCoordinatorPanel({ tickets: ventana, operators, now: NOW, periodo });
            assert.deepStrictEqual(filtrado, completo, periodo);
        }
    });

    await t('Carga por área: promedio y límite de sobrecarga por operador para dibujar la barra', async () => {
        const p = buildCoordinatorPanel({ tickets, operators, now: NOW });
        const ana = p.areas.find(x => x.codigo === 'WAN').operadores.find(o => o.nombre === 'Ana Pérez');
        assert.ok(ana.promedioArea > 0, 'WAN tiene con quién comparar');
        assert.strictEqual(ana.limiteCarga, Math.round(ana.promedioArea * 1.5 * 100) / 100);
        const dani = p.areas.find(x => x.codigo === 'TELEFONIA').operadores.find(o => o.nombre === 'Dani Soto');
        assert.strictEqual(dani.promedioArea, null, 'un solo operador: sin comparación');
        assert.strictEqual(dani.limiteCarga, null);
        const sinSobre = buildCoordinatorPanel({ tickets, operators, now: NOW, rules: mergeRules({ sobrecarga: { activa: false } }) });
        assert.strictEqual(sinSobre.areas.find(x => x.codigo === 'WAN').operadores[0].limiteCarga, null, 'sobrecarga apagada: sin límite');
        const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'dashboard.ejs'), { currentUser: { nombre: 'C', rol: 'COORDINADOR' }, panel: p, mapaViewBox: MAPA_VIEWBOX, mapaShapes: SHAPES });
        assert.ok(html.includes('class="ld-avg"') && html.includes('class="ld-lim"') && html.includes('load-chip'));
    });

    console.log(`\n   RESUMEN: ${passed}/${total} pruebas pasaron correctamente\n`);
    if (passed !== total) process.exit(1);
})();
