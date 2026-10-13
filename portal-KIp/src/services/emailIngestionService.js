const { ClientSecretCredential } = require('@azure/identity');
const { Client } = require('@microsoft/microsoft-graph-client');
const { TokenCredentialAuthenticationProvider } = require('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials');
const cron = require('node-cron');
const prisma = require('../config/prisma');

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
            .select('id,subject,bodyPreview,from,receivedDateTime')
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
                // Generar uno nuevo consultando el último en BD
                const ultimos = await prisma.ticket.findMany({ where: prisma.INCLUDE_DELETED, select: { codigo_incidencia: true } });
                const nums = ultimos.map(t => parseInt(t.codigo_incidencia.split('-')[1]) || 0);
                const nextNum = nums.length ? Math.max(...nums) + 1 : 1;
                codigoIncidencia = `INC-${String(nextNum).padStart(3, '0')}`;
            }

            // 2. Insertar o saltar si ya existe el código
            const existe = await prisma.ticket.findUnique({ where: { codigo_incidencia: codigoIncidencia } });
            if (!existe) {
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
    procesarCorreosEntrantes
};
