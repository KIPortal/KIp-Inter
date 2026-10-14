/**
 * Conversación del ticket: leer el hilo y escribir (respuesta al cliente o nota interna).
 * Reglas en src/services/conversationService.js.
 */
const fs = require('fs');
const path = require('path');
const prisma = require('../config/prisma');
const { auditUserId } = require('../services/auditViewService');
const conv = require('../services/conversationService');
const mail = require('../services/emailIngestionService');

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');

function getTicketCode(req) {
    return typeof req.params.ticketCode === 'string' ? req.params.ticketCode.trim() : '';
}

function borrarSubidos(files) {
    (files || []).forEach(f => {
        // Solo archivos dentro de public/uploads
        const ruta = path.resolve(f.path || path.join(UPLOADS_DIR, f.filename || ''));
        if (ruta.startsWith(UPLOADS_DIR + path.sep)) fs.promises.unlink(ruta).catch(() => {});
    });
}

async function cargarTicket(ticketCode) {
    const ticket = await prisma.ticket.findUnique({
        where: { codigo_incidencia: ticketCode },
        include: {
            adjuntos: true,
            asignado_a: { select: { id: true, nombre: true } },
            creado_por: { select: { id: true, nombre: true, email: true } }
        }
    });
    return ticket && !ticket.eliminado_en ? ticket : null;
}

async function armarConversacion(ticket, viewer) {
    const [mensajes, logs] = await Promise.all([
        prisma.mensaje.findMany({
            where: { ticketId: ticket.id },
            orderBy: { createdAt: 'asc' },
            take: 500,
            include: { autor: { select: { id: true, nombre: true } }, adjuntos: true }
        }),
        prisma.auditLog.findMany({
            where: { ticketId: ticket.id },
            orderBy: { createdAt: 'asc' },
            take: 200,
            include: { user: { select: { nombre: true } } }
        })
    ]);
    return conv.buildConversation({ ticket, mensajes, logs, viewer, now: new Date() });
}

// GET /api/tickets/:ticketCode/conversacion
async function getConversation(req, res) {
    const ticketCode = getTicketCode(req);
    if (!ticketCode) return res.status(400).json({ success: false, error: 'Falta código de incidencia' });
    try {
        const ticket = await cargarTicket(ticketCode);
        if (!ticket) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });
        if (!conv.puedeVer(ticket, req.user)) return res.status(403).json({ success: false, error: 'No tienes acceso a este ticket' });
        return res.json({ success: true, conversacion: await armarConversacion(ticket, req.user) });
    } catch (error) {
        console.error('Error al leer la conversación:', error);
        return res.status(500).json({ success: false, error: 'No se pudo leer la conversación' });
    }
}

// POST /api/tickets/:ticketCode/mensajes  (multipart: tipo, texto, esperar, adjuntos)
async function postMessage(req, res) {
    const files = Array.isArray(req.files) ? req.files : [];
    const fail = (code, error) => { borrarSubidos(files); return res.status(code).json({ success: false, error }); };

    const ticketCode = getTicketCode(req);
    if (!ticketCode) return fail(400, 'Falta código de incidencia');
    const datos = conv.validarMensaje(req.body || {});
    if (datos.error) return fail(400, datos.error);
    const errorAdjuntos = conv.validarAdjuntos(files, datos.tipo);
    if (errorAdjuntos) return fail(400, errorAdjuntos);

    try {
        const ticket = await cargarTicket(ticketCode);
        if (!ticket) return fail(404, 'Ticket no encontrado');
        const motivo = conv.motivoNoEscribir(ticket, req.user);
        if (motivo) return fail(403, motivo);
        if (datos.esperar && !conv.ESPERA_DESDE.includes(ticket.estado_actual)) {
            return fail(409, 'Empieza el ticket antes de dejarlo en espera de respuesta');
        }

        let para = null, enviado = false, aviso = null;
        if (datos.tipo === 'SALIENTE') {
            para = conv.extraerCorreo(ticket.remitente);
            if (!para) return fail(400, 'El ticket no tiene un correo de cliente. Deja una nota interna');
            try {
                const adjuntos = await Promise.all(files.map(async f => ({
                    nombre: f.originalname, mimetype: f.mimetype, contenido: await fs.promises.readFile(f.path)
                })));
                const r = await mail.enviarCorreo({ para, asunto: conv.asuntoRespuesta(ticket), texto: datos.texto, adjuntos });
                enviado = r.enviado;
                if (!r.configurado) aviso = 'Guardado sin enviar: falta configurar el envío de correo';
            } catch (error) {
                console.error('Error al enviar correo:', error.message);
                return fail(502, 'No se pudo enviar el correo. Inténtalo de nuevo');
            }
        }

        const mensaje = await prisma.mensaje.create({
            data: {
                ticketId: ticket.id,
                tipo: datos.tipo,
                texto: datos.texto,
                autor_id: req.user.id,
                para,
                enviado,
                adjuntos: files.length ? {
                    create: files.map(f => ({
                        ticketId: ticket.id,
                        nombre_original: String(f.originalname || 'archivo').slice(0, 255),
                        nombre_archivo: f.filename,
                        ruta: '/uploads/' + f.filename,
                        mimetype: f.mimetype || null,
                        peso: f.size || null
                    }))
                } : undefined
            }
        });

        if (datos.esperar) {
            const result = await prisma.ticket.updateMany({
                where: { id: ticket.id, asignado_a_id: req.user.id, estado_actual: { in: conv.ESPERA_DESDE } },
                data: { estado_actual: 'EN_ESPERA_TERCEROS' }
            });
            if (result.count === 1) {
                await prisma.auditLog.create({
                    data: { accion: 'TICKET_EN_ESPERA', ticketId: ticket.id, userId: auditUserId(req), detalles: `Estado: ${ticket.estado_actual} → EN_ESPERA_TERCEROS. Esperando respuesta del cliente` }
                }).catch(error => console.error('No se pudo registrar auditoría:', error.message));
                ticket.estado_actual = 'EN_ESPERA_TERCEROS';
            }
        }

        return res.json({ success: true, mensajeId: mensaje.id, enviado, aviso, estado: ticket.estado_actual, conversacion: await armarConversacion(ticket, req.user) });
    } catch (error) {
        console.error('Error al guardar mensaje:', error);
        borrarSubidos(files);
        return res.status(500).json({ success: false, error: 'No se pudo guardar el mensaje' });
    }
}

module.exports = { getConversation, postMessage };
