'use strict';

/**
 * Registro de jornadas: al cierre de cada día se guarda una foto de los tickets y
 * operadores (tal como estaban) en la tabla RegistroJornada y el Excel del día en
 * una carpeta por fecha. Al evaluar un día o una semana ya terminados, el reporte se
 * arma con esas fotos en lugar de los datos en vivo, así "activos", la carga y los
 * ausentes son los del cierre y no los de ahora.
 *
 * Las funciones puras (fotos, mezcla de días, elección de fuente) se prueban sin base
 * de datos en scripts/test-jornadas.js; las de E/S reciben prisma por parámetro.
 */

const fs = require('fs');
const path = require('path');
const { ATIENDE_WHERE } = require('./roleService');
const { ACTIVE_STATES, getPeriodBounds, getDayBounds, formatCaracasDate, parseCaracasDate } = require('./metricsService');
const { buildPeriodReport } = require('./periodReportService');
const { buildWorkbook } = require('./excelExportService');

const DAY_MS = 24 * 3600 * 1000;
const ORIGENES = Object.freeze(['AUTOMATICO', 'MANUAL', 'RECUPERADO']);
const TICKET_DATES = ['createdAt', 'fecha_asignacion', 'resueltoEn', 'fecha_cierre'];
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

// Carpeta de registros: REGISTROS_DIR o portal-KIp/registros/jornadas
const registrosDir = () => process.env.REGISTROS_DIR || path.join(__dirname, '..', '..', 'registros', 'jornadas');

/** Ruta relativa del Excel de un día: AAAA/MM/jornada-AAAA-MM-DD.xlsx */
function excelRelPath(fecha) {
    return path.join(fecha.slice(0, 4), fecha.slice(5, 7), `jornada-${fecha}.xlsx`);
}

const isFecha = fecha => typeof fecha === 'string' && FECHA_RE.test(fecha) && Boolean(parseCaracasDate(fecha));

/** Fecha (Caracas) del día anterior a `now`. */
function ayer(now = new Date()) {
    return formatCaracasDate(new Date(getDayBounds(now).start.getTime() - DAY_MS));
}

/** Días (AAAA-MM-DD) que cubre un rango de getPeriodBounds(). */
function rangeDays(range) {
    const out = [];
    for (let t = range.start.getTime(); t < range.end.getTime(); t += DAY_MS) out.push(formatCaracasDate(new Date(t)));
    return out;
}

/** Tickets y operadores en vivo para un rango (los del periodo más todos los activos). */
async function loadLiveData(prisma, range) {
    const [tickets, operators] = await Promise.all([prisma.ticket.findMany({
        where: {
            OR: [
                { createdAt: { gte: range.start, lt: range.end } },
                { fecha_asignacion: { gte: range.start, lt: range.end } },
                { resueltoEn: { gte: range.start, lt: range.end } },
                { fecha_cierre: { gte: range.start, lt: range.end } },
                { estado_actual: { in: ACTIVE_STATES } }
            ]
        },
        select: {
            codigo_incidencia: true, asunto: true, area_designada: true, estado_actual: true,
            puntos_complejidad: true, prioridad: true, nivel: true, tipo_caso_id: true, createdAt: true, fecha_asignacion: true, resueltoEn: true, fecha_cierre: true,
            asignado_a: { select: { id: true, nombre: true } },
            tipo_caso: { select: { nombre: true, nivel: true, minutos_estimados: true, frecuencia: true } }
        },
        orderBy: { createdAt: 'asc' }
    }), prisma.user.findMany({
        where: ATIENDE_WHERE,
        select: { id: true, nombre: true, area_designada: true, estado_operativo: true },
        orderBy: { nombre: 'asc' }
    })]);
    return { tickets, operators };
}

// Versión de la forma de la foto: si el reporte llega a necesitar más campos, las fotos
// viejas se reconocen por su versión y los campos que les falten quedan vacíos.
const SNAPSHOT_VERSION = 1;

/** Foto guardable en JSON (fechas como texto ISO). */
function snapshotFrom({ tickets = [], operators = [] }) {
    return { v: SNAPSHOT_VERSION, ...JSON.parse(JSON.stringify({ tickets, operators })) };
}

/** Foto leída de la base → fechas de vuelta a Date. */
function reviveSnapshot(datos) {
    const d = datos || {};
    return {
        tickets: (d.tickets || []).map(t => {
            const out = { ...t };
            TICKET_DATES.forEach(k => { out[k] = t[k] ? new Date(t[k]) : null; });
            return out;
        }),
        operators: (d.operators || []).map(o => ({ ...o }))
    };
}

/**
 * Une las fotos de varios días: de cada ticket (y operador) queda la versión del día
 * más reciente, que es su estado al cierre del periodo.
 */
function mergeSnapshots(registros) {
    const tickets = new Map();
    const operators = new Map();
    [...(registros || [])].sort((a, b) => a.fecha.localeCompare(b.fecha)).forEach(r => {
        const foto = reviveSnapshot(r.datos);
        foto.tickets.forEach(t => tickets.set(t.codigo_incidencia, t));
        foto.operators.forEach(o => operators.set(o.id, o));
    });
    return {
        tickets: [...tickets.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
        operators: [...operators.values()].sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)))
    };
}

/**
 * Decide si un periodo se arma con el registro o en vivo.
 *  - Periodo sin terminar (incluye hoy) → en vivo.
 *  - Terminado y con todos sus días registrados → registro.
 *  - Terminado pero faltan días → en vivo, avisando cuáles faltan.
 *  - forzarVivo → en vivo.
 */
function chooseSource({ range, fechasRegistradas = [], now = new Date(), forzarVivo = false }) {
    const dias = rangeDays(range);
    const set = new Set(fechasRegistradas);
    const guardados = dias.filter(d => set.has(d));
    const terminado = range.end.getTime() <= now.getTime();
    const faltan = terminado ? dias.filter(d => !set.has(d)) : [];
    const tipo = !forzarVivo && terminado && faltan.length === 0 ? 'registro' : 'vivo';
    return { tipo, terminado, dias: dias.length, guardados, faltan };
}

/** Carga el reporte de un periodo: desde el registro si corresponde, si no en vivo. */
async function loadReport(prisma, { range, area = null, now = new Date(), forzarVivo = false }) {
    const dias = rangeDays(range);
    let registros = [];
    try {
        registros = await prisma.registroJornada.findMany({
            where: { fecha: { in: dias } },
            select: { fecha: true, cerradoEn: true, origen: true, archivo: true }
        });
    } catch (e) {
        // Sin la tabla (migración pendiente) el reporte sigue funcionando en vivo
        console.error('No se pudo leer el registro de jornadas:', e.message);
    }
    const fuente = chooseSource({ range, fechasRegistradas: registros.map(r => r.fecha), now, forzarVivo });
    let data;
    if (fuente.tipo === 'registro') {
        const completos = await prisma.registroJornada.findMany({ where: { fecha: { in: dias } }, select: { fecha: true, datos: true } });
        data = mergeSnapshots(completos);
    } else {
        data = await loadLiveData(prisma, range);
    }
    const unico = dias.length === 1 ? registros[0] : null;
    fuente.registro = unico ? { fecha: unico.fecha, cerradoEn: unico.cerradoEn, origen: unico.origen, tieneExcel: Boolean(unico.archivo) } : null;
    const report = buildPeriodReport({ ...data, range, area });
    report.fuente = fuente;
    return { report, range, fuente };
}

/**
 * Cierra (registra) la jornada de una fecha: toma la foto en vivo, guarda el Excel
 * en la carpeta de registros y la fila en RegistroJornada.
 * Si ya existe, solo la reemplaza con reemplazar=true (devuelve { existe: true } si no).
 */
async function cerrarJornada(prisma, { fecha, origen = 'MANUAL', cerradoPor = null, reemplazar = false, now = new Date(), dir = registrosDir() } = {}) {
    const dia = fecha || formatCaracasDate(now);
    if (!isFecha(dia)) return { error: 'Fecha no válida (AAAA-MM-DD)' };
    if (dia > formatCaracasDate(now)) return { error: 'No se puede cerrar una jornada futura' };
    if (!ORIGENES.includes(origen)) return { error: 'Origen no válido' };
    const previo = await prisma.registroJornada.findUnique({ where: { fecha: dia }, select: { fecha: true } });
    if (previo && !reemplazar) return { existe: true, fecha: dia };

    const range = getPeriodBounds('jornada', dia);
    const data = await loadLiveData(prisma, range);
    const report = buildPeriodReport({ ...data, range });

    let archivo = null;
    try {
        const rel = excelRelPath(dia);
        const abs = path.join(dir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        const buffer = await buildWorkbook(report, { generadoPor: cerradoPor || 'Cierre automático', generadoEn: now });
        fs.writeFileSync(abs, Buffer.from(buffer));
        archivo = rel.split(path.sep).join('/');
    } catch (e) {
        // Sin carpeta escribible igual queda la foto en la base (el Excel se regenera al descargar)
        console.error(`No se pudo guardar el Excel de la jornada ${dia}:`, e.message);
    }

    const fila = { datos: snapshotFrom(data), resumen: report.resumen, archivo, origen, cerradoPor, cerradoEn: now };
    await prisma.registroJornada.upsert({ where: { fecha: dia }, create: { fecha: dia, ...fila }, update: fila });
    return { ok: true, fecha: dia, reemplazado: Boolean(previo), archivo, resumen: report.resumen };
}

/** Lista de jornadas registradas (más recientes primero). */
async function listarJornadas(prisma, { desde = null, hasta = null, limite = 60 } = {}) {
    const fecha = {};
    if (isFecha(desde)) fecha.gte = desde;
    if (isFecha(hasta)) fecha.lte = hasta;
    const filas = await prisma.registroJornada.findMany({
        where: Object.keys(fecha).length ? { fecha } : {},
        select: { fecha: true, resumen: true, archivo: true, origen: true, cerradoPor: true, cerradoEn: true },
        orderBy: { fecha: 'desc' },
        take: Math.min(Math.max(Number(limite) || 60, 1), 400)
    });
    return filas.map(f => ({
        fecha: f.fecha,
        origen: f.origen,
        cerradoPor: f.cerradoPor,
        cerradoEn: f.cerradoEn,
        tieneExcel: Boolean(f.archivo),
        creados: f.resumen?.creados ?? 0,
        resueltos: f.resumen?.resueltos ?? 0,
        activos: f.resumen?.activos ?? 0,
        puntos: f.resumen?.puntos ?? 0
    }));
}

/**
 * Excel de una jornada registrada. Con área (jefe) o sin archivo en disco se
 * regenera desde la foto guardada; si no, se entrega el archivo tal cual.
 */
async function excelDeJornada(prisma, fecha, { area = null, generadoPor = '', dir = registrosDir() } = {}) {
    if (!isFecha(fecha)) return { error: 'Fecha no válida (AAAA-MM-DD)' };
    const r = await prisma.registroJornada.findUnique({ where: { fecha } });
    if (!r) return { noExiste: true };
    if (!area && r.archivo) {
        const abs = path.join(dir, r.archivo);
        if (fs.existsSync(abs)) return { buffer: fs.readFileSync(abs), filename: `jornada-${fecha}.xlsx` };
    }
    const range = getPeriodBounds('jornada', fecha);
    const report = buildPeriodReport({ ...reviveSnapshot(r.datos), range, area });
    const buffer = await buildWorkbook(report, { generadoPor, generadoEn: new Date(r.cerradoEn) });
    return { buffer: Buffer.from(buffer), filename: `jornada-${fecha}${area ? '-' + area : ''}.xlsx` };
}

/**
 * Quita de las fotos guardadas los tickets y operadores indicados (p. ej. la simulación
 * SIM-xxx / @demo.local) y recalcula su resumen. El Excel de esos días se borra y se
 * regenera desde la foto al descargarlo.
 */
async function depurarRegistros(prisma, { prefijoCodigo = null, operadorIds = [], dir = registrosDir() } = {}) {
    const ids = new Set(operadorIds);
    const fuera = t => (prefijoCodigo && String(t.codigo_incidencia || '').startsWith(prefijoCodigo)) || (t.asignado_a && ids.has(t.asignado_a.id));
    const filas = await prisma.registroJornada.findMany({ select: { fecha: true, datos: true, archivo: true } });
    let cambiados = 0;
    for (const f of filas) {
        const tickets = (f.datos?.tickets || []);
        const operators = (f.datos?.operators || []);
        const t2 = tickets.filter(t => !fuera(t));
        const o2 = operators.filter(o => !ids.has(o.id));
        if (t2.length === tickets.length && o2.length === operators.length) continue;
        const datos = { ...f.datos, tickets: t2, operators: o2 };
        const report = buildPeriodReport({ ...reviveSnapshot(datos), range: getPeriodBounds('jornada', f.fecha) });
        if (f.archivo) {
            try { fs.rmSync(path.join(dir, f.archivo), { force: true }); } catch (e) { /* se regenera igual */ }
        }
        await prisma.registroJornada.update({ where: { fecha: f.fecha }, data: { datos, resumen: report.resumen, archivo: null } });
        cambiados++;
    }
    return cambiados;
}

/**
 * Cierre automático: cada día a las 00:05 (Caracas) registra la jornada que terminó.
 * Al arrancar, si falta el registro de ayer (servidor apagado a medianoche), lo toma.
 * Se desactiva con CIERRE_JORNADA=off.
 */
function programarCierre(prisma, cron = require('node-cron')) {
    if (process.env.CIERRE_JORNADA === 'off') return false;
    const cerrarAyer = async origen => {
        try {
            const r = await cerrarJornada(prisma, { fecha: ayer(), origen, reemplazar: origen === 'AUTOMATICO' });
            if (r.ok) console.log(`📒 Jornada ${r.fecha} registrada (${origen.toLowerCase()})${r.archivo ? ': ' + r.archivo : ''}`);
        } catch (e) {
            console.error('No se pudo registrar la jornada:', e.message);
        }
    };
    cron.schedule('5 0 * * *', () => cerrarAyer('AUTOMATICO'), { timezone: 'America/Caracas' });
    setTimeout(() => cerrarAyer('RECUPERADO'), 15000).unref?.();
    return true;
}

module.exports = {
    ORIGENES,
    registrosDir,
    excelRelPath,
    isFecha,
    ayer,
    rangeDays,
    loadLiveData,
    snapshotFrom,
    reviveSnapshot,
    mergeSnapshots,
    chooseSource,
    loadReport,
    cerrarJornada,
    listarJornadas,
    excelDeJornada,
    depurarRegistros,
    programarCierre
};
