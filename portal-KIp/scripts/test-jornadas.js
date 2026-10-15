// Pruebas del registro de jornadas (jornadaRegistroService y su uso en Reportes). Sin base de datos.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const svc = require('../src/services/jornadaRegistroService');
const { getPeriodBounds } = require('../src/services/metricsService');
const { buildReportView, sourceView } = require('../src/services/reportViewService');

let total = 0, passed = 0;
async function t(name, fn) { total++; try { await fn(); passed++; console.log(`  ✅ [PASS] ${name}`); } catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.message}`); } }
const at = (hhmm, dia) => new Date(`${dia}T${hhmm}:00-04:00`);

const ops = [
    { id: 'a', nombre: 'Ana Pérez', area_designada: 'WAN', estado_operativo: 'DISPONIBLE' },
    { id: 'b', nombre: 'Beto Ruiz', area_designada: 'WAN', estado_operativo: 'DISPONIBLE' }
];
const tk = o => Object.assign({ asunto: 'x', area_designada: 'WAN', estado_actual: 'NUEVO', puntos_complejidad: 0, fecha_asignacion: null, resueltoEn: null, fecha_cierre: null, asignado_a: null }, o);

// Prisma simulado: tickets/usuarios en vivo y la tabla RegistroJornada en memoria
function fakePrisma({ tickets = [], operators = ops } = {}) {
    const filas = new Map();
    return {
        filas,
        live: { tickets, operators },
        ticket: { findMany: async function () { return this._p.live.tickets; } },
        user: { findMany: async function () { return this._p.live.operators; } },
        registroJornada: {
            findUnique: async ({ where }) => filas.get(where.fecha) || null,
            findMany: async ({ where = {} } = {}) => {
                let out = [...filas.values()];
                if (where.fecha?.in) out = out.filter(f => where.fecha.in.includes(f.fecha));
                if (where.fecha?.gte) out = out.filter(f => f.fecha >= where.fecha.gte);
                if (where.fecha?.lte) out = out.filter(f => f.fecha <= where.fecha.lte);
                return out.sort((x, y) => y.fecha.localeCompare(x.fecha));
            },
            upsert: async ({ where, create, update }) => {
                const prev = filas.get(where.fecha);
                // Como Postgres: el JSON sale de la base como texto, no como Date
                const fila = JSON.parse(JSON.stringify(prev ? { ...prev, ...update } : create));
                filas.set(where.fecha, fila);
                return fila;
            }
        }
    };
}
const conPrisma = p => { p.ticket._p = p; p.user._p = p; return p; };

(async () => {
    console.log('\n=== PRUEBAS: REGISTRO DE JORNADAS ===\n');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jornadas-'));

    await t('Días de un rango y ruta del Excel por fecha', () => {
        assert.deepStrictEqual(svc.rangeDays(getPeriodBounds('jornada', '2026-10-13')), ['2026-10-13']);
        const semana = svc.rangeDays(getPeriodBounds('semana', '2026-10-14'));
        assert.deepStrictEqual([semana.length, semana[0], semana[6]], [7, '2026-10-12', '2026-10-18'], 'lunes a domingo');
        assert.strictEqual(svc.excelRelPath('2026-10-13').split(path.sep).join('/'), '2026/10/jornada-2026-10-13.xlsx');
        assert.strictEqual(svc.ayer(at('00:05', '2026-10-14')), '2026-10-13', 'a las 00:05 cierra el día anterior');
        assert.ok(svc.isFecha('2026-10-13') && !svc.isFecha('13-10-2026') && !svc.isFecha('2026-13-40'));
    });

    await t('Fuente: en vivo si el periodo no terminó; registro solo si están todos los días', () => {
        const dia = getPeriodBounds('jornada', '2026-10-13');
        const now = at('09:00', '2026-10-15');
        assert.strictEqual(svc.chooseSource({ range: dia, fechasRegistradas: ['2026-10-13'], now }).tipo, 'registro');
        assert.strictEqual(svc.chooseSource({ range: dia, fechasRegistradas: ['2026-10-13'], now, forzarVivo: true }).tipo, 'vivo');
        const sinReg = svc.chooseSource({ range: dia, fechasRegistradas: [], now });
        assert.deepStrictEqual([sinReg.tipo, sinReg.faltan], ['vivo', ['2026-10-13']]);
        const hoy = svc.chooseSource({ range: getPeriodBounds('jornada', '2026-10-15'), fechasRegistradas: ['2026-10-15'], now });
        assert.deepStrictEqual([hoy.tipo, hoy.terminado, hoy.faltan], ['vivo', false, []], 'hoy siempre en vivo');
        const semana = getPeriodBounds('semana', '2026-10-05');
        const seis = svc.rangeDays(semana).slice(0, 6);
        assert.deepStrictEqual(svc.chooseSource({ range: semana, fechasRegistradas: seis, now }).faltan, ['2026-10-11']);
        assert.strictEqual(svc.chooseSource({ range: semana, fechasRegistradas: svc.rangeDays(semana), now }).tipo, 'registro');
    });

    await t('Mezcla de días: cada ticket queda con su estado del último cierre', () => {
        const lun = { fecha: '2026-10-12', datos: svc.snapshotFrom({ tickets: [tk({ codigo_incidencia: 'INC-1', createdAt: at('09:00', '2026-10-12'), estado_actual: 'EN_PROGRESO', asignado_a: { id: 'a', nombre: 'Ana Pérez' } })], operators: [{ ...ops[0], estado_operativo: 'AUSENTE' }] }) };
        const mar = { fecha: '2026-10-13', datos: svc.snapshotFrom({ tickets: [tk({ codigo_incidencia: 'INC-1', createdAt: at('09:00', '2026-10-12'), resueltoEn: at('10:00', '2026-10-13'), estado_actual: 'RESUELTO', asignado_a: { id: 'a', nombre: 'Ana Pérez' } })], operators: ops }) };
        const m = svc.mergeSnapshots([mar, lun]);
        assert.strictEqual(m.tickets.length, 1);
        assert.strictEqual(m.tickets[0].estado_actual, 'RESUELTO');
        assert.ok(m.tickets[0].createdAt instanceof Date && m.tickets[0].resueltoEn instanceof Date, 'fechas revividas');
        assert.strictEqual(m.operators.find(o => o.id === 'a').estado_operativo, 'DISPONIBLE');
    });

    const dia = '2026-10-13';
    const vivos = [
        tk({ codigo_incidencia: 'INC-1', createdAt: at('08:00', dia), fecha_asignacion: at('08:10', dia), resueltoEn: at('10:00', dia), estado_actual: 'RESUELTO', puntos_complejidad: 8, asignado_a: { id: 'a', nombre: 'Ana Pérez' } }),
        tk({ codigo_incidencia: 'INC-2', createdAt: at('11:00', dia), fecha_asignacion: at('11:05', dia), estado_actual: 'EN_PROGRESO', puntos_complejidad: 5, asignado_a: { id: 'b', nombre: 'Beto Ruiz' } })
    ];
    const p = conPrisma(fakePrisma({ tickets: vivos }));

    await t('Cerrar jornada: guarda la foto, el resumen y el Excel en la carpeta por fecha', async () => {
        const r = await svc.cerrarJornada(p, { fecha: dia, origen: 'MANUAL', cerradoPor: 'Coord', now: at('23:00', dia), dir });
        assert.ok(r.ok);
        assert.strictEqual(r.archivo, '2026/10/jornada-2026-10-13.xlsx');
        const abs = path.join(dir, r.archivo);
        assert.ok(fs.existsSync(abs));
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(abs);
        assert.ok(wb.worksheets.length >= 4, 'mismas hojas que el Excel de Reportes');
        const fila = p.filas.get(dia);
        assert.deepStrictEqual([fila.origen, fila.cerradoPor, fila.resumen.creados, fila.resumen.activos, fila.datos.tickets.length], ['MANUAL', 'Coord', 2, 1, 2]);
    });

    await t('Cerrar jornada: no reemplaza sin permiso, no acepta fechas futuras ni inválidas', async () => {
        assert.deepStrictEqual(await svc.cerrarJornada(p, { fecha: dia, now: at('23:30', dia), dir }), { existe: true, fecha: dia });
        assert.ok((await svc.cerrarJornada(p, { fecha: '2026-10-20', now: at('10:00', dia), dir })).error);
        assert.ok((await svc.cerrarJornada(p, { fecha: 'ayer', now: at('10:00', dia), dir })).error);
        assert.ok((await svc.cerrarJornada(p, { fecha: dia, origen: 'OTRO', now: at('10:00', dia), dir })).error);
    });

    await t('Evaluar un día pasado: usa la foto del cierre aunque los tickets cambien después', async () => {
        // Después del cierre: INC-2 se resolvió y Ana quedó ausente
        p.live.tickets = [vivos[0], { ...vivos[1], estado_actual: 'RESUELTO', resueltoEn: at('09:00', '2026-10-14') }];
        p.live.operators = [{ ...ops[0], estado_operativo: 'AUSENTE' }, ops[1]];
        const now = at('09:00', '2026-10-15');
        const range = getPeriodBounds('jornada', dia);
        const reg = await svc.loadReport(p, { range, now });
        assert.strictEqual(reg.fuente.tipo, 'registro');
        assert.strictEqual(reg.report.resumen.activos, 1, 'INC-2 seguía activo al cierre');
        assert.strictEqual(reg.report.porOperador.find(o => o.id === 'a').estadoCarga !== 'Ausente', true, 'Ana estaba disponible');
        assert.strictEqual(reg.fuente.registro.origen, 'MANUAL');
        const vivo = await svc.loadReport(p, { range, now, forzarVivo: true });
        assert.deepStrictEqual([vivo.fuente.tipo, vivo.report.resumen.activos], ['vivo', 0]);
        const area = await svc.loadReport(p, { range, now, area: 'TELEFONIA' });
        assert.strictEqual(area.report.resumen.creados, 0, 'el filtro de área se aplica sobre la foto');
    });

    await t('Semana: en vivo con días faltantes; registro cuando están todos', async () => {
        const now = at('09:00', '2026-10-20');
        const range = getPeriodBounds('semana', dia);
        const parcial = await svc.loadReport(p, { range, now });
        assert.deepStrictEqual([parcial.fuente.tipo, parcial.fuente.faltan.length], ['vivo', 6]);
        for (const f of svc.rangeDays(range)) if (f !== dia) await svc.cerrarJornada(p, { fecha: f, origen: 'RECUPERADO', now, dir });
        const completa = await svc.loadReport(p, { range, now });
        assert.strictEqual(completa.fuente.tipo, 'registro');
        assert.strictEqual(completa.report.resumen.creados, 2);
        assert.strictEqual(completa.report.resumen.activos, 0, 'al cierre de la semana INC-2 ya estaba resuelto');
    });

    await t('Lista de jornadas y Excel guardado (el jefe recibe solo su área)', async () => {
        const lista = await svc.listarJornadas(p, { desde: '2026-10-12', hasta: '2026-10-13' });
        assert.deepStrictEqual(lista.map(j => j.fecha), ['2026-10-13', '2026-10-12']);
        assert.deepStrictEqual([lista[0].creados, lista[0].resueltos, lista[0].tieneExcel], [2, 1, true]);
        const x = await svc.excelDeJornada(p, dia, { dir });
        assert.strictEqual(x.filename, 'jornada-2026-10-13.xlsx');
        assert.ok(x.buffer.equals(fs.readFileSync(path.join(dir, '2026/10/jornada-2026-10-13.xlsx'))), 'el archivo guardado tal cual');
        const jefe = await svc.excelDeJornada(p, dia, { area: 'WAN', dir });
        assert.strictEqual(jefe.filename, 'jornada-2026-10-13-WAN.xlsx');
        fs.rmSync(path.join(dir, '2026/10/jornada-2026-10-13.xlsx'));
        assert.ok((await svc.excelDeJornada(p, dia, { dir })).buffer.length > 0, 'sin archivo en disco se regenera desde la foto');
        assert.ok((await svc.excelDeJornada(p, '2026-01-01', { dir })).noExiste);
    });

    await t('Vista: texto de la fuente, botón de guardar y Excel guardado', () => {
        const fuente = svc.chooseSource({ range: getPeriodBounds('jornada', dia), fechasRegistradas: [dia], now: at('09:00', '2026-10-15') });
        fuente.registro = { fecha: dia, cerradoEn: at('00:05', '2026-10-14'), origen: 'AUTOMATICO', tieneExcel: true };
        const s = sourceView(fuente, 'jornada', dia);
        assert.deepStrictEqual([s.tipo, s.guardado, s.excel], ['registro', true, '/reportes/jornadas/2026-10-13/excel']);
        assert.ok(s.texto.includes('14 oct 00:05') && s.texto.includes('cierre automático'), s.texto);
        const falta = sourceView(svc.chooseSource({ range: getPeriodBounds('semana', dia), fechasRegistradas: [dia], now: at('09:00', '2026-10-20') }), 'semana', '2026-10-12');
        assert.ok(falta.texto.startsWith('En vivo · faltan 6 días por registrar'), falta.texto);
        assert.strictEqual(falta.dia, null);
        assert.strictEqual(sourceView(null, 'jornada', dia).guardado, false, 'sin fuente: en vivo y sin registro');
    });

    await t('Reportes: la vista dibuja la fuente y los botones', async () => {
        const ejs = require('ejs');
        const r = await svc.loadReport(p, { range: getPeriodBounds('jornada', dia), now: at('09:00', '2026-10-15') });
        const vista = buildReportView(r.report, { periodo: 'jornada', fecha: dia, now: at('09:00', '2026-10-15') });
        const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'reportes.ejs'), {
            vista, areasCatalogo: [], activos: 0, currentUser: { nombre: 'Coord', rol: 'COORDINADOR' }
        });
        assert.ok(html.includes('data-fuente="registro"'));
        assert.ok(html.includes('href="/reportes/jornadas/2026-10-13/excel"'));
        assert.ok(html.includes('Volver a guardar jornada'));
        assert.ok(!/\bSLA\b|\bDERS\b|[Mm]ediana/.test(html));
    });

    await t('Cierre automático: se desactiva con CIERRE_JORNADA=off y programa las 00:05 de Caracas', () => {
        process.env.CIERRE_JORNADA = 'off';
        assert.strictEqual(svc.programarCierre(p, { schedule() { throw new Error('no debía programar'); } }), false);
        delete process.env.CIERRE_JORNADA;
        let prog;
        const orig = global.setTimeout;
        global.setTimeout = () => ({ unref() {} });
        try {
            assert.strictEqual(svc.programarCierre(p, { schedule: (expr, fn, opts) => { prog = { expr, opts }; } }), true);
        } finally {
            global.setTimeout = orig;
        }
        assert.deepStrictEqual(prog, { expr: '5 0 * * *', opts: { timezone: 'America/Caracas' } });
    });

    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`\n   RESUMEN: ${passed}/${total} pruebas pasaron correctamente\n`);
    if (passed !== total) process.exit(1);
})();
