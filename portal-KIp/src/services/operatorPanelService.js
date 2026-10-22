'use strict';

/**
 * Panel del operador (IMPLEMENTACION.md §3.6, prototipo Operador.dc.html).
 * Funciones puras: reciben los tickets ya cargados y devuelven lo que dibuja
 * la vista. Sin base de datos (ver scripts/test-operador.js).
 *
 * El operador nunca ve la sobrecarga ni el promedio del área: solo su carga.
 */

const { getDayBounds, getClosingDate, UTC_OFFSET_HOURS } = require('./metricsService');
const { AREA_NAMES, subgrupoName } = require('./areaCatalog');
const { DEFAULT_RULES, prioridadDe } = require('./rulesService');
const { tipoCasoDeTicket } = require('./tipoCasoService');
const { fotoUrl } = require('./profileService');
const { DEFAULT_SCHEDULE, GUARDIA_WEEKDAY, GUARDIA_WEEKEND, caracasClock } = require('./shiftService');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const ORIGIN_NAMES = { CORREO: 'Correo', LLAMADA: 'Llamada', JEFATURA: 'Jefatura', COORDINADOR: 'Creado por el coordinador' };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const time = value => (value ? new Date(value).getTime() : NaN);
const priorityOf = prioridadDe;
const minutesBetween = (from, now) => {
    const t = time(from);
    return Number.isFinite(t) ? Math.max(0, Math.floor((time(now) - t) / MINUTE_MS)) : 0;
};
const pad = n => String(n).padStart(2, '0');
const hhmm = minutes => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
const toMin = s => (s === '24:00' ? 1440 : Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)));

/** "45 min" · "1 h 05" */
function formatMinutes(m) {
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${pad(m % 60)}`;
}
/** Umbral legible: "30 min" · "2 h" */
function formatLimit(m) {
    return m < 60 ? `${m} min` : `${(m / 60).toString().replace('.', ',')} h`;
}
/** "Hoy 09:12" · "13 oct 17:40" (hora de Caracas). */
function formatWhen(value, now) {
    const t = time(value);
    if (!Number.isFinite(t)) return '';
    const local = new Date(t + UTC_OFFSET_HOURS * HOUR_MS);
    const hora = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
    if (t >= getDayBounds(now).start.getTime()) return `Hoy ${hora}`;
    return `${local.getUTCDate()} ${MESES[local.getUTCMonth()]} ${hora}`;
}
function horaCaracas(value) {
    const local = new Date(time(value) + UTC_OFFSET_HOURS * HOUR_MS);
    return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

function saludo(nombre, now) {
    const h = Math.floor(caracasClock(now).minutes / 60);
    const parte = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
    const primero = String(nombre || '').trim().split(/\s+/)[0];
    return primero ? `${parte}, ${primero}` : parte;
}

function initials(nombre) {
    return String(nombre || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';
}

/**
 * Ventana del turno que toca mostrar hoy en el reloj.
 * De guardia: la ventana de guardia (17–24 entre semana, 8–24 en fin de semana)
 * salvo que todavía esté en su turno normal.
 */
function shiftWindow({ horario, deGuardia, turno }, now) {
    const schedule = horario && Array.isArray(horario.dias) ? horario : DEFAULT_SCHEDULE;
    const { dow, minutes } = caracasClock(now);
    const normal = { inicio: schedule.inicio, fin: schedule.fin };
    const hoyTrabaja = schedule.dias.includes(dow);
    let ventana = normal;
    let guardia = false;
    if (deGuardia) {
        const weekend = dow === 0 || dow === 6;
        const g = weekend ? GUARDIA_WEEKEND : GUARDIA_WEEKDAY;
        const enNormal = hoyTrabaja && minutes >= toMin(normal.inicio) && minutes < toMin(normal.fin);
        if (!enNormal) { ventana = g; guardia = true; }
    }
    const inicio = toMin(ventana.inicio);
    const fin = toMin(ventana.fin);
    const codigo = turno?.codigo || 'FUERA_DE_TURNO';
    const dur = m => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${pad(m % 60)} min`);
    let resto;
    if (codigo === 'AUSENTE') resto = 'Marcado como ausente';
    else if (!guardia && !hoyTrabaja) resto = 'Hoy no tienes turno';
    else if (minutes < inicio) resto = `Empieza en ${dur(inicio - minutes)}`;
    else if (minutes >= fin) resto = 'Jornada terminada';
    else resto = (codigo === 'EN_CASA_GUARDIA' ? 'Desde casa · faltan ' : 'Faltan ') + dur(fin - minutes);

    const TONO = {
        EN_TURNO: 'green', DE_GUARDIA: 'purple', EN_CASA_GUARDIA: 'purple', FUERA_DE_TURNO: 'gray', AUSENTE: 'gray'
    };
    return {
        codigo,
        estado: turno?.etiqueta || 'Fuera de turno',
        tono: TONO[codigo] || 'gray',
        deGuardia: Boolean(deGuardia),
        inicio, fin,
        horas: `${hhmm(inicio)} – ${ventana.fin === '24:00' ? '24:00' : hhmm(fin)}`,
        corto: `${turno?.etiqueta || 'Fuera de turno'} ${hhmm(inicio)}–${ventana.fin === '24:00' ? '24:00' : hhmm(fin)}`,
        resto
    };
}

const QUEUES = [
    {
        k: 'entrantes', label: 'Entrantes', hint: 'Sin asignar en mi área', title: 'Entrantes de mi área',
        color: '#64748B', glyph: 'M4 13h4l2 3h4l2-3h4M6 5h12l2 8v6H4v-6z', timeH: 'Esperando',
        emptyT: 'No hay tickets entrantes', emptyS: 'Cuando llegue un correo para tu área aparecerá aquí'
    },
    {
        k: 'asignados', label: 'Asignados a mí', hint: 'Por el coordinador, sin empezar', title: 'Asignados a mí',
        desc: 'El coordinador te los asignó. Empiézalos para pasarlos a En atención',
        color: '#8B5CF6', glyph: 'M9 8a3 3 0 1 0 0-.01M3 19a6 6 0 0 1 12 0M18 8v6M15 11h6', timeH: 'Asignado hace',
        emptyT: 'Nada asignado por empezar', emptyS: 'Lo que te asigne el coordinador aparecerá aquí'
    },
    {
        k: 'atencion', label: 'En atención', hint: 'Trabajando ahora', title: 'En atención',
        desc: 'Tickets que estás trabajando',
        color: '#0A84FF', glyph: 'M8 5v14l11-7z', timeH: 'En atención',
        emptyT: 'No tienes tickets en atención', emptyS: 'Toma uno de Entrantes o empieza uno asignado'
    },
    {
        k: 'espera', label: 'En espera', hint: 'Pausa o terceros', title: 'En espera para continuar',
        desc: 'En pausa o esperando a terceros. Reanúdalos cuando puedas seguir',
        color: '#F59E0B', glyph: 'M9 6v12M15 6v12', timeH: 'Detenido',
        emptyT: 'Nada en espera', emptyS: 'Los tickets que pauses aparecerán aquí'
    },
    {
        k: 'resueltos', label: 'Resueltos', hint: 'Hoy · cierre del coordinador', title: 'Resueltos hoy',
        desc: 'Los cierra el coordinador después de revisarlos',
        color: '#22C55E', glyph: 'M5 12l5 5L19 7', timeH: 'Puntos',
        emptyT: 'Aún no hay resueltos hoy', emptyS: 'Lo que resuelvas suma puntos según su nivel de dificultad'
    }
];

const TAGS = {
    EN_PAUSA: ['En pausa', 'orange'],
    EN_ESPERA_TERCEROS: ['Espera de terceros', 'purple'],
    RESUELTO: ['Pendiente de cierre', 'orange'],
    CERRADO: ['Cerrado', 'green']
};

/** P1 primero; luego el más antiguo (más minutos). */
function byUrgency(a, b) {
    return ((b.p === 'P1') - (a.p === 'P1')) || (b.min - a.min) || a.code.localeCompare(b.code);
}

/**
 * Fila de la bandeja. `k` es la cola; `desde` (ISO) permite que la vista
 * actualice el tiempo sin recargar.
 */
function buildRow(ticket, k, { now, myArea, rules, operatorName }) {
    const p = priorityOf(ticket);
    const area = ticket.area_designada || 'GENERAL';
    const tag = TAGS[ticket.estado_actual];
    const base = {
        code: ticket.codigo_incidencia,
        subject: ticket.asunto || 'Sin asunto',
        p,
        pts: ticket.puntos_complejidad || 0,
        sugerida: p === 'SP' ? (ticket.prioridad_sugerida || null) : null,
        ...tipoCasoDeTicket(ticket),
        estado: ticket.estado_actual,
        cola: k,
        area,
        areaNombre: (AREA_NAMES[area] || area) + (subgrupoName(ticket.subgrupo_id) ? ' · ' + subgrupoName(ticket.subgrupo_id) : ''),
        otraArea: area !== myArea,
        tag: tag ? tag[0] : '',
        tagTono: tag ? tag[1] : '',
        meta: '',
        alerta: false,
        // Para el detalle
        desc: ticket.descripcion || '',
        remitente: ticket.remitente || ticket.creado_por?.email || '',
        origen: ORIGIN_NAMES[ticket.origen_ingesta] || 'Correo',
        recibido: formatWhen(ticket.createdAt, now),
        asignado: ticket.asignado_a_id ? `Ti (${operatorName})` : 'Sin asignar'
    };
    if (k === 'entrantes') {
        const min = minutesBetween(ticket.createdAt, now);
        const limite = rules.antiguedad[p];
        const alerta = rules.antiguedad.activa !== false && min > limite;
        return {
            ...base, min, desde: new Date(ticket.createdAt).toISOString(), alerta,
            meta: alerta
                ? (p === 'SP' ? `Sin prioridad más de ${formatLimit(limite)}` : `Sin asignar más de ${formatLimit(limite)}`)
                : (base.remitente ? `De ${base.remitente}` : base.origen)
        };
    }
    if (k === 'asignados' || k === 'atencion') {
        const desde = ticket.fecha_asignacion || ticket.createdAt;
        return {
            ...base, min: minutesBetween(desde, now), desde: new Date(desde).toISOString(),
            meta: k === 'asignados' ? 'Asignado por el coordinador' : (base.remitente ? `De ${base.remitente}` : '')
        };
    }
    if (k === 'espera') {
        // updatedAt es el último cambio del ticket: cuando quedó detenido
        const desde = ticket.updatedAt || ticket.createdAt;
        return { ...base, min: minutesBetween(desde, now), desde: new Date(desde).toISOString(), meta: base.remitente ? `De ${base.remitente}` : '' };
    }
    // resueltos
    const fin = getClosingDate(ticket);
    const meta = ['Resuelto ' + horaCaracas(fin)];
    if (ticket.estado_actual === 'CERRADO' && ticket.fecha_cierre) meta.push('cerrado ' + horaCaracas(ticket.fecha_cierre));
    return { ...base, min: 0, desde: new Date(fin).toISOString(), meta: meta.join(' · ') };
}

/** Avisos dentro del portal que se pueden deducir de las colas (sin tabla propia). */
function buildNotices(colas, rules) {
    const avisos = [];
    colas.entrantes.filter(t => t.p === 'P1').forEach(t => avisos.push({
        tipo: 'p1', titulo: 'P1 nuevo en tu área', detalle: `${t.code} · ${t.subject}`, min: t.min
    }));
    colas.entrantes.filter(t => t.alerta && t.p !== 'P1').forEach(t => avisos.push({
        tipo: 'antiguedad', titulo: 'Antigüedad superada',
        detalle: `${t.code} lleva más de ${formatLimit(rules.antiguedad[t.p])} ${t.p === 'SP' ? 'sin prioridad' : 'sin asignar'}`, min: t.min
    }));
    colas.asignados.forEach(t => avisos.push({
        tipo: 'asignado', titulo: 'Asignado por el coordinador', detalle: `${t.code} · ${t.subject}`, min: t.min
    }));
    return avisos.sort((a, b) => a.min - b.min).slice(0, 12)
        .map(a => ({ ...a, hace: a.min < 1 ? 'ahora' : `hace ${formatMinutes(a.min)}` }));
}

/**
 * @param {object} p
 * @param {object} p.user        { id, nombre, area_designada, estado_operativo }
 * @param {Array}  p.entrantes   NUEVO sin asignar de su área y de GENERAL
 * @param {Array}  p.mios        sus tickets activos (NUEVO, EN_PROGRESO, EN_PAUSA, EN_ESPERA_TERCEROS)
 * @param {Array}  p.resueltos   sus RESUELTO/CERRADO (se filtran los de hoy)
 * @param {object} [p.turno]     resultado de getShiftStatus
 * @param {object} [p.horario]   { dias, inicio, fin }
 * @param {boolean} [p.deGuardia]
 * @param {object} [p.traspaso]  vista de buildHandoffView (vigente) o null
 * @param {Array}  [p.traspasoTickets] tickets del traspaso con asignado_a
 * @param {object} [p.rules]     reglas de rulesService
 * @param {Date}   [p.now]
 */
function buildOperatorPanel({
    user, entrantes = [], mios = [], resueltos = [], turno = null, horario = null, deGuardia = false,
    traspaso = null, traspasoTickets = [], rules = DEFAULT_RULES, now = new Date()
}) {
    const myArea = user.area_designada || 'GENERAL';
    const ctx = { now, myArea, rules, operatorName: user.nombre || 'operador' };
    const hoy = getDayBounds(now).start.getTime();

    const mine = mios.filter(t => t.asignado_a_id === user.id);
    const colas = {
        entrantes: entrantes
            .filter(t => t.estado_actual === 'NUEVO' && !t.asignado_a_id && [myArea, 'GENERAL'].includes(t.area_designada || 'GENERAL'))
            // Con subgrupo (p. ej. FTTx Soporte): los de su subgrupo y los del área sin subgrupo
            .filter(t => !user.subgrupo_id || !t.subgrupo_id || t.subgrupo_id === user.subgrupo_id)
            .map(t => buildRow(t, 'entrantes', ctx)).sort(byUrgency),
        asignados: mine.filter(t => t.estado_actual === 'NUEVO').map(t => buildRow(t, 'asignados', ctx)).sort(byUrgency),
        atencion: mine.filter(t => t.estado_actual === 'EN_PROGRESO').map(t => buildRow(t, 'atencion', ctx)).sort(byUrgency),
        espera: mine.filter(t => ['EN_PAUSA', 'EN_ESPERA_TERCEROS'].includes(t.estado_actual)).map(t => buildRow(t, 'espera', ctx)).sort(byUrgency),
        resueltos: resueltos
            .filter(t => t.asignado_a_id === user.id && ['RESUELTO', 'CERRADO'].includes(t.estado_actual) && time(getClosingDate(t)) >= hoy)
            .map(t => buildRow(t, 'resueltos', ctx))
            .sort((a, b) => time(b.desde) - time(a.desde))
    };

    const areaNombre = AREA_NAMES[myArea] || myArea;
    const colasVista = QUEUES.map(q => ({
        ...q,
        desc: q.k === 'entrantes'
            ? (myArea === 'GENERAL' ? 'Tickets sin asignar de tu área · P1 primero' : `Tickets sin asignar de ${areaNombre} y de ${AREA_NAMES.GENERAL || 'General'} · P1 primero`)
            : q.desc,
        tickets: colas[q.k],
        hayP1: colas[q.k].some(t => t.p === 'P1')
    }));

    const activos = colas.asignados.length + colas.atencion.length + colas.espera.length;
    const mezcla = {
        total: activos,
        segs: [
            { label: 'Asignados', color: '#8B5CF6', n: colas.asignados.length },
            { label: 'En atención', color: '#0A84FF', n: colas.atencion.length },
            { label: 'En espera', color: '#FF9F0A', n: colas.espera.length }
        ].filter(s => s.n > 0)
    };
    const cerrados = colas.resueltos.filter(t => t.estado === 'CERRADO').length;
    const puntosHoy = colas.resueltos.reduce((s, t) => s + (t.pts || 0), 0);

    // Disponibilidad: Disponible/Atendiendo automáticos; Fuera de puesto y Ausente los marca el operador
    const atendiendo = colas.atencion.some(t => t.p === 'P1');
    const disponibilidad = {
        estadoOperativo: user.estado_operativo || 'DISPONIBLE',
        auto: atendiendo ? 'Atendiendo' : 'Disponible',
        atendiendo
    };

    let traspasoVista = null;
    if (deGuardia && traspaso && traspaso.vigente !== false) {
        const porCodigo = new Map(traspasoTickets.map(t => [t.codigo_incidencia, t]));
        traspasoVista = {
            nota: traspaso.nota,
            autor: traspaso.autor,
            hora: formatWhen(traspaso.creadoEn, now),
            filas: (traspaso.pendientes || []).map(code => porCodigo.get(code)).filter(Boolean).map(t => {
                const mio = t.asignado_a_id === user.id;
                const area = t.area_designada || 'GENERAL';
                return {
                    code: t.codigo_incidencia,
                    subject: t.asunto || 'Sin asunto',
                    p: priorityOf(t),
                    pts: t.puntos_complejidad || 0,
                    ...tipoCasoDeTicket(t),
                    area,
                    op: mio ? 'Tuyo' : (t.asignado_a?.nombre || 'Sin asignar'),
                    opTono: mio ? 'green' : (t.asignado_a_id ? 'gray' : 'orange'),
                    puedeTomar: t.estado_actual === 'NUEVO' && !t.asignado_a_id && [myArea, 'GENERAL'].includes(area)
                };
            })
        };
    }

    const colaInicial = colas.asignados.length ? 'asignados' : colas.atencion.length ? 'atencion' : colas.entrantes.length ? 'entrantes' : 'atencion';

    return {
        saludo: saludo(user.nombre, now),
        usuario: { id: user.id, nombre: user.nombre || 'Operador', iniciales: initials(user.nombre), foto: fotoUrl(user.foto), area: myArea, areaNombre: areaNombre + (subgrupoName(user.subgrupo_id) ? ' · ' + subgrupoName(user.subgrupo_id) : '') },
        turno: shiftWindow({ horario, deGuardia, turno }, now),
        disponibilidad,
        puntosHoy,
        mezcla,
        resueltos: { n: colas.resueltos.length, abiertos: colas.resueltos.length - cerrados, cerrados },
        colas: colasVista,
        colaInicial,
        traspaso: traspasoVista,
        avisos: buildNotices(colas, rules),
        reglas: { antiguedad: rules.antiguedad }
    };
}

module.exports = { buildOperatorPanel, buildRow, shiftWindow, formatMinutes, formatWhen, saludo, QUEUES, priorityOf };
