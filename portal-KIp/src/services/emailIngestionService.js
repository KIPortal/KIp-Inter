const { ClientSecretCredential } = require('@azure/identity');
const { Client } = require('@microsoft/microsoft-graph-client');
const { TokenCredentialAuthenticationProvider } = require('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials');
const cron = require('node-cron');
const prisma = require('../config/prisma');
const { getNextTicketCode } = require('./ticketCodeService');
const { textoDeCorreo, extraerCorreo } = require('./conversationService');

// Estas variables deben ir en el archivo .env
const TENANT_ID = process.env.GRAPH_TENANT_ID;
const CLIENT_ID = process.env.GRAPH_CLIENT_ID;
const CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET;
const NOC_MAILBOX = process.env.GRAPH_NOC_MAILBOX; // Correo que vamos a leer (ej. noc@tuempresa.com)

let graphClient;

function getGraphClient() {
    if (!graphClient) {
        if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
            console.warn("⚠️ Faltan credenciales de Graph API. La ingesta de correos está deshabilitada.");
            return null;
        }

        const credential = new ClientSecretCredential(TENANT_ID, CLIENT_ID, CLIENT_SECRET);
        const authProvider = new TokenCredentialAuthenticationProvider(credential, {
            scopes: ['https://graph.microsoft.com/.default']
        });

        graphClient = Client.initWithMiddleware({ authProvider });
    }
    return graphClient;
}

/**
 * Función encargada de leer correos no leídos y transformarlos en tickets
 */
async function procesarCorreosEntrantes() {
    const client = getGraphClient();
    if (!client || !NOC_MAILBOX) return;

    try {
        // Obtenemos los últimos 10 correos no leídos
        const messages = await client
            .api(`/users/${NOC_MAILBOX}/mailFolders/inbox/messages`)
            .filter('isRead eq false')
            .top(10)
            .select('id,subject,body,bodyPreview,from,receivedDateTime')
            .get();

        if (!messages.value || messages.value.length === 0) {
            return; // No hay correos nuevos
        }

        for (const message of messages.value) {
            console.log(`[Graph API] Procesando correo: ${message.subject}`);

            // 1. Extraer o generar el Código de Incidencia
            // Lógica básica: Buscar si en el asunto ya hay un "INC-XXX"
            const match = message.subject.match(/INC-\d+/i);
            let codigoIncidencia = match ? match[0].toUpperCase() : null;

            if (!codigoIncidencia) {
                codigoIncidencia = await getNextTicketCode(prisma);
            }

            // 2. Insertar, o sumar el correo a la conversación si el ticket ya existe
            const existe = await prisma.ticket.findUnique({ where: { codigo_incidencia: codigoIncidencia } });
            if (existe && !existe.eliminado_en) {
                await registrarRespuestaCliente(existe, message);
            } else if (!existe) {
                await prisma.ticket.create({
                    data: {
                        codigo_incidencia: codigoIncidencia,
                        asunto: message.subject,
                        descripcion: message.bodyPreview,
                        origen_ingesta: 'CORREO',
                        remitente: message.from.emailAddress.address,
                        estado_actual: 'NUEVO',
                        area_designada: 'GENERAL'
                    }
                });
            }

            // 3. Marcar correo como leído
            await client
                .api(`/users/${NOC_MAILBOX}/messages/${message.id}`)
                .patch({ isRead: true });
        }

    } catch (error) {
        console.error('❌ Error al procesar correos desde Graph API:', error.message);
    }
}

/**
 * Correo del cliente sobre un ticket que ya existe: queda en la conversación y,
 * si el ticket esperaba su respuesta, vuelve a En atención.
 */
async function registrarRespuestaCliente(ticket, message, db = prisma) {
    const de = message.from && message.from.emailAddress ? message.from.emailAddress.address : null;
    await db.mensaje.create({
        data: {
            ticketId: ticket.id,
            tipo: 'ENTRANTE',
            texto: textoDeCorreo(message) || '(Correo sin texto)',
            de: de ? String(de).slice(0, 180) : null,
            ...(message.receivedDateTime ? { createdAt: new Date(message.receivedDateTime) } : {})
        }
    });
    if (ticket.estado_actual !== 'EN_ESPERA_TERCEROS') return false;
    const result = await db.ticket.updateMany({
        where: { id: ticket.id, estado_actual: 'EN_ESPERA_TERCEROS' },
        data: { estado_actual: 'EN_PROGRESO' }
    });
    if (result.count === 1) {
        await db.auditLog.create({
            data: { accion: 'TICKET_REANUDADO', ticketId: ticket.id, userId: null, detalles: 'Respondió el cliente' + (de ? ` (${de})` : '') }
        });
    }
    return result.count === 1;
}

/**
 * Envía la respuesta del operador desde el buzón compartido.
 * Devuelve { enviado: true } o { enviado: false, configurado: false } si falta configurar Graph.
 * Si Graph está configurado y falla, lanza el error.
 */
async function enviarCorreo({ para, asunto, texto, adjuntos = [] }) {
    const client = getGraphClient();
    if (!client || !NOC_MAILBOX) return { enviado: false, configurado: false };
    const destino = extraerCorreo(para);
    if (!destino) throw new Error('Destinatario no válido');
    await client.api(`/users/${NOC_MAILBOX}/sendMail`).post({
        message: {
            subject: asunto,
            body: { contentType: 'Text', content: texto },
            toRecipients: [{ emailAddress: { address: destino } }],
            attachments: adjuntos.map(a => ({
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: a.nombre,
                contentType: a.mimetype || 'application/octet-stream',
                contentBytes: a.contenido.toString('base64')
            }))
        },
        saveToSentItems: true
    });
    return { enviado: true, configurado: true };
}

/**
 * Inicializa el Cron Job que se ejecutará cada 2 minutos
 */
function iniciarIngesta() {
    console.log('✅ Servicio de Ingesta Automática (Graph API) preparado.');
    
    // Ejecutar cada 2 minutos: '*/2 * * * *'
    cron.schedule('*/2 * * * *', async () => {
        await procesarCorreosEntrantes();
    });
}

module.exports = {
    iniciarIngesta,
    procesarCorreosEntrantes,
    registrarRespuestaCliente,
    enviarCorreo
};
