/**
 * scripts/diagnose-azure.js
 * 
 * Herramienta de Diagnóstico para la Integración de Azure AD y Microsoft Graph API.
 * 
 * Prueba el flujo "Client Credentials" de Azure AD usando las variables del .env,
 * interpreta detalladamente cualquier error de MSAL / Graph API en español
 * y guía al usuario con las acciones exactas a seguir.
 */

const fs = require('fs');
const path = require('path');
const { ConfidentialClientApplication } = require('@azure/msal-node');
const { Client } = require('@microsoft/microsoft-graph-client');

/**
 * Limpia y normaliza un valor de variable de entorno despojando comillas
 * envolventes y comentarios en línea accidentales.
 */
function cleanEnvVal(val) {
    if (val === undefined || val === null) return '';
    let str = String(val).trim();
    if (str.startsWith('"')) {
        const end = str.indexOf('"', 1);
        str = end !== -1 ? str.slice(1, end) : str.slice(1);
    } else if (str.startsWith("'")) {
        const end = str.indexOf("'", 1);
        str = end !== -1 ? str.slice(1, end) : str.slice(1);
    } else {
        const hash = str.indexOf('#');
        if (hash !== -1) {
            str = str.slice(0, hash).trim();
        }
    }
    return str.replace(/^["']|["']$/g, '').trim();
}

/**
 * Parsea el contenido en texto plano de un archivo .env
 */
function parseEnvString(raw) {
    const result = {};
    if (!raw || typeof raw !== 'string') return result;

    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;

        const rawKey = trimmed.slice(0, eqIdx).trim();
        const key = rawKey.startsWith('export ') ? rawKey.slice(7).trim() : rawKey;
        let rest = trimmed.slice(eqIdx + 1).trim();

        let val = '';
        if (rest.startsWith('"')) {
            const endIdx = rest.indexOf('"', 1);
            val = endIdx !== -1 ? rest.slice(1, endIdx) : rest.slice(1);
        } else if (rest.startsWith("'")) {
            const endIdx = rest.indexOf("'", 1);
            val = endIdx !== -1 ? rest.slice(1, endIdx) : rest.slice(1);
        } else {
            const hashIdx = rest.indexOf('#');
            if (hashIdx !== -1) {
                rest = rest.slice(0, hashIdx).trim();
            }
            val = rest;
        }

        result[key] = cleanEnvVal(val);
    }
    return result;
}

/**
 * Carga las variables de entorno desde el archivo .env si no están en process.env
 */
function loadEnvVariables() {
    if (typeof process.loadEnvFile === 'function') {
        try {
            process.loadEnvFile();
        } catch (_) {}
    }

    const candidatePaths = [
        path.resolve(process.cwd(), '.env'),
        path.resolve(process.cwd(), 'portal-KIp', '.env'),
        path.resolve(__dirname, '../.env')
    ];
    const envPath = candidatePaths.find(p => fs.existsSync(p)) || candidatePaths[0];

    if (fs.existsSync(envPath)) {
        try {
            const raw = fs.readFileSync(envPath, 'utf8');
            const parsed = parseEnvString(raw);
            for (const [key, val] of Object.entries(parsed)) {
                if (!process.env[key] || process.env[key].includes('#') || process.env[key].startsWith('"') || process.env[key].startsWith("'")) {
                    process.env[key] = val;
                }
            }
        } catch (_) {}
    }

    return {
        tenantId: cleanEnvVal(process.env.GRAPH_TENANT_ID),
        clientId: cleanEnvVal(process.env.GRAPH_CLIENT_ID),
        clientSecret: cleanEnvVal(process.env.GRAPH_CLIENT_SECRET),
        nocMailbox: cleanEnvVal(process.env.GRAPH_NOC_MAILBOX),
        targetFolder: cleanEnvVal(process.env.GRAPH_TARGET_FOLDER) || 'inbox'
    };
}

/**
 * Interpreta errores de autenticación de Azure AD / MSAL y errores de Microsoft Graph
 * devolviendo un objeto estructurado con título, causa y recomendaciones en español.
 */
function interpretAzureError(error, context = {}) {
    const rawMessage = error ? (error.message || error.errorMessage || String(error)) : 'Error desconocido';
    const errorCode = error?.errorCode || error?.statusCode || error?.code || '';
    const subError = error?.subError || '';
    const errorResponse = typeof error?.errorResponse === 'string'
        ? error.errorResponse
        : (error?.errorResponse ? JSON.stringify(error.errorResponse) : '');
    const fullErrorStr = `${rawMessage} ${errorCode} ${subError} ${errorResponse} ${error?.stack || ''}`;

    // 1. Error AADSTS700016: Application not found in directory
    if (/AADSTS700016/i.test(fullErrorStr) || /Application\s+(?:with\s+identifier\s+.*)?not\s+found\s+in\s+the\s+directory/i.test(fullErrorStr)) {
        return {
            code: 'AADSTS700016',
            tipo: 'ERROR_APLICACION_NO_ENCONTRADA',
            titulo: 'El CLIENT_ID no existe en este TENANT_ID (AADSTS700016)',
            explicacion: 'Microsoft Entra ID (Azure AD) indica que la aplicación con el CLIENT_ID configurado no existe en el TENANT_ID proporcionado.',
            soluciones: [
                `Verifica en el archivo .env que GRAPH_CLIENT_ID (${context.clientId || 'configurado'}) sea el 'Application (client) ID' correcto registrado en Azure Portal.`,
                `Verifica que GRAPH_TENANT_ID (${context.tenantId || 'configurado'}) sea el 'Directory (tenant) ID' del directorio donde registraste la aplicación.`,
                `Asegúrate de NO haber copiado el 'Object ID' (Id. de objeto) en lugar del 'Application (client) ID'.`,
                `Si creaste el registro en otra cuenta u otra organización de Azure, copia las credenciales del inquilino correspondiente.`
            ]
        };
    }

    // 2. Error AADSTS7000215: Invalid client secret
    if (/AADSTS7000215/i.test(fullErrorStr) || /Invalid\s+client\s+secret/i.test(fullErrorStr)) {
        return {
            code: 'AADSTS7000215',
            tipo: 'SECRETO_INVALIDO',
            titulo: 'El secreto de cliente (GRAPH_CLIENT_SECRET) es inválido (AADSTS7000215)',
            explicacion: 'El valor de GRAPH_CLIENT_SECRET no coincide con ningún secreto activo de la aplicación en Azure AD.',
            soluciones: [
                'Inicia sesión en Azure Portal > Microsoft Entra ID > App registrations > [Tu Aplicación] > Certificates & secrets.',
                'Crea un nuevo secreto ("New client secret").',
                'IMPORTANTE: Copia inmediatamente el campo "Value" (Valor) — NO copies el "Secret ID" (Id. de secreto).',
                'Pega el valor copiado en la variable GRAPH_CLIENT_SECRET de tu archivo .env.'
            ]
        };
    }

    // 3. Error AADSTS7000222: Expired client secret
    if (/AADSTS7000222/i.test(fullErrorStr) || /client\s+secret.*expired/i.test(fullErrorStr)) {
        return {
            code: 'AADSTS7000222',
            tipo: 'SECRETO_EXPIRADO',
            titulo: 'El secreto de cliente ha expirado (AADSTS7000222)',
            explicacion: 'La vigencia del GRAPH_CLIENT_SECRET configurado ha concluido en Azure AD.',
            soluciones: [
                'Ve a Azure Portal > App registrations > [Tu Aplicación] > Certificates & secrets.',
                'Genera un nuevo secreto con una fecha de expiración vigente.',
                'Actualiza GRAPH_CLIENT_SECRET en tu archivo .env con el nuevo Valor.'
            ]
        };
    }

    // 4. Error AADSTS65001: Admin Consent missing
    if (/AADSTS65001/i.test(fullErrorStr) || /not\s+consented/i.test(fullErrorStr) || (/consent/i.test(fullErrorStr) && /administrator/i.test(fullErrorStr))) {
        return {
            code: 'AADSTS65001',
            tipo: 'FALTA_ADMIN_CONSENT',
            titulo: 'Falta el Admin Consent en el portal de Azure (AADSTS65001)',
            explicacion: 'Los permisos solicitados por la aplicación aún no han sido concedidos por un administrador de Microsoft Entra ID.',
            soluciones: [
                'Ve a Azure Portal > Microsoft Entra ID > App registrations > [Tu Aplicación] > API permissions.',
                'Verifica que los permisos agregados para Microsoft Graph sean de tipo "Application" (ej. Mail.Read o Mail.ReadWrite), NO de tipo "Delegated".',
                'Haz clic en el botón "Grant admin consent for [Tu Organización]" (Conceder consentimiento de administrador).',
                'Verifica que aparezca un indicador verde de "Granted" (Concedido) en la columna Status.'
            ]
        };
    }

    // 5. Error AADSTS90002 / AADSTS50059: Tenant not found
    if (/AADSTS90002/i.test(fullErrorStr) || /AADSTS50059/i.test(fullErrorStr) || /Tenant.*not\s+found/i.test(fullErrorStr)) {
        return {
            code: 'AADSTS90002',
            tipo: 'TENANT_NO_ENCONTRADO',
            titulo: 'El TENANT_ID especificado no existe (AADSTS90002)',
            explicacion: 'Microsoft Entra ID no reconoce el identificador de inquilino proporcionado en GRAPH_TENANT_ID.',
            soluciones: [
                `Comprueba que GRAPH_TENANT_ID (${context.tenantId || ''}) sea un GUID válido o el dominio onmicrosoft.com correspondiente.`,
                'Verifica en Azure Portal > Microsoft Entra ID > Overview el campo "Directory (tenant) ID".',
                'Asegúrate de que no contenga espacios ni caracteres invisibles.'
            ]
        };
    }

    // 6. Error AADSTS70011: Invalid scope
    if (/AADSTS70011/i.test(fullErrorStr) || /scope.*not\s+valid/i.test(fullErrorStr)) {
        return {
            code: 'AADSTS70011',
            tipo: 'SCOPE_INVALIDO',
            titulo: 'El ámbito (scope) solicitado no es válido (AADSTS70011)',
            explicacion: 'Microsoft Entra ID rechazó el scope solicitado. Para flujo Client Credentials debe usarse https://graph.microsoft.com/.default.',
            soluciones: [
                'Verifica que el scope utilizado sea https://graph.microsoft.com/.default.',
                'Asegúrate de que no haya espacios o parámetros erróneos en la llamada de autenticación.'
            ]
        };
    }

    // 7. Errores de Red / Conectividad
    if (/ENOTFOUND/i.test(fullErrorStr) || /ECONNREFUSED/i.test(fullErrorStr) || /ETIMEDOUT/i.test(fullErrorStr) || /fetch\s+failed/i.test(fullErrorStr)) {
        return {
            code: 'NETWORK_ERROR',
            tipo: 'ERROR_CONEXION_RED',
            titulo: 'Error de conexión de red al contactar Azure AD / Microsoft Graph',
            explicacion: 'No se pudo establecer conexión HTTP con los servidores de Microsoft (login.microsoftonline.com o graph.microsoft.com).',
            soluciones: [
                'Comprueba tu conexión a internet.',
                'Verifica que ningún cortafuegos, proxy o regla de red corporativa esté bloqueando el dominio login.microsoftonline.com.',
                'Intenta nuevamente pasados unos segundos.'
            ]
        };
    }

    // 8. Error Graph API 401: Unauthorized / Token inválido
    if (/401/i.test(fullErrorStr) || /InvalidAuthenticationToken/i.test(fullErrorStr) || /CompactToken/i.test(fullErrorStr)) {
        return {
            code: 'GRAPH_401',
            tipo: 'TOKEN_INVALIDO',
            titulo: 'Token de autenticación rechazado o inválido (Error 401 Unauthorized)',
            explicacion: 'Microsoft Graph rechazó el token de acceso provisto. Puede estar malformado o haber sido revocado.',
            soluciones: [
                'Verifica que las credenciales en el archivo .env sean vigentes.',
                'Vuelve a ejecutar la prueba de diagnóstico para regenerar un token fresco.'
            ]
        };
    }

    // 9. Error Graph API 403 / ErrorAccessDenied
    if (/403/i.test(fullErrorStr) || /ErrorAccessDenied/i.test(fullErrorStr) || /Access\s+is\s+denied/i.test(fullErrorStr)) {
        return {
            code: 'GRAPH_403',
            tipo: 'ACCESO_DENEGADO_GRAFICA',
            titulo: 'Acceso Denegado al buzón de Microsoft Graph (Error 403 Forbidden)',
            explicacion: 'El token de autenticación es válido, pero la aplicación no tiene permisos suficientes para consultar el buzón especificado.',
            soluciones: [
                'Ve a Azure Portal > App registrations > [Tu Aplicación] > API permissions.',
                'Asegúrate de haber asignado permisos de tipo "Application" (Mail.Read o Mail.ReadWrite), NO "Delegated".',
                'Haz clic en "Grant admin consent for [Tu Organización]" para aplicar los permisos a nivel tenant.',
                `Si tu organización usa directivas de acceso a buzones (ApplicationAccessPolicy en Exchange Online), valida que el buzón '${context.nocMailbox || ''}' esté incluido en los buzones autorizados.`
            ]
        };
    }

    // 10. Error Graph API 404 / ResourceNotFound / ErrorItemNotFound / ErrorInvalidUser / MailboxNotEnabledForRESTAPI
    if (/404/i.test(fullErrorStr) || /ResourceNotFound/i.test(fullErrorStr) || /ErrorItemNotFound/i.test(fullErrorStr) || /ErrorInvalidUser/i.test(fullErrorStr) || /MailboxNotEnabledForRESTAPI/i.test(fullErrorStr)) {
        return {
            code: 'GRAPH_404',
            tipo: 'BUZON_O_RECURSO_NO_ENCONTRADO',
            titulo: 'El buzón o recurso especificado no fue encontrado o no está habilitado (Error 404)',
            explicacion: `Microsoft Graph no encontró o no pudo acceder al usuario o buzón configurado en GRAPH_NOC_MAILBOX (${context.nocMailbox || 'no configurado'}).`,
            soluciones: [
                `Verifica que el correo '${context.nocMailbox || ''}' esté bien escrito en el archivo .env.`,
                'Confirma en el Centro de Administración de Microsoft 365 que la cuenta de usuario o buzón compartido exista y disponga de licencia de Exchange.',
                'Si se trata de un buzón compartido o recién configurado, verifica que tenga habilitado el acceso REST y espera unos minutos a que finalice la replicación.'
            ]
        };
    }

    // 11. Error Graph API 429: Too Many Requests
    if (/429/i.test(fullErrorStr) || /TooManyRequests/i.test(fullErrorStr) || /rate\s+limit/i.test(fullErrorStr)) {
        return {
            code: 'GRAPH_429',
            tipo: 'LIMITE_PETICIONES',
            titulo: 'Límite de peticiones alcanzado en Microsoft Graph (Error 429 Too Many Requests)',
            explicacion: 'Microsoft Graph ha limitado temporalmente las solicitudes hacia el buzón debido a un volumen elevado de consultas.',
            soluciones: [
                'Espera entre 1 y 2 minutos antes de reintentar la conexión.',
                'El servicio continuará automáticamente en su siguiente intervalo programado.'
            ]
        };
    }

    // 12. Error AADSTS50171: Application is disabled
    if (/AADSTS50171/i.test(fullErrorStr) || /Application.*is\s+disabled/i.test(fullErrorStr)) {
        return {
            code: 'AADSTS50171',
            tipo: 'APLICACION_DESHABILITADA',
            titulo: 'La aplicación está deshabilitada en Azure AD (AADSTS50171)',
            explicacion: 'El registro de aplicación o entidad de servicio ha sido deshabilitado por el administrador en Microsoft Entra ID.',
            soluciones: [
                'Inicia sesión en Azure Portal > Microsoft Entra ID > Enterprise applications.',
                `Busca la aplicación con Client ID '${context.clientId || ''}' y verifica la propiedad 'Enabled for users to sign-in'.`,
                'Habilita la aplicación o consulta al administrador del tenant.'
            ]
        };
    }

    // 13. Error AADSTS500011: Resource principal not found
    if (/AADSTS500011/i.test(fullErrorStr) || /resource\s+principal.*not\s+found/i.test(fullErrorStr)) {
        return {
            code: 'AADSTS500011',
            tipo: 'RECURSO_NO_ENCONTRADO',
            titulo: 'Recurso principal no encontrado en el tenant (AADSTS500011)',
            explicacion: 'Microsoft Entra ID no encuentra la entidad de servicio del recurso en este inquilino.',
            soluciones: [
                'Verifica que el recurso solicitado esté disponible en la suscripción.',
                'Asegúrate de que el scope configurado sea https://graph.microsoft.com/.default.'
            ]
        };
    }

    // 14. Fallback general
    return {
        code: errorCode || 'AZURE_UNKNOWN_ERROR',
        tipo: 'ERROR_DESCONOCIDO',
        titulo: `Error de integración con Azure AD: ${rawMessage.slice(0, 100)}`,
        explicacion: rawMessage,
        soluciones: [
            'Revisa la consola de Microsoft Entra ID para comprobar el estado de la aplicación.',
            'Verifica que las variables GRAPH_TENANT_ID, GRAPH_CLIENT_ID y GRAPH_CLIENT_SECRET en .env sean correctas.',
            'Consulta los registros de auditoría en Azure Portal > App registrations > [Tu Aplicación].'
        ]
    };
}

/**
 * Función principal de diagnóstico
 */
async function runDiagnosis() {
    console.log('\n================================================================');
    console.log('   DIAGNÓSTICO DE INTEGRACIÓN AZURE AD & MICROSOFT GRAPH API    ');
    console.log('================================================================\n');

    // Paso 1: Validación de variables de entorno
    console.log('🔍 [1/3] Verificando variables de entorno en el archivo .env...');
    const config = loadEnvVariables();

    const requiredVars = [
        { key: 'GRAPH_TENANT_ID', val: config.tenantId, label: 'Tenant ID de Azure AD' },
        { key: 'GRAPH_CLIENT_ID', val: config.clientId, label: 'Client ID (App ID)' },
        { key: 'GRAPH_CLIENT_SECRET', val: config.clientSecret, label: 'Client Secret (Valor del secreto)' },
        { key: 'GRAPH_NOC_MAILBOX', val: config.nocMailbox, label: 'Buzón de correo NOC a monitorear' }
    ];

    const missing = requiredVars.filter(v => !v.val);
    if (missing.length > 0) {
        console.error('\n❌ DIAGNÓSTICO: Faltan variables de entorno obligatorias en tu archivo .env:');
        missing.forEach(m => console.error(`   - ${m.key} (${m.label})`));
        console.error('\n💡 Solución: Abre portal-KIp/.env y configura las variables faltantes antes de continuar.\n');
        return { success: false, step: 'ENV_VARIABLES', error: 'Missing environment variables', missing };
    }

    console.log('   ✅ Variables obligatorias presentes:');
    console.log(`      - GRAPH_TENANT_ID   : ${config.tenantId}`);
    console.log(`      - GRAPH_CLIENT_ID   : ${config.clientId}`);
    console.log(`      - GRAPH_CLIENT_SECRET: ${config.clientSecret.slice(0, 4)}****`);
    console.log(`      - GRAPH_NOC_MAILBOX : ${config.nocMailbox}`);
    console.log(`      - GRAPH_TARGET_FOLDER: ${config.targetFolder}`);

    // Paso 2: Prueba de autenticación con MSAL (Client Credentials)
    console.log('\n🔐 [2/3] Probando flujo "Client Credentials" con Azure AD (MSAL Node)...');

    const msalConfig = {
        auth: {
            clientId: config.clientId,
            authority: `https://login.microsoftonline.com/${config.tenantId}`,
            clientSecret: config.clientSecret
        }
    };

    let tokenResponse = null;
    try {
        const cca = new ConfidentialClientApplication(msalConfig);
        tokenResponse = await cca.acquireTokenByClientCredential({
            scopes: ['https://graph.microsoft.com/.default']
        });

        if (!tokenResponse || !tokenResponse.accessToken) {
            throw new Error('Azure no devolvió un accessToken válido.');
        }

        console.log('   ✅ Token de acceso obtenido con éxito de Microsoft Entra ID.');
        console.log(`      - Tipo de token : ${tokenResponse.tokenType || 'Bearer'}`);
        console.log(`      - Expira en     : ${tokenResponse.expiresOn ? new Date(tokenResponse.expiresOn).toLocaleTimeString() : 'N/A'}`);
    } catch (msalError) {
        const diagnosis = interpretAzureError(msalError, config);

        console.error('\n' + '─'.repeat(64));
        console.error(`❌ DIAGNÓSTICO DEL ERROR DE AUTENTICACIÓN:`);
        console.error(`   ${diagnosis.titulo}`);
        console.error('─'.repeat(64));
        console.error(`\n📄 Explicación:`);
        console.error(`   ${diagnosis.explicacion}`);
        console.error(`\n🛠️  ¿Qué debes corregir?:`);
        diagnosis.soluciones.forEach((sol, i) => {
            console.error(`   ${i + 1}. ${sol}`);
        });
        console.error('─'.repeat(64) + '\n');

        return { success: false, step: 'MSAL_AUTH', error: msalError.message, diagnosis };
    }

    // Paso 3: Validación de permisos y acceso a Microsoft Graph
    console.log('\n📬 [3/3] Probando acceso a Microsoft Graph API y verificación de buzón...');
    try {
        const graphClient = Client.init({
            authProvider: (done) => done(null, tokenResponse.accessToken)
        });

        const encodedMailbox = encodeURIComponent(config.nocMailbox);

        // 3.1 Consultar información del usuario/buzón
        let user = null;
        try {
            user = await graphClient
                .api(`/users/${encodedMailbox}`)
                .select('id,displayName,mail,userPrincipalName')
                .get();

            console.log(`   ✅ Buzón localizado: "${user.displayName || user.mail}" (${user.userPrincipalName})`);
        } catch (userErr) {
            // Si el error es 403 Forbidden, el administrador puede haber otorgado únicamente Mail.Read / Mail.ReadWrite
            // (lo cual es la práctica de seguridad recomendada por mínimo privilegio). Continuamos validando acceso directo a carpetas.
            if (userErr?.statusCode === 403 || /AccessDenied/i.test(userErr?.message)) {
                console.log(`   ℹ️ Verificación de perfil omitida (requiere User.Read.All). Procediendo a validar permisos directos de correo...`);
            } else {
                throw userErr;
            }
        }

        // 3.2 Verificar carpeta de destino (raíz o subcarpeta)
        let folderId = 'inbox';
        if (config.targetFolder && config.targetFolder.toLowerCase() !== 'inbox') {
            const folderParts = config.targetFolder.split(/[/\\]/).map(p => p.trim()).filter(Boolean);
            const leafFolder = folderParts.length > 0 ? folderParts[folderParts.length - 1] : config.targetFolder;
            const escapedFolder = leafFolder.replace(/'/g, "''");
            try {
                // 3.2.1 Buscar en nivel raíz de carpetas
                const folders = await graphClient
                    .api(`/users/${encodedMailbox}/mailFolders`)
                    .filter(`displayName eq '${escapedFolder}'`)
                    .get();

                if (folders?.value && folders.value.length > 0) {
                    folderId = folders.value[0].id;
                    console.log(`   ✅ Carpeta de ingesta localizada: "${config.targetFolder}" (ID: ${folderId})`);
                } else {
                    // 3.2.2 Buscar como subcarpeta dentro de Inbox
                    let foundSub = false;
                    try {
                        const childFolders = await graphClient
                            .api(`/users/${encodedMailbox}/mailFolders/inbox/childFolders`)
                            .filter(`displayName eq '${escapedFolder}'`)
                            .get();

                        if (childFolders?.value && childFolders.value.length > 0) {
                            folderId = childFolders.value[0].id;
                            foundSub = true;
                            console.log(`   ✅ Subcarpeta de ingesta localizada en Bandeja de entrada: "${config.targetFolder}" (ID: ${folderId})`);
                        }
                    } catch (childErr) {
                        if (childErr && (childErr.statusCode === 401 || childErr.statusCode === 403 || /AADSTS/i.test(childErr.message))) {
                            throw childErr;
                        }
                    }

                    if (!foundSub) {
                        console.log(`   ⚠️ Carpeta "${config.targetFolder}" no encontrada en el buzón. Se utilizará "inbox" por defecto.`);
                    }
                }
            } catch (folderErr) {
                if (folderErr && (folderErr.statusCode === 401 || folderErr.statusCode === 403 || /AADSTS/i.test(folderErr.message))) {
                    throw folderErr;
                }
                console.log(`   ⚠️ No se pudo listar carpetas personalizadas. Se utilizará "inbox": ${folderErr.message}`);
            }
        } else {
            console.log('   ✅ Usando carpeta por defecto: "inbox"');
        }

        // 3.3 Probar lectura de correos (Mail.Read / Mail.ReadWrite)
        const messages = await graphClient
            .api(`/users/${encodedMailbox}/mailFolders/${folderId}/messages`)
            .filter('isRead eq false')
            .top(5)
            .select('id,subject,from,receivedDateTime')
            .get();

        const count = messages?.value?.length || 0;
        console.log(`   ✅ Consulta de mensajes completada. Correos no leídos encontrados: ${count}`);

        console.log('\n================================================================');
        console.log('   🎉 ¡DIAGNÓSTICO EXITOSO! LA INTEGRACIÓN ESTÁ LISTA');
        console.log('================================================================');
        console.log('   - Flujo de autenticación Azure AD (Client Credentials): CORRECTO');
        console.log('   - Permisos de Microsoft Graph: CORRECTOS');
        console.log('   - Acceso al buzón de ingesta: CORRECTO');
        console.log('   - El servicio emailIngestionService puede operar con normalidad.\n');

        return { success: true, mailbox: user?.mail || user?.userPrincipalName || config.nocMailbox, unreadCount: count };
    } catch (graphError) {
        const diagnosis = interpretAzureError(graphError, config);

        console.error('\n' + '─'.repeat(64));
        console.error(`❌ DIAGNÓSTICO DEL ERROR DE MICROSOFT GRAPH:`);
        console.error(`   ${diagnosis.titulo}`);
        console.error('─'.repeat(64));
        console.error(`\n📄 Explicación:`);
        console.error(`   ${diagnosis.explicacion}`);
        console.error(`\n🛠️  ¿Qué debes corregir?:`);
        diagnosis.soluciones.forEach((sol, i) => {
            console.error(`   ${i + 1}. ${sol}`);
        });
        console.error('─'.repeat(64) + '\n');

        return { success: false, step: 'GRAPH_API', error: graphError.message, diagnosis };
    }
}

// Ejecución directa por línea de comandos
if (require.main === module) {
    runDiagnosis().then(res => {
        if (!res.success) {
            process.exit(1);
        }
        process.exit(0);
    }).catch(err => {
        console.error('Error inesperado durante el diagnóstico:', err);
        process.exit(1);
    });
}

module.exports = {
    cleanEnvVal,
    parseEnvString,
    loadEnvVariables,
    interpretAzureError,
    runDiagnosis
};
