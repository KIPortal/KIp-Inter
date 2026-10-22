const { ClientSecretCredential } = require('@azure/identity');
const { Client } = require('@microsoft/microsoft-graph-client');
const { TokenCredentialAuthenticationProvider } = require('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials');
const prisma = require('../config/prisma');
const { getNextTicketCode } = require('./ticketCodeService');
const { textoDeCorreo, extraerCorreo, quitarCitado } = require('./conversationService');
const { loadConfig } = require('./configService');
const { sugerirPrioridad } = require('./rulesService');
const graphAuth = require('./graphAuthService');
const graphWebhook = require('./graphWebhookService');
const enVivo = require('./liveUpdatesService');

// Estas variables deben ir en el archivo .env
const TENANT_ID = process.env.GRAPH_TENANT_ID;
const CLIENT_ID = process.env.GRAPH_CLIENT_ID;
const CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET;

let graphClient;

// Correos por consulta; si llega el lote completo se pide el siguiente sin esperar (hasta LOTES_POR_VUELTA)
const LOTE = 25;
const LOTES_POR_VUELTA = 4;

/** Segundos entre revisiones del buzón (GRAPH_INTERVALO_SEGUNDOS, 30 por defecto, mínimo 10). */
function intervaloSegundos(env = process.env) {
    const n = parseInt(env.GRAPH_INTERVALO_SEGUNDOS, 10);
    return Number.isFinite(n) ? Math.max(10, n) : 30;
}

// El aviso de credenciales faltantes se imprime una sola vez, no en cada revisión
let avisoDado = false;
function avisarUnaVez(texto) {
    if (avisoDado) return;
    avisoDado = true;
    console.warn(texto);
}

function getGraphClient() {
    if (!graphClient && graphAuth.modo() === 'delegado') {
        // Modo de prueba: token de la persona que inició sesión con scripts/graph-login.js
        if (!process.env.GRAPH_CLIENT_ID) {
            avisarUnaVez("⚠️ Falta GRAPH_CLIENT_ID. La ingesta de correos está deshabilitada.");
            return null;
        }
        const pca = graphAuth.crearClientePublico();
        graphClient = Client.init({
            authProvider: (done) => graphAuth.tokenDelegado(pca).then(t => done(null, t), e => done(e, null))
        });
    }
    if (!graphClient) {
        if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
            avisarUnaVez("⚠️ Faltan credenciales de Graph API. La ingesta de correos está deshabilitada.");
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

/** Solo lectura, primera vez: se toman los correos que lleguen desde ahora (no se importa lo viejo). */
function marcarInicioLectura() {
    graphAuth.guardarEstado({ desde: new Date().toISOString(), ids: [] });
    console.log('[Graph API] Solo lectura: se tomarán los correos que lleguen desde ahora.');
}

// Intentos por correo antes de dejarlo atrás (en memoria: se reinicia al reiniciar el portal)
const MAX_INTENTOS = 3;
const fallos = new Map();

// Si la base no responde, el correo no tiene la culpa: se reintenta sin contar el intento
const esDeConexion = e => /^P10\d\d$/.test(String(e?.code || '')) || e?.name === 'PrismaClientInitializationError';

const ASUNTO_VACIO = '(sin asunto)';
const codigoEnAsunto = message => {
    const match = String(message.subject || '').match(/INC-\d+/i);
    return match ? match[0].toUpperCase() : null;
};

/** Convierte un correo en ticket nuevo, o lo suma a la conversación del ticket que nombra (INC-xxx). */
async function procesarCorreo(message, cargarReglas) {
    const asunto = String(message.subject || '').trim() || ASUNTO_VACIO;
    const remitente = message.from?.emailAddress?.address || null;
    console.log(`[Graph API] Procesando correo: ${asunto}`);

    // 1. Código de incidencia: el que venga en el asunto ("INC-XXX") o uno nuevo
    const codigoIncidencia = codigoEnAsunto(message) || await getNextTicketCode(prisma);

    // 2. Insertar, o sumar el correo a la conversación si el ticket ya existe
    const existe = await prisma.ticket.findUnique({ where: { codigo_incidencia: codigoIncidencia } });
    if (existe && !existe.eliminado_en) {
        // Si lo escribió alguien del portal (respondió desde su correo con el buzón en copia),
        // es una respuesta enviada; si no, es el cliente
        const autor = await autorDelPortal(message);
        if (autor) await registrarRespuestaOperador(existe, message, autor);
        else await registrarRespuestaCliente(existe, message);
    } else if (!existe) {
        // Prioridad sugerida por palabras clave (Administración → Reglas); el operador la confirma al tomarlo
        const reglas = await cargarReglas();
        const sugerida = sugerirPrioridad(`${message.subject || ''} ${message.bodyPreview || ''} ${remitente || ''}`, reglas || undefined);
        await prisma.ticket.create({
            data: {
                codigo_incidencia: codigoIncidencia,
                asunto,
                descripcion: message.bodyPreview,
                origen_ingesta: 'CORREO',
                remitente,
                estado_actual: 'NUEVO',
                area_designada: 'GENERAL',
                prioridad_sugerida: sugerida
            }
        });
    }
}

/**
 * Lee un lote de correos nuevos y los convierte en tickets. Devuelve cuántos correos trajo la consulta.
 */
async function procesarCorreosEntrantes() {
    const client = getGraphClient();
    const buzon = graphAuth.rutaBuzon();
    if (!client || !buzon) return 0;

    const soloLectura = graphAuth.soloLectura();
    try {
        let consulta = client.api(`${buzon}/mailFolders/inbox/messages`);
        let estado = null;
        if (soloLectura) {
            // Solo lectura: no se marca nada en el buzón; se recuerda hasta qué correo se leyó
            estado = graphAuth.leerEstado();
            if (!estado) { marcarInicioLectura(); return 0; }
            consulta = consulta.filter(`receivedDateTime ge ${estado.desde}`).orderby('receivedDateTime asc');
        } else {
            consulta = consulta.filter('isRead eq false');
        }
        const messages = await consulta
            .top(LOTE)
            .select('id,subject,body,bodyPreview,from,toRecipients,receivedDateTime')
            .get();

        if (!messages.value || messages.value.length === 0) {
            return 0; // No hay correos nuevos
        }
        // Las reglas de prioridad se cargan una vez por lote, no por correo
        let reglas;
        const cargarReglas = async () => {
            if (reglas === undefined) reglas = (await loadConfig(prisma).catch(() => null))?.reglas || null;
            return reglas;
        };
        let detenido = false; // un correo falló y se reintenta en la próxima vuelta

        for (const message of messages.value) {
            if (soloLectura && estado.ids.includes(message.id)) continue; // ya procesado
            try {
                await procesarCorreo(message, cargarReglas);
                fallos.delete(message.id);
            } catch (error) {
                if (esDeConexion(error)) {
                    console.error('❌ [Graph API] La base de datos no responde; se reintenta en la próxima vuelta:', error.message);
                    detenido = true;
                    break;
                }
                // Un correo que falla no traba a los demás: se reintenta en las próximas vueltas
                // y, si sigue fallando, se deja atrás (queda en el registro) para que entren los siguientes
                const intentos = (fallos.get(message.id) || 0) + 1;
                if (intentos < MAX_INTENTOS) {
                    fallos.set(message.id, intentos);
                    console.error(`❌ [Graph API] No se pudo procesar "${message.subject || ASUNTO_VACIO}" (intento ${intentos} de ${MAX_INTENTOS}):`, error.message);
                    detenido = true;
                    break;
                }
                fallos.delete(message.id);
                console.error(`❌ [Graph API] Se omite "${message.subject || ASUNTO_VACIO}" (${message.id}) tras ${MAX_INTENTOS} intentos:`, error.message);
            }

            // Que no se vuelva a procesar: avanzar la marca (solo lectura) o marcarlo como leído
            if (soloLectura) {
                estado = graphAuth.avanzarEstado(estado, message);
                graphAuth.guardarEstado(estado);
            } else {
                await client
                    .api(`${buzon}/messages/${message.id}`)
                    .patch({ isRead: true });
            }
        }
        // Las pantallas abiertas se enteran ya, sin esperar su próxima revisión
        enVivo.avisar();
        // Si un correo se detuvo para reintentarlo, la vuelta termina aquí
        return detenido ? 0 : messages.value.length;

    } catch (error) {
        console.error('❌ Error al procesar correos desde Graph API:', error.message);
        return 0;
    }
}

let revisando = false;

/** Una vuelta: lotes seguidos mientras vengan llenos. Si la anterior sigue en curso, no se encima. */
async function revisarBuzon() {
    if (revisando) return;
    revisando = true;
    try {
        for (let i = 0; i < LOTES_POR_VUELTA; i++) {
            if (await procesarCorreosEntrantes() < LOTE) break;
        }
    } finally {
        revisando = false;
    }
}

/** Usuario del portal que envió el correo (por su dirección), o null si es un cliente. */
async function autorDelPortal(message, db = prisma) {
    const de = extraerCorreo(message && message.from && message.from.emailAddress && message.from.emailAddress.address);
    if (!de) return null;
    return db.user.findFirst({ where: { email: { equals: de, mode: 'insensitive' } }, select: { id: true, nombre: true, email: true } });
}

/**
 * Respuesta que un operador mandó desde su propio correo (Outlook, etc.) con el
 * buzón del NOC en copia: queda en la conversación como correo enviado, sin el
 * historial citado. No cambia el estado del ticket.
 */
async function registrarRespuestaOperador(ticket, message, autor, db = prisma) {
    const para = (message.toRecipients || []).map(r => r && r.emailAddress && r.emailAddress.address).filter(Boolean)[0] || null;
    await db.mensaje.create({
        data: {
            ticketId: ticket.id,
            tipo: 'SALIENTE',
            texto: quitarCitado(textoDeCorreo(message)) || '(Correo sin texto)',
            autor_id: autor.id,
            de: String(autor.email || '').slice(0, 180) || null,
            para: para ? String(para).slice(0, 180) : null,
            enviado: true,
            ...(message.receivedDateTime ? { createdAt: new Date(message.receivedDateTime) } : {})
        }
    });
    return true;
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
            texto: quitarCitado(textoDeCorreo(message)) || '(Correo sin texto)',
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
    if (graphAuth.soloLectura()) return { enviado: false, configurado: false, soloLectura: true };
    const client = getGraphClient();
    const buzon = graphAuth.rutaBuzon();
    if (!client || !buzon) return { enviado: false, configurado: false };
    const destino = extraerCorreo(para);
    if (!destino) throw new Error('Destinatario no válido');
    await client.api(`${buzon}/sendMail`).post({
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
 * Revisa el buzón al arrancar y luego cada GRAPH_INTERVALO_SEGUNDOS (30 s por defecto)
 */
function iniciarIngesta() {
    // Sin credenciales no se programa nada (el aviso ya salió una vez)
    if (!getGraphClient()) return;
    const cada = intervaloSegundos();
    console.log(`✅ Servicio de Ingesta Automática (Graph API) preparado (modo ${graphAuth.modo()}${graphAuth.soloLectura() ? ', solo lectura' : ''}, cada ${cada} s).`);

    if (graphAuth.soloLectura() && !graphAuth.leerEstado()) marcarInicioLectura();

    revisarBuzon();
    setInterval(revisarBuzon, cada * 1000);
}

/** Con el portal ya escuchando: aviso inmediato de Microsoft si GRAPH_WEBHOOK_URL está configurado. */
function activarAvisoInmediato() {
    if (!String(process.env.GRAPH_WEBHOOK_URL || '').trim()) return Promise.resolve(null);
    return graphWebhook.iniciar({ client: getGraphClient(), rutaBuzon: graphAuth.rutaBuzon(), revisar: revisarBuzon });
}

module.exports = {
    iniciarIngesta,
    procesarCorreosEntrantes,
    revisarBuzon,
    activarAvisoInmediato,
    intervaloSegundos,
    registrarRespuestaCliente,
    registrarRespuestaOperador,
    autorDelPortal,
    enviarCorreo
};
