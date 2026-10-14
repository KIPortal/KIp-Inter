/**
 * Conversación del ticket (pestaña "Conversación" del detalle).
 *
 * Arma el hilo que ve la vista a partir de:
 * - el correo que abrió el ticket (Ticket.descripcion, remitente y adjuntos sin mensaje),
 * - los mensajes guardados (correos recibidos, respuestas del operador y notas internas),
 * - los eventos de auditoría que cambian el estado (tomado, asignado, en espera...).
 *
 * Funciones puras: sin base de datos ni envío de correo.
 */
const { UTC_OFFSET_HOURS } = require('./metricsService');
const { atiendeTickets } = require('./roleService');

const MAX_TEXTO = 5000;
const MAX_ADJUNTOS = 5;
const MAX_BYTES_CORREO = 3 * 1024 * 1024; // límite de adjuntos en línea de Graph sendMail

const TIPOS = { SALIENTE: 'SALIENTE', NOTA: 'NOTA', out: 'SALIENTE', note: 'NOTA' };
const KIND = { ENTRANTE: 'in', SALIENTE: 'out', NOTA: 'note' };

// Estados desde los que "Enviar y esperar respuesta" pasa el ticket a Espera de terceros
const ESPERA_DESDE = ['EN_PROGRESO', 'EN_PAUSA'];

const PLANTILLAS_RESPUESTA = Object.freeze([
    ['Acuse de recibo', 'Buenos días. Recibimos su reporte y ya lo estamos revisando. Le avisaremos en cuanto tengamos novedades.'],
    ['Pedir información', 'Para avanzar necesitamos: dirección exacta, nombre de contacto y una foto de los equipos (luces de la ONT).'],
    ['Solución', 'Le informamos que el servicio quedó restablecido. Por favor confirme que todo funciona correctamente.']
]);

const ORIGEN_META = { CORREO: 'Correo recibido', LLAMADA: 'Llamada registrada', JEFATURA: 'Instrucción de jefatura', COORDINADOR: 'Creado por el coordinador' };

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const HOUR_MS = 3600 * 1000;

function caracas(date) {
    const d = new Date(new Date(date).getTime() + UTC_OFFSET_HOURS * HOUR_MS);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}

/** "Hoy 11:41", "Ayer 09:05" o "13 oct 16:20" (hora de Caracas). */
function formatHora(date, now = new Date()) {
    if (!date || Number.isNaN(new Date(date).getTime())) return '';
    const c = caracas(date);
    const hora = String(c.hh).padStart(2, '0') + ':' + String(c.mm).padStart(2, '0');
    const hoy = caracas(now);
    const ayer = caracas(new Date(now).getTime() - 24 * HOUR_MS);
    const same = (a, b) => a.y === b.y && a.m === b.m && a.d === b.d;
    if (same(c, hoy)) return 'Hoy ' + hora;
    if (same(c, ayer)) return 'Ayer ' + hora;
    return c.d + ' ' + MESES[c.m] + (c.y !== hoy.y ? ' ' + c.y : '') + ' ' + hora;
}

/** Primer correo válido dentro de un texto ("Nombre <a@b.com>" → "a@b.com"). */
function extraerCorreo(texto) {
    const m = String(texto || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    return m ? m[0] : null;
}

/** Texto plano de un correo de Graph (cuerpo HTML o texto; si falta, la vista previa). */
function textoDeCorreo(message) {
    const body = message && message.body;
    let texto = body && typeof body.content === 'string' ? body.content : '';
    if (texto && String(body.contentType).toLowerCase() === 'html') {
        texto = texto
            .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    }
    texto = texto.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!texto) texto = String((message && message.bodyPreview) || '').trim();
    return texto.slice(0, 20000);
}

/** Asunto de la respuesta: lleva el código para que la respuesta del cliente vuelva al mismo ticket. */
function asuntoRespuesta(ticket) {
    const asunto = String(ticket.asunto || '').replace(/^\s*(re|rv|fw|fwd)\s*:\s*/i, '');
    return 'Re: [' + ticket.codigo_incidencia + '] ' + asunto;
}

/**
 * Valida lo que envía el operador. Devuelve { error } o { tipo, texto, esperar }.
 */
function validarMensaje(body = {}) {
    const tipo = TIPOS[body.tipo];
    if (!tipo) return { error: 'Tipo de mensaje no válido' };
    const texto = typeof body.texto === 'string' ? body.texto.trim() : '';
    if (!texto) return { error: 'Escribe el mensaje' };
    if (texto.length > MAX_TEXTO) return { error: `El mensaje no puede pasar de ${MAX_TEXTO} caracteres` };
    const esperar = body.esperar === true || body.esperar === 'true' || body.esperar === '1';
    if (esperar && tipo !== 'SALIENTE') return { error: 'Solo una respuesta al cliente puede dejar el ticket en espera' };
    return { tipo, texto, esperar };
}

/** Valida los adjuntos subidos (cantidad y, si van por correo, peso total). */
function validarAdjuntos(files = [], tipo) {
    if (files.length > MAX_ADJUNTOS) return `Máximo ${MAX_ADJUNTOS} adjuntos por mensaje`;
    if (tipo === 'SALIENTE') {
        const total = files.reduce((s, f) => s + (f.size || 0), 0);
        if (total > MAX_BYTES_CORREO) return 'Los adjuntos de un correo no pueden pasar de 3 MB en total';
    }
    return null;
}

/** El operador ve el ticket si es suyo o si está sin tomar en su área (o en la general). */
function puedeVer(ticket, user) {
    if (!ticket || !user) return false;
    if (user.rol === 'COORDINADOR') return true;
    if (ticket.asignado_a_id === user.id) return true;
    const area = user.area_designada || 'GENERAL';
    return ticket.asignado_a_id == null && ticket.estado_actual === 'NUEVO'
        && (ticket.area_designada === 'GENERAL' || ticket.area_designada === area);
}

/** Por qué no puede escribir (null = sí puede). */
function motivoNoEscribir(ticket, user) {
    if (ticket.estado_actual === 'CERRADO') return 'Ticket cerrado: la conversación queda como registro';
    if (!atiendeTickets(user)) return 'Solo el operador asignado responde desde aquí';
    if (ticket.asignado_a_id == null) return 'Toma el ticket para responder o dejar notas';
    if (ticket.asignado_a_id !== user.id) return 'Solo el operador asignado puede responder';
    return null;
}

/** Evento de auditoría → línea de sistema en el hilo (null si no se muestra). */
function eventoSistema(log) {
    const quien = (log.user && log.user.nombre) || null;
    const det = String(log.detalles || '');
    switch (log.accion) {
        case 'TICKET_TOMADO': return 'Tomado por ' + (quien || 'el operador');
        case 'TICKET_ASIGNADO': return 'Asignado ' + (det.replace(/\s*\(.*\)\s*$/, '').replace(/^A /, 'a ') || '');
        case 'TICKET_REASIGNADO': return 'Reasignado ' + det.replace(/\s*\(.*\)\s*$/, '').replace(/^De /, 'de ');
        case 'TICKET_DESASIGNADO': return 'Volvió a la cola';
        case 'TICKET_PAUSADO': return 'En pausa';
        case 'TICKET_EN_ESPERA': return 'Pasó a Espera de terceros';
        case 'TICKET_REANUDADO': return det.startsWith('Respondió el cliente') ? 'Respondió el cliente: vuelve a En atención' : 'Reanudado';
        case 'TICKET_RESUELTO': return 'Resuelto' + (quien ? ' por ' + quien : '');
        case 'TICKET_CERRADO': return 'Cerrado' + (quien ? ' por ' + quien : '');
        case 'TICKET_TRASPASADO_GUARDIA': return 'Traspasado a la guardia';
        default: return null;
    }
}

const adjuntosVista = (lista) => (lista || []).map(a => ({
    nombre: a.nombre_original,
    // Solo rutas propias (public/uploads); cualquier otra no se enlaza
    url: typeof a.ruta === 'string' && a.ruta.startsWith('/uploads/') ? a.ruta : null,
    peso: a.peso || null
}));

/**
 * Arma la conversación para la vista.
 * @param {object} p
 * @param {object} p.ticket   con adjuntos, asignado_a y creado_por
 * @param {Array}  p.mensajes con autor y adjuntos
 * @param {Array}  p.logs     auditoría del ticket con user
 * @param {object} p.viewer   usuario que mira (id, rol, area_designada)
 */
function buildConversation({ ticket, mensajes = [], logs = [], viewer, now = new Date() }) {
    const items = [];
    const inicial = {
        id: 'inicio', k: 'in',
        quien: ticket.remitente || (ticket.creado_por && ticket.creado_por.nombre) || 'Cliente',
        meta: ORIGEN_META[ticket.origen_ingesta] || 'Correo recibido',
        texto: ticket.descripcion || 'Sin descripción.',
        adjuntos: adjuntosVista((ticket.adjuntos || []).filter(a => !a.mensajeId)),
        fecha: new Date(ticket.createdAt)
    };
    items.push(inicial);

    mensajes.forEach(m => {
        const k = KIND[m.tipo];
        if (!k) return;
        const mio = viewer && m.autor_id && m.autor_id === viewer.id;
        let meta = k === 'in' ? 'Correo recibido' : k === 'note' ? 'Nota interna · solo el equipo' : 'Correo enviado';
        if (k === 'out' && !m.enviado) meta = 'Correo no enviado · falta configurar el envío';
        items.push({
            id: m.id, k,
            quien: k === 'in' ? (m.de || ticket.remitente || 'Cliente') : (mio ? 'Tú' : ((m.autor && m.autor.nombre) || 'Operador')),
            meta, para: k === 'out' ? (m.para || null) : null,
            texto: m.texto, adjuntos: adjuntosVista(m.adjuntos), fecha: new Date(m.createdAt)
        });
    });

    logs.forEach(l => {
        const texto = eventoSistema(l);
        if (texto) items.push({ id: 'log-' + (l.id || items.length), k: 'sys', texto, fecha: new Date(l.createdAt) });
    });

    // Orden por fecha; el correo inicial siempre primero
    const resto = items.slice(1).sort((a, b) => a.fecha - b.fecha);
    const hilo = [inicial].concat(resto).map(it => ({ ...it, hora: formatHora(it.fecha, now), fecha: it.fecha.toISOString() }));

    const motivo = motivoNoEscribir(ticket, viewer);
    const esperando = ticket.estado_actual === 'EN_ESPERA_TERCEROS';
    const ultimoOut = hilo.filter(i => i.k === 'out').slice(-1)[0];
    const para = extraerCorreo(ticket.remitente);

    return {
        codigo: ticket.codigo_incidencia,
        estado: ticket.estado_actual,
        total: hilo.filter(i => i.k !== 'sys').length,
        items: hilo,
        puedeEscribir: !motivo,
        motivoNoEscribir: motivo,
        puedeEsperar: !motivo && ESPERA_DESDE.includes(ticket.estado_actual),
        esperando,
        esperaTexto: esperando
            ? 'Esperando respuesta del cliente' + (ultimoOut ? ' desde ' + ultimoOut.hora.replace(/^Hoy /, '') : '') + '. Al llegar su correo, el ticket vuelve a En atención.'
            : null,
        para,
        asunto: asuntoRespuesta(ticket),
        plantillas: PLANTILLAS_RESPUESTA.map(([etiqueta, texto]) => ({ etiqueta, texto })),
        limites: { texto: MAX_TEXTO, adjuntos: MAX_ADJUNTOS }
    };
}

module.exports = {
    MAX_TEXTO,
    MAX_ADJUNTOS,
    MAX_BYTES_CORREO,
    ESPERA_DESDE,
    PLANTILLAS_RESPUESTA,
    formatHora,
    extraerCorreo,
    textoDeCorreo,
    asuntoRespuesta,
    validarMensaje,
    validarAdjuntos,
    puedeVer,
    motivoNoEscribir,
    eventoSistema,
    buildConversation
};
