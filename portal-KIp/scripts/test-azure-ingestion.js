/**
 * scripts/test-azure-ingestion.js
 * 
 * Suite de pruebas unitarias y pruebas adversariales para:
 * 1. scripts/diagnose-azure.js (interpretación de errores MSAL/Azure AD y Graph API)
 * 2. src/services/emailIngestionService.js (resiliencia, bloques try/catch individuales, colisiones y edge cases)
 */

const assert = require('assert');
const {
    interpretAzureError,
    loadEnvVariables,
    parseEnvString,
    cleanEnvVal
} = require('./diagnose-azure');

const {
    procesarCorreosEntrantes,
    getTargetFolderId,
    getNextTicketCode,
    resetFolderCache,
    getGraphClient,
    resetGraphClient
} = require('../src/services/emailIngestionService');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
    totalTests++;
    try {
        fn();
        passedTests++;
        console.log(`  ✅ [PASS] ${name}`);
    } catch (err) {
        console.error(`  ❌ [FAIL] ${name}`);
        console.error(`     Error: ${err.message}`);
    }
}

async function runAsyncTest(name, fn) {
    totalTests++;
    try {
        await fn();
        passedTests++;
        console.log(`  ✅ [PASS] ${name}`);
    } catch (err) {
        console.error(`  ❌ [FAIL] ${name}`);
        console.error(`     Error: ${err.message}`);
    }
}

console.log('\n================================================================');
console.log('   EJECUTANDO PRUEBAS UNITARIAS: DIAGNÓSTICO E INGESTA AZURE    ');
console.log('================================================================\n');

// -------------------------------------------------------------
// SECCIÓN 1: Pruebas de Interpretación de Errores de Azure AD (MSAL)
// -------------------------------------------------------------
console.log('--- SECCIÓN 1: Interpretación de Errores Azure AD (MSAL) ---');

runTest('R1.1: Interpretar error AADSTS700016 (Application not found in directory)', () => {
    const error = new Error('invalid_client: AADSTS700016: Application with identifier 00000000-0000-0000-0000-00000000c1d0 was not found in the directory 00000000-0000-0000-0000-0000000007e1');
    const result = interpretAzureError(error, {
        clientId: '00000000-0000-0000-0000-00000000c1d0',
        tenantId: '00000000-0000-0000-0000-0000000007e1'
    });

    assert.strictEqual(result.code, 'AADSTS700016');
    assert.strictEqual(result.tipo, 'ERROR_APLICACION_NO_ENCONTRADA');
    assert(result.titulo.includes('CLIENT_ID no existe en este TENANT_ID'), 'El título debe mencionar CLIENT_ID y TENANT_ID');
    assert(result.soluciones.length >= 3, 'Debe ofrecer soluciones detalladas');
    assert(result.soluciones[0].includes('GRAPH_CLIENT_ID'), 'Debe referirse a GRAPH_CLIENT_ID');
});

runTest('R1.2: Interpretar error AADSTS7000215 (Invalid client secret)', () => {
    const error = new Error('invalid_client: AADSTS7000215: Invalid client secret is provided.');
    const result = interpretAzureError(error);

    assert.strictEqual(result.code, 'AADSTS7000215');
    assert.strictEqual(result.tipo, 'SECRETO_INVALIDO');
    assert(result.titulo.includes('inválido'), 'El título debe indicar secreto inválido');
    assert(result.soluciones.some(s => s.includes('Valor') || s.includes('Value')), 'Debe explicar usar Value y no Secret ID');
});

runTest('R1.3: Interpretar error AADSTS7000222 (Expired client secret)', () => {
    const error = new Error('invalid_client: AADSTS7000222: The provided client secret keys are expired.');
    const result = interpretAzureError(error);

    assert.strictEqual(result.code, 'AADSTS7000222');
    assert.strictEqual(result.tipo, 'SECRETO_EXPIRADO');
    assert(result.titulo.includes('expirado'), 'El título debe indicar secreto expirado');
});

runTest('R1.4: Interpretar error AADSTS65001 (Admin Consent required)', () => {
    const error = new Error('unauthorized_client: AADSTS65001: The user or administrator has not consented to use the application with ID.');
    const result = interpretAzureError(error);

    assert.strictEqual(result.code, 'AADSTS65001');
    assert.strictEqual(result.tipo, 'FALTA_ADMIN_CONSENT');
    assert(result.titulo.includes('Admin Consent'), 'El título debe mencionar Admin Consent');
    assert(result.soluciones.some(s => s.includes('Grant admin consent')), 'Debe indicar pulsar Grant admin consent');
});

runTest('R1.5: Interpretar error AADSTS90002 (Tenant not found)', () => {
    const error = new Error('AADSTS90002: Tenant 00000000-0000-0000-0000-0000000007e1 not found.');
    const result = interpretAzureError(error, { tenantId: '00000000-0000-0000-0000-0000000007e1' });

    assert.strictEqual(result.code, 'AADSTS90002');
    assert.strictEqual(result.tipo, 'TENANT_NO_ENCONTRADO');
    assert(result.titulo.includes('TENANT_ID'), 'Debe mencionar TENANT_ID');
});

runTest('R1.6: Interpretar error Graph API 403 (Forbidden / Access Denied)', () => {
    const error = new Error('ErrorAccessDenied: Access is denied. Check credentials and try again. Status code: 403');
    const result = interpretAzureError(error, { nocMailbox: 'noc@empresa.com' });

    assert.strictEqual(result.code, 'GRAPH_403');
    assert.strictEqual(result.tipo, 'ACCESO_DENEGADO_GRAFICA');
    assert(result.titulo.includes('403'), 'Debe mencionar 403');
    assert(result.soluciones.some(s => s.includes('Mail.Read')), 'Debe recomendar permisos Mail.Read/Mail.ReadWrite');
});

runTest('R1.7: Interpretar error Graph API 404 (Mailbox not found)', () => {
    const error = new Error('ResourceNotFound: The specified user was not found. Status code: 404');
    const result = interpretAzureError(error, { nocMailbox: 'inexistente@empresa.com' });

    assert.strictEqual(result.code, 'GRAPH_404');
    assert.strictEqual(result.tipo, 'BUZON_O_RECURSO_NO_ENCONTRADO');
    assert(result.titulo.includes('404'), 'Debe mencionar 404');
    assert(result.soluciones.some(s => s.includes('GRAPH_NOC_MAILBOX')), 'Debe indicar revisar GRAPH_NOC_MAILBOX');
});

runTest('R1.8: Carga y saneamiento de variables .env', () => {
    const envVars = loadEnvVariables();
    assert(typeof envVars === 'object');
    assert('tenantId' in envVars);
    assert('clientId' in envVars);
    assert('clientSecret' in envVars);
    assert('nocMailbox' in envVars);
    assert('targetFolder' in envVars);
    if (envVars.targetFolder) {
        assert(!envVars.targetFolder.startsWith('"') && !envVars.targetFolder.endsWith('"'), 'targetFolder no debe tener comillas');
        assert(!envVars.targetFolder.includes('#'), 'targetFolder no debe contener comentarios');
    }
});

runTest('ADV-1: [Adversarial] Saneamiento de variables .env con comentarios en línea y comillas', () => {
    const mockEnv = [
        'GRAPH_TENANT_ID="tenant-guid-123" # comentario con "comillas"',
        "GRAPH_CLIENT_ID='client-guid-456' # otro comentario",
        'GRAPH_TARGET_FOLDER="PruebasInter" # Cambia "inbox" por el nombre de tu carpeta',
        'UNQUOTED_VAL=simple_val # comentario sin comillas',
        'EMPTY_VAL=""'
    ].join('\n');

    const parsed = parseEnvString(mockEnv);
    assert.strictEqual(parsed.GRAPH_TENANT_ID, 'tenant-guid-123');
    assert.strictEqual(parsed.GRAPH_CLIENT_ID, 'client-guid-456');
    assert.strictEqual(parsed.GRAPH_TARGET_FOLDER, 'PruebasInter');
    assert.strictEqual(parsed.UNQUOTED_VAL, 'simple_val');
    assert.strictEqual(parsed.EMPTY_VAL, '');
});

runTest('ADV-2: [Adversarial] Interpretación de errores Graph 401, AADSTS70011 (Scope) y Graph 429', () => {
    const err401 = new Error('InvalidAuthenticationToken: CompactToken parsing failed. Status code: 401');
    const res401 = interpretAzureError(err401);
    assert.strictEqual(res401.code, 'GRAPH_401');
    assert.strictEqual(res401.tipo, 'TOKEN_INVALIDO');

    const errScope = new Error('AADSTS70011: The provided value for the input parameter scope is not valid.');
    const resScope = interpretAzureError(errScope);
    assert.strictEqual(resScope.code, 'AADSTS70011');
    assert.strictEqual(resScope.tipo, 'SCOPE_INVALIDO');

    const err429 = new Error('TooManyRequests: The request was rate limited. Status code: 429');
    const res429 = interpretAzureError(err429);
    assert.strictEqual(res429.code, 'GRAPH_429');
    assert.strictEqual(res429.tipo, 'LIMITE_PETICIONES');
});

// -------------------------------------------------------------
// SECCIÓN 2: Pruebas de Resiliencia en Ingesta de Correos (R2)
// -------------------------------------------------------------
console.log('\n--- SECCIÓN 2: Resiliencia de Ingesta y Bloques Try/Catch Individuales ---');

function createMockPrismaStore(options = {}) {
    const tickets = options.initialTickets ? [...options.initialTickets] : [];
    const auditLogs = [];
    return {
        _tickets: tickets,
        _auditLogs: auditLogs,
        ticket: {
            findMany: async () => [...tickets],
            findUnique: async ({ where }) => {
                return tickets.find(t => t.codigo_incidencia === where.codigo_incidencia) || null;
            },
            create: async ({ data }) => {
                if (data.asunto && data.asunto.includes('FORZAR_ERROR_DB')) {
                    throw new Error('Error simulado de Base de Datos / Conexión Prisma');
                }
                if (options.failUniqueTimes && options.failUniqueTimes > 0) {
                    if (!options._failCount) options._failCount = 0;
                    if (options._failCount < options.failUniqueTimes) {
                        options._failCount++;
                        const p2002Err = new Error('Unique constraint failed on the fields: (`codigo_incidencia`)');
                        p2002Err.code = 'P2002';
                        throw p2002Err;
                    }
                }
                if (options.failUniqueOn && options.failUniqueOn === data.codigo_incidencia && !options._alreadyFailedUnique) {
                    options._alreadyFailedUnique = true;
                    const p2002Err = new Error('Unique constraint failed on the fields: (`codigo_incidencia`)');
                    p2002Err.code = 'P2002';
                    throw p2002Err;
                }
                const newTicket = {
                    id: `ticket-${tickets.length + 1}`,
                    codigo_incidencia: data.codigo_incidencia,
                    asunto: data.asunto,
                    descripcion: data.descripcion || null,
                    remitente: data.remitente,
                    estado_actual: data.estado_actual || 'NUEVO',
                    area_designada: data.area_designada || 'GENERAL',
                    origen_ingesta: data.origen_ingesta || 'CORREO',
                    createdAt: new Date(),
                    updatedAt: new Date()
                };
                tickets.push(newTicket);
                return { ...newTicket };
            }
        },
        auditLog: {
            create: async ({ data }) => {
                auditLogs.push(data);
                return { id: `audit-${auditLogs.length}`, ...data };
            }
        }
    };
}

function createMockGraphClient(messagesToReturn, options = {}) {
    let patchedMessageIds = [];
    return {
        _patched: patchedMessageIds,
        api: (endpoint) => {
            return {
                filter: () => ({
                    top: () => ({
                        select: () => ({
                            get: async () => {
                                if (options.throwAuthError) {
                                    throw new Error('invalid_client: AADSTS700016: Application with identifier was not found in directory');
                                }
                                if (options.throwOnMessages) {
                                    throw new Error('Error de red al consultar Graph API');
                                }
                                return { value: messagesToReturn };
                            }
                        })
                    }),
                    get: async () => {
                        if (options.throwAuthErrorOnFolders) {
                            throw new Error('invalid_client: AADSTS700016: Application with identifier was not found in directory');
                        }
                        if (options.throwOnFolders) {
                            throw new Error('Error temporal de red en carpetas');
                        }
                        if (endpoint.includes('childFolders') && options.childFolder) {
                            return { value: [{ id: 'child-folder-id-789' }] };
                        }
                        if (options.customFolder && !endpoint.includes('childFolders')) {
                            return { value: [{ id: 'custom-folder-id-123' }] };
                        }
                        return { value: [] };
                    }
                }),
                patch: async (body) => {
                    if (options.throwOnPatch) {
                        throw new Error('Error al marcar mensaje como leído');
                    }
                    patchedMessageIds.push(endpoint);
                    return { isRead: true };
                }
            };
        }
    };
}

runAsyncTest('R2.1: Ingesta de correo estándar genera código INC-001 y crea ticket', async () => {
    const mockDb = createMockPrismaStore();
    const mockMessages = [
        {
            id: 'msg-1',
            subject: 'Falla en enlace fibra óptica',
            bodyPreview: 'Reporte de corte en nodo central',
            from: { emailAddress: { address: 'operaciones@cliente.com' } }
        }
    ];
    const mockClient = createMockGraphClient(mockMessages);

    const result = await procesarCorreosEntrantes({
        clientOverride: mockClient,
        prismaOverride: mockDb
    });

    assert.strictEqual(result.processed, 1, 'Debe procesar 1 correo exitosamente');
    assert.strictEqual(result.errors, 0, 'No debe haber errores');
    assert.strictEqual(mockDb._tickets.length, 1, 'Debe haber creado 1 ticket en BD');
    assert.strictEqual(mockDb._tickets[0].codigo_incidencia, 'INC-001');
    assert.strictEqual(mockDb._tickets[0].asunto, 'Falla en enlace fibra óptica');
    assert.strictEqual(mockDb._tickets[0].remitente, 'operaciones@cliente.com');
    assert.strictEqual(mockClient._patched.length, 1, 'Debe haber marcado el correo como leído');
    assert(mockDb._auditLogs.length >= 1, 'Debe registrar audit log');
});

runAsyncTest('R2.2: Correo malformado sin subject no rompe el servidor y usa "(Sin Asunto)"', async () => {
    const mockDb = createMockPrismaStore();
    const mockMessages = [
        {
            id: 'msg-null-subject',
            subject: null,
            bodyPreview: 'Texto en el cuerpo sin asunto',
            from: { emailAddress: { address: 'usuario@correo.com' } }
        }
    ];
    const mockClient = createMockGraphClient(mockMessages);

    const result = await procesarCorreosEntrantes({
        clientOverride: mockClient,
        prismaOverride: mockDb
    });

    assert.strictEqual(result.processed, 1);
    assert.strictEqual(result.errors, 0);
    assert.strictEqual(mockDb._tickets.length, 1);
    assert.strictEqual(mockDb._tickets[0].asunto, '(Sin Asunto)');
});

runAsyncTest('R2.3: Correo sin remitente (from nulo) no rompe y usa remitente por defecto', async () => {
    const mockDb = createMockPrismaStore();
    const mockMessages = [
        {
            id: 'msg-no-from',
            subject: 'Alerta de servidor sin remitente',
            bodyPreview: 'Notificación del sistema',
            from: null
        }
    ];
    const mockClient = createMockGraphClient(mockMessages);

    const result = await procesarCorreosEntrantes({
        clientOverride: mockClient,
        prismaOverride: mockDb
    });

    assert.strictEqual(result.processed, 1);
    assert.strictEqual(mockDb._tickets[0].remitente, 'desconocido@correo.com');
});

runAsyncTest('ADV-3: [Adversarial] Remitente en message.sender cuando message.from es nulo', async () => {
    const mockDb = createMockPrismaStore();
    const mockMessages = [
        {
            id: 'msg-sender-fallback',
            subject: 'Notificación enviada en nombre de otro',
            bodyPreview: 'Cuerpo',
            from: null,
            sender: { emailAddress: { address: 'sender_fallback@empresa.com' } }
        }
    ];
    const mockClient = createMockGraphClient(mockMessages);

    const result = await procesarCorreosEntrantes({
        clientOverride: mockClient,
        prismaOverride: mockDb
    });

    assert.strictEqual(result.processed, 1);
    assert.strictEqual(mockDb._tickets[0].remitente, 'sender_fallback@empresa.com');
});

runAsyncTest('ADV-4: [Adversarial] Cuerpo en message.body.content con HTML cuando bodyPreview es nulo', async () => {
    const mockDb = createMockPrismaStore();
    const mockMessages = [
        {
            id: 'msg-html-body',
            subject: 'Alerta con cuerpo HTML',
            bodyPreview: null,
            body: { contentType: 'html', content: '<p>Falla en <b>Servidor A</b></p>' },
            from: { emailAddress: { address: 'admin@sistema.com' } }
        }
    ];
    const mockClient = createMockGraphClient(mockMessages);

    const result = await procesarCorreosEntrantes({
        clientOverride: mockClient,
        prismaOverride: mockDb
    });

    assert.strictEqual(result.processed, 1);
    assert.strictEqual(mockDb._tickets[0].descripcion, 'Falla en Servidor A');
});

runAsyncTest('ADV-5: [Adversarial] Asunto con espacios en blanco solamente se normaliza a "(Sin Asunto)"', async () => {
    const mockDb = createMockPrismaStore();
    const mockMessages = [
        {
            id: 'msg-blank-subject',
            subject: '    \t   \n  ',
            bodyPreview: 'Cuerpo',
            from: { emailAddress: { address: 'test@correo.com' } }
        }
    ];
    const mockClient = createMockGraphClient(mockMessages);

    const result = await procesarCorreosEntrantes({
        clientOverride: mockClient,
        prismaOverride: mockDb
    });

    assert.strictEqual(result.processed, 1);
    assert.strictEqual(mockDb._tickets[0].asunto, '(Sin Asunto)');
});

runAsyncTest('ADV-6: [Adversarial] Mensajes corruptos (null o tipo primitivo) en el lote son omitidos', async () => {
    const mockDb = createMockPrismaStore();
    const mockMessages = [
        null,
        'string invalido',
        {
            id: 'msg-valido',
            subject: 'Correo válido',
            bodyPreview: 'Contenido',
            from: { emailAddress: { address: 'user@correo.com' } }
        }
    ];
    const mockClient = createMockGraphClient(mockMessages);

    const result = await procesarCorreosEntrantes({
        clientOverride: mockClient,
        prismaOverride: mockDb
    });

    assert.strictEqual(result.processed, 1);
    assert.strictEqual(mockDb._tickets.length, 1);
});

runAsyncTest('ADV-7: [Adversarial] Colisiones consecutivas resueltas estrictamente sin saltos numéricos', async () => {
    // Pre-poblar la BD con INC-001, INC-002, INC-003
    const initialTickets = [
        { codigo_incidencia: 'INC-001', asunto: 'A1', remitente: 'u@c.com' },
        { codigo_incidencia: 'INC-002', asunto: 'A2', remitente: 'u@c.com' },
        { codigo_incidencia: 'INC-003', asunto: 'A3', remitente: 'u@c.com' }
    ];
    const mockDb = createMockPrismaStore({ initialTickets });

    const mockMessages = [
        {
            id: 'msg-colision-secuencial',
            subject: 'Nueva alerta sin código',
            bodyPreview: 'Cuerpo',
            from: { emailAddress: { address: 'u@c.com' } }
        }
    ];
    const mockClient = createMockGraphClient(mockMessages);

    const result = await procesarCorreosEntrantes({
        clientOverride: mockClient,
        prismaOverride: mockDb
    });

    assert.strictEqual(result.processed, 1);
    assert.strictEqual(mockDb._tickets.length, 4);
    // Debe ser exactamente INC-004, NO INC-007 ni saltos
    assert.strictEqual(mockDb._tickets[3].codigo_incidencia, 'INC-004');
});

runAsyncTest('ADV-8: [Adversarial] Reintento exitoso ante colisión P2002 de clave única en Prisma', async () => {
    // Simula fallo P2002 en el primer intento y éxito en el reintento
    const mockDb = createMockPrismaStore({ failUniqueOn: 'INC-001' });

    const mockMessages = [
        {
            id: 'msg-race-condition',
            subject: 'Correo con colision concurrente',
            bodyPreview: 'Cuerpo',
            from: { emailAddress: { address: 'u@c.com' } }
        }
    ];
    const mockClient = createMockGraphClient(mockMessages);

    const result = await procesarCorreosEntrantes({
        clientOverride: mockClient,
        prismaOverride: mockDb
    });

    assert.strictEqual(result.processed, 1);
    assert.strictEqual(mockDb._tickets.length, 1);
});

runAsyncTest('R2.4: Fallo individual en un correo NO interrumpe el ciclo del lote', async () => {
    const mockDb = createMockPrismaStore();
    const mockMessages = [
        {
            id: 'msg-ok-1',
            subject: 'Primer correo normal',
            bodyPreview: 'Cuerpo 1',
            from: { emailAddress: { address: 'user1@correo.com' } }
        },
        {
            id: 'msg-error-2',
            subject: 'FORZAR_ERROR_DB en el segundo correo',
            bodyPreview: 'Cuerpo con error',
            from: { emailAddress: { address: 'user2@correo.com' } }
        },
        {
            id: 'msg-ok-3',
            subject: 'Tercer correo normal',
            bodyPreview: 'Cuerpo 3',
            from: { emailAddress: { address: 'user3@correo.com' } }
        }
    ];
    const mockClient = createMockGraphClient(mockMessages);

    const result = await procesarCorreosEntrantes({
        clientOverride: mockClient,
        prismaOverride: mockDb
    });

    assert.strictEqual(result.processed, 2, 'Los 2 correos válidos deben haberse procesado');
    assert.strictEqual(result.errors, 1, 'Exactamente 1 correo debe haber sido registrado con error');
    assert.strictEqual(mockDb._tickets.length, 2, 'Se deben haber creado los 2 tickets válidos en BD');
    assert.strictEqual(mockDb._tickets[0].asunto, 'Primer correo normal');
    assert.strictEqual(mockDb._tickets[1].asunto, 'Tercer correo normal');
});

runAsyncTest('R2.5: Respetar código INC-XXX existente en el asunto y omitir duplicados', async () => {
    const mockDb = createMockPrismaStore();
    await mockDb.ticket.create({
        data: {
            codigo_incidencia: 'INC-042',
            asunto: 'Ticket original',
            remitente: 'origen@correo.com'
        }
    });

    const mockMessages = [
        {
            id: 'msg-reply',
            subject: 'Re: INC-042 Seguimiento de la falla',
            bodyPreview: 'Aún persiste la degradación',
            from: { emailAddress: { address: 'origen@correo.com' } }
        }
    ];
    const mockClient = createMockGraphClient(mockMessages);

    const result = await procesarCorreosEntrantes({
        clientOverride: mockClient,
        prismaOverride: mockDb
    });

    assert.strictEqual(result.processed, 1, 'Debe procesar la respuesta');
    assert.strictEqual(mockDb._tickets.length, 1, 'No debe duplicar el ticket existente');
    assert.strictEqual(mockClient._patched.length, 1, 'Debe marcar el correo como leído aunque ya exista');
});

runAsyncTest('R2.6: Falla al marcar mensaje como leído no rompe la creación del ticket', async () => {
    const mockDb = createMockPrismaStore();
    const mockMessages = [
        {
            id: 'msg-patch-fail',
            subject: 'Correo con patch fallido',
            bodyPreview: 'Cuerpo',
            from: { emailAddress: { address: 'test@correo.com' } }
        }
    ];
    const mockClient = createMockGraphClient(mockMessages, { throwOnPatch: true });

    const result = await procesarCorreosEntrantes({
        clientOverride: mockClient,
        prismaOverride: mockDb
    });

    assert.strictEqual(result.processed, 1);
    assert.strictEqual(mockDb._tickets.length, 1);
    assert.strictEqual(mockDb._tickets[0].asunto, 'Correo con patch fallido');
});

runAsyncTest('R2.7: Resolución de carpeta cae a "inbox" si la carpeta no existe', async () => {
    resetFolderCache();
    const mockClient = createMockGraphClient([], { customFolder: false });
    const folderId = await getTargetFolderId(mockClient, 'noc@empresa.com');

    assert.strictEqual(folderId, 'inbox', 'Debe caer a inbox');
});

runAsyncTest('ADV-9: [Adversarial] Resolución de subcarpeta anidada dentro de inbox/childFolders', async () => {
    resetFolderCache();
    const mockClient = createMockGraphClient([], { customFolder: false, childFolder: true });
    const folderId = await getTargetFolderId(mockClient, 'noc@empresa.com');

    assert.strictEqual(folderId, 'child-folder-id-789', 'Debe resolver el id de la subcarpeta');
});

runAsyncTest('ADV-10: [Adversarial] Fallo transitorio en getTargetFolderId no bloquea permanentemente la caché', async () => {
    resetFolderCache();
    // Primer intento con fallo transitorio
    const mockFailingClient = createMockGraphClient([], { throwOnFolders: true });
    const folder1 = await getTargetFolderId(mockFailingClient, 'noc@empresa.com');
    assert.strictEqual(folder1, 'inbox', 'Falla temporal cae a inbox para esa llamada');

    // Segundo intento con cliente operativo que sí encuentra la carpeta personalizada
    const mockRecoveredClient = createMockGraphClient([], { customFolder: true });
    const folder2 = await getTargetFolderId(mockRecoveredClient, 'noc@empresa.com');
    assert.strictEqual(folder2, 'custom-folder-id-123', 'Debe recuperarse y resolver la carpeta configurada tras el fallo transitorio');
});

runAsyncTest('ADV-11: [Adversarial] Error AADSTS700016 en consulta Graph API genera diagnóstico explicativo en español', async () => {
    const mockDb = createMockPrismaStore();
    const mockClient = createMockGraphClient([], { throwAuthError: true });

    const result = await procesarCorreosEntrantes({
        clientOverride: mockClient,
        prismaOverride: mockDb
    });

    assert.strictEqual(result.processed, 0);
    assert.strictEqual(result.errors, 1);
    assert(result.diagnosis, 'Debe contener objeto diagnosis');
    assert.strictEqual(result.diagnosis.code, 'AADSTS700016');
    assert(result.diagnosis.titulo.includes('CLIENT_ID no existe en este TENANT_ID'));
});

runAsyncTest('ADV-12: [Adversarial] Reintentos múltiples ante colisiones P2002 consecutivas por inserción concurrente', async () => {
    // Simula 2 fallos consecutivos de colisión P2002 antes de tener éxito
    const mockDb = createMockPrismaStore({ failUniqueTimes: 2 });
    const mockMessages = [
        {
            id: 'msg-multi-race',
            subject: 'Falla concurrente múltiple',
            bodyPreview: 'Cuerpo',
            from: { emailAddress: { address: 'user@empresa.com' } }
        }
    ];
    const mockClient = createMockGraphClient(mockMessages);

    const result = await procesarCorreosEntrantes({
        clientOverride: mockClient,
        prismaOverride: mockDb
    });

    assert.strictEqual(result.processed, 1, 'Debe superar los reintentos y procesar el ticket');
    assert.strictEqual(mockDb._tickets.length, 1);
    // El ticket debió avanzar en el contador tras los reintentos
    assert.strictEqual(mockDb._tickets[0].codigo_incidencia, 'INC-003');
});

runAsyncTest('ADV-13: [Adversarial] Extracción de remitente plano message.from.address o message.sender.address', async () => {
    const mockDb = createMockPrismaStore();
    const mockMessages = [
        {
            id: 'msg-flat-sender',
            subject: 'Notificación remitente plano',
            bodyPreview: 'Cuerpo',
            from: { address: 'flat_from@dominio.com' }
        }
    ];
    const mockClient = createMockGraphClient(mockMessages);

    const result = await procesarCorreosEntrantes({
        clientOverride: mockClient,
        prismaOverride: mockDb
    });

    assert.strictEqual(result.processed, 1);
    assert.strictEqual(mockDb._tickets[0].remitente, 'flat_from@dominio.com');
});

runAsyncTest('ADV-14: [Adversarial] Resolución de subcarpeta definida con ruta anidada (ej. inbox/PruebasInter)', async () => {
    resetFolderCache();
    process.env.GRAPH_TARGET_FOLDER = 'inbox/PruebasInter';
    const mockClient = createMockGraphClient([], { customFolder: false, childFolder: true });

    const folderId = await getTargetFolderId(mockClient, 'noc@empresa.com');
    assert.strictEqual(folderId, 'child-folder-id-789', 'Debe extraer hoja de ruta y localizar la subcarpeta');
    delete process.env.GRAPH_TARGET_FOLDER;
});

runAsyncTest('ADV-15: [Adversarial] Error de autenticación durante getTargetFolderId no se silencia y genera diagnóstico inmediato', async () => {
    resetFolderCache();
    const mockDb = createMockPrismaStore();
    const mockClient = createMockGraphClient([], { throwAuthErrorOnFolders: true });

    const result = await procesarCorreosEntrantes({
        clientOverride: mockClient,
        prismaOverride: mockDb
    });

    assert.strictEqual(result.processed, 0);
    assert.strictEqual(result.errors, 1);
    assert(result.diagnosis, 'Debe devolver objeto diagnosis en fallo de autenticación de carpetas');
    assert.strictEqual(result.diagnosis.code, 'AADSTS700016');
});

runTest('ADV-16: [Adversarial] Interpretación de AADSTS50171 (App deshabilitada) y AADSTS500011 (Recurso no encontrado)', () => {
    const errDisabled = new Error('AADSTS50171: Application is disabled by administrator.');
    const resDisabled = interpretAzureError(errDisabled, { clientId: 'test-client' });
    assert.strictEqual(resDisabled.code, 'AADSTS50171');
    assert.strictEqual(resDisabled.tipo, 'APLICACION_DESHABILITADA');
    assert(resDisabled.titulo.includes('deshabilitada'));

    const errResource = new Error('AADSTS500011: The resource principal named https://graph.microsoft.com was not found.');
    const resResource = interpretAzureError(errResource);
    assert.strictEqual(resResource.code, 'AADSTS500011');
    assert.strictEqual(resResource.tipo, 'RECURSO_NO_ENCONTRADO');
});

runAsyncTest('ADV-17: [Adversarial] Integridad de registro AuditLog generado en ingesta', async () => {
    const mockDb = createMockPrismaStore();
    const mockMessages = [
        {
            id: 'msg-audit-verify',
            subject: 'Incidencia para auditar',
            bodyPreview: 'Detalles de falla',
            from: { emailAddress: { address: 'auditoria@cliente.com' } }
        }
    ];
    const mockClient = createMockGraphClient(mockMessages);

    await procesarCorreosEntrantes({
        clientOverride: mockClient,
        prismaOverride: mockDb
    });

    assert.strictEqual(mockDb._auditLogs.length, 1);
    const log = mockDb._auditLogs[0];
    assert.strictEqual(log.accion, 'CREACION_INGESTA');
    assert.strictEqual(log.ticketId, 'ticket-1');
    assert(log.detalles.includes('auditoria@cliente.com'));
});

runTest('ADV-18: [Adversarial] Sanitización y extracción con rutas Windows y comillas mixtas', () => {
    const rawEnv = [
        'GRAPH_TARGET_FOLDER="Inbox\\Subcarpeta"',
        'VAR_SIMPLE=sin_comillas',
        'VAR_SPACES="   valor con espacios   "'
    ].join('\r\n');

    const parsed = parseEnvString(rawEnv);
    assert.strictEqual(parsed.GRAPH_TARGET_FOLDER, 'Inbox\\Subcarpeta');
    assert.strictEqual(parsed.VAR_SIMPLE, 'sin_comillas');
    assert.strictEqual(parsed.VAR_SPACES, 'valor con espacios');
});

runTest('ADV-19: [Adversarial] Interpretación de error MailboxNotEnabledForRESTAPI en interpretAzureError', () => {
    const errRest = new Error('MailboxNotEnabledForRESTAPI: The mailbox is either inactive, soft-deleted, or is hosted on-premise.');
    const resRest = interpretAzureError(errRest, { nocMailbox: 'shared@empresa.com' });

    assert.strictEqual(resRest.code, 'GRAPH_404');
    assert.strictEqual(resRest.tipo, 'BUZON_O_RECURSO_NO_ENCONTRADO');
    assert(resRest.titulo.includes('no está habilitado') || resRest.titulo.includes('404'));
    assert(resRest.soluciones.some(s => s.includes('REST') || s.includes('Exchange')));
});

runTest('ADV-20: [Adversarial] Soporte para sintaxis export KEY=VAL en parseEnvString', () => {
    const rawEnv = [
        'export GRAPH_TENANT_ID="export-tenant-123"',
        'export GRAPH_CLIENT_ID=export-client-456',
        'GRAPH_NOC_MAILBOX="noc@empresa.com"'
    ].join('\n');

    const parsed = parseEnvString(rawEnv);
    assert.strictEqual(parsed.GRAPH_TENANT_ID, 'export-tenant-123');
    assert.strictEqual(parsed.GRAPH_CLIENT_ID, 'export-client-456');
    assert.strictEqual(parsed.GRAPH_NOC_MAILBOX, 'noc@empresa.com');
});

runTest('ADV-21: [Adversarial] Invalidación dinámica de cliente en getGraphClient ante cambio de credenciales', () => {
    resetGraphClient();
    process.env.GRAPH_TENANT_ID = 'tenant-v1';
    process.env.GRAPH_CLIENT_ID = 'client-v1';
    process.env.GRAPH_CLIENT_SECRET = 'secret-v1';

    const client1 = getGraphClient();
    assert(client1 !== null, 'Cliente 1 debe inicializarse');

    // Mismas credenciales devuelven cliente en caché
    const client1Cached = getGraphClient();
    assert.strictEqual(client1, client1Cached, 'Debe devolver misma instancia en caché');

    // Modificar credenciales invalida la caché y crea nuevo cliente
    process.env.GRAPH_CLIENT_ID = 'client-v2';
    const client2 = getGraphClient();
    assert(client2 !== null, 'Cliente 2 debe inicializarse con nuevas credenciales');
    assert.notStrictEqual(client1, client2, 'Instancia de cliente debe ser diferente tras cambio de credenciales');

    // Limpieza
    resetGraphClient();
    delete process.env.GRAPH_TENANT_ID;
    delete process.env.GRAPH_CLIENT_ID;
    delete process.env.GRAPH_CLIENT_SECRET;
});

runAsyncTest('ADV-22: [Adversarial] Decodificación de entidades HTML (&nbsp;, &amp;, &lt;, &gt;, &quot;) en descripción', async () => {
    const mockDb = createMockPrismaStore();
    const mockMessages = [
        {
            id: 'msg-entities',
            subject: 'Alerta con entidades HTML',
            bodyPreview: null,
            body: {
                contentType: 'html',
                content: '<p>Servidor&nbsp;&amp;&nbsp;Base&nbsp;de&nbsp;Datos&nbsp;&lt;Aviso&gt;&nbsp;&quot;Crítico&quot;</p>'
            },
            from: { emailAddress: { address: 'soporte@empresa.com' } }
        }
    ];
    const mockClient = createMockGraphClient(mockMessages);

    const result = await procesarCorreosEntrantes({
        clientOverride: mockClient,
        prismaOverride: mockDb
    });

    assert.strictEqual(result.processed, 1);
    assert.strictEqual(mockDb._tickets.length, 1);
    const desc = mockDb._tickets[0].descripcion;
    assert.strictEqual(desc, 'Servidor & Base de Datos <Aviso> "Crítico"');
});

runAsyncTest('ADV-23: [Adversarial] URL-encoding de dirección de buzón con caracteres especiales (#EXT#)', async () => {
    const mockDb = createMockPrismaStore();
    const guestMailbox = 'usuario_externo#EXT#@miempresa.onmicrosoft.com';
    let requestedEndpoints = [];

    const mockClient = {
        api: (endpoint) => {
            requestedEndpoints.push(endpoint);
            return {
                filter: () => ({
                    top: () => ({
                        select: () => ({
                            get: async () => ({ value: [] })
                        })
                    }),
                    get: async () => ({ value: [] })
                })
            };
        }
    };

    resetFolderCache();
    process.env.GRAPH_NOC_MAILBOX = guestMailbox;
    await procesarCorreosEntrantes({
        clientOverride: mockClient,
        prismaOverride: mockDb
    });

    // Validar que los endpoints usaron el mailbox codificado (sin # crudo)
    const encodedPart = encodeURIComponent(guestMailbox);
    assert(
        requestedEndpoints.some(ep => ep.includes(encodedPart)),
        `El endpoint de Graph debe codificar el buzón con ${encodedPart}`
    );
    assert(
        !requestedEndpoints.some(ep => ep.includes('#EXT#')),
        'El endpoint de Graph no debe contener fragmentos URL con # sin codificar'
    );

    delete process.env.GRAPH_NOC_MAILBOX;
});

runTest('ADV-24: [Adversarial] Integridad de controlador reportController y exportación de funciones', () => {
    const { getReports } = require('../src/controllers/reportController');
    assert.strictEqual(typeof getReports, 'function', 'getReports debe ser una función válida');
});

runTest('ADV-25: [Adversarial] Compilación y renderizado de views/reports.ejs con EJS', () => {
    const ejs = require('ejs');
    const fs = require('fs');
    const path = require('path');
    const templatePath = path.join(__dirname, '..', 'views', 'reports.ejs');
    assert(fs.existsSync(templatePath), 'views/reports.ejs debe existir');
    const tpl = fs.readFileSync(templatePath, 'utf8');

    const html = ejs.render(tpl, {
        titulo: 'NOC Portal - Reportes',
        currentUser: { nombre: 'Test User', email: 'test@inter.com' },
        kpis: { total: 10, jornada: 5, resueltos: 7, enProgreso: 3, tasa: '70%', puntosTotales: 35 },
        ticketsTotales: 10,
        ticketsJornada: 5,
        volumenPorArea: { labels: ['Redes FTTH'], data: [10] },
        puntosPorArea: { labels: ['Redes FTTH'], data: [35], tipo: 'Puntos' },
        ranking: [{ posicion: 1, nombre: 'Operador 1', email: 'op1@test.com', area: 'General', puntos: 35, resueltos: 7, tiempoPromedio: '20 min', estado: 'DISPONIBLE' }],
        rankingOperadores: [],
        operadores: [],
        reportData: { ticketsTotales: 10, total: 10, ticketsJornada: 5, jornada: 5, volumenPorArea: { labels: ['Redes FTTH'], data: [10] }, puntosPorArea: { labels: ['Redes FTTH'], data: [35] }, rankingOperadores: [] }
    }, { filename: templatePath });

    assert(html.includes('id="areaVolumeChart"'), 'Debe contener canvas #areaVolumeChart');
    assert(html.includes('id="areaPointsChart"'), 'Debe contener canvas #areaPointsChart');
    assert(html.includes('id="kpi-total"'), 'Debe contener elemento #kpi-total');
    assert(html.includes('figma-card'), 'Debe contener clase figma-card');
});

runTest('ADV-26: [Adversarial] Tolerancia a datos vacíos / base de datos sin registros en views/reports.ejs', () => {
    const ejs = require('ejs');
    const fs = require('fs');
    const path = require('path');
    const templatePath = path.join(__dirname, '..', 'views', 'reports.ejs');
    const tpl = fs.readFileSync(templatePath, 'utf8');

    const html = ejs.render(tpl, {
        titulo: 'NOC Portal - Reportes',
        currentUser: null,
        kpis: { total: 0, jornada: 0, resueltos: 0, enProgreso: 0, tasa: '0%', puntosTotales: 0 },
        ticketsTotales: 0,
        ticketsJornada: 0,
        volumenPorArea: { labels: [], data: [] },
        puntosPorArea: { labels: [], data: [] },
        ranking: [],
        rankingOperadores: [],
        operadores: [],
        reportData: { ticketsTotales: 0, ticketsJornada: 0, volumenPorArea: { labels: [], data: [] }, puntosPorArea: { labels: [], data: [] }, rankingOperadores: [] }
    }, { filename: templatePath });

    assert(html.includes('No hay operadores registrados para mostrar en el ranking'), 'Debe manejar lista vacía');
});


// -------------------------------------------------------------
// Resumen final
// -------------------------------------------------------------
setTimeout(() => {
    console.log('\n================================================================');
    console.log(`   RESUMEN: ${passedTests}/${totalTests} pruebas pasaron correctamente`);
    console.log('================================================================\n');

    if (passedTests !== totalTests) {
        process.exit(1);
    }
}, 500);
