const { ClientSecretCredential } = require('@azure/identity');
const { Client } = require('@microsoft/microsoft-graph-client');
const { TokenCredentialAuthenticationProvider } = require('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials');
const prisma = require('../config/prisma');
const { getNextTicketCode } = require('./ticketCodeService');
const { textoDeCorreo, extraerCorreo, quitarCitado } = require('./conversationService');
const { loadConfig } = require('./configService');
const { sugerirPrioridad } = require('./rulesService');
const graphAuth = require('./graphAuthService');
const { destinoDeBuzon, buzonParaResponder, textoError, partesCarpeta, etiquetaBuzon, BANDEJA_RE } = require('./buzonService');

// Estas variables deben ir en el archivo .env
const TENANT_ID = process.env.GRAPH_TENANT_ID;
const CLIENT_ID = process.env.GRAPH_CLIENT_ID;
const CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET;

let graphClient;
// Modo delegado: un cliente por sesión guardada (una por buzón)
const clientesDelegados = new Map();

// Correos por consulta; si llega el lote completo se pide el siguiente sin esperar (hasta LOTES_POR_VUELTA)
const LOTE = 25;
const LOTES_POR_VUELTA = 4;
// La última revisión de cada buzón se anota en la tabla cada 5 min, o al cambiar su error
const ANOTAR_CADA_MS = 5 * 60 * 1000;

const avisados = new Set();
const avisarUnaVez = (msg) => { if (!avisados.has(msg)) { avisados.add(msg); console.warn(msg); } };

/** Segundos entre revisiones del buzón (GRAPH_INTERVALO_SEGUNDOS, 30 por defecto, mínimo 10). */
function intervaloSegundos(env = process.env) {
    const n = parseInt(env.GRAPH_INTERVALO_SEGUNDOS, 10);
    return Number.isFinite(n) ? Math.max(10, n) : 30;
}

/** Cliente con el secreto de la app (modo aplicación): uno solo para todos los buzones. */
function clienteAplicacion() {
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

/** Cliente del modo de prueba: token de quien inició sesión con scripts/graph-login.js (sesión en `archivo`). */
function clienteDelegado(archivo, { soloLectura = false, correo = null } = {}) {
    if (!process.env.GRAPH_CLIENT_ID) {
        avisarUnaVez("⚠️ Falta GRAPH_CLIENT_ID. La ingesta de correos está deshabilitada.");
        return null;
    }
    const scopes = graphAuth.scopesDelegados(process.env, { soloLectura });
    const clave = `${archivo}|${scopes.join(' ')}`;
    if (!clientesDelegados.has(clave)) {
        const pca = graphAuth.crearClientePublico(process.env, archivo);
        clientesDelegados.set(clave, Client.init({
            authProvider: (done) => graphAuth.tokenDelegado(pca, scopes, correo).then(t => done(null, t), e => done(e, null))
        }));
    }
    return clientesDelegados.get(clave);
}

/**
 * Buzón del .env (GRAPH_NOC_MAILBOX, o la sesión de graph-login.js sin --buzon):
 * todo entra a General. Se usa mientras la tabla Buzon está vacía.
 */
function buzonLegado(env = process.env) {
    return { id: null, correo: env.GRAPH_NOC_MAILBOX || null, area_codigo: 'GENERAL', subgrupo_id: null, activo: true, solo_lectura: false, legado: true };
}

const soloLecturaDe = (buzon) => graphAuth.soloLectura() || buzon.solo_lectura === true;
const archivoEstadoDe = (buzon) => (buzon.legado ? graphAuth.archivoEstado() : graphAuth.archivoEstadoBuzon(buzon.correo, buzon.carpeta));

/** Cliente de Graph y ruta de un buzón: { client, ruta }, o null si falta configurar. */
function conexion(buzon) {
    if (graphAuth.modo() === 'delegado') {
        // Una sesión por cuenta (la comparten sus carpetas); sirve la de graph-login.js sin --buzon si es de esa cuenta
        const archivo = buzon.legado
            ? graphAuth.archivoSesion()
            : graphAuth.sesionDeCuenta(buzon.correo) || graphAuth.archivoSesionBuzon(buzon.correo);
        const client = clienteDelegado(archivo, { soloLectura: soloLecturaDe(buzon), correo: buzon.legado ? null : buzon.correo });
        return client ? { client, ruta: '/me' } : null;
    }
    const client = clienteAplicacion();
    const ruta = buzon.legado ? graphAuth.rutaBuzon() : `/users/${encodeURIComponent(buzon.correo)}`;
    return client && ruta ? { client, ruta } : null;
}

// Buzones que cuentan: los que no están en la papelera
const FUERA_DE_PAPELERA = { eliminado_en: null };

/**
 * Buzones a revisar: los activos de la tabla (fuera de la papelera); si no hay
 * ninguno fuera de la papelera (o la tabla aún no existe), el del .env.
 */
async function buzonesActivos(db = prisma) {
    try {
        const lista = await db.buzon.findMany({ where: { activo: true, ...FUERA_DE_PAPELERA }, orderBy: [{ correo: 'asc' }, { carpeta: 'asc' }] });
        if (lista.length) return lista;
        if (await db.buzon.count({ where: FUERA_DE_PAPELERA })) return []; // todos desactivados: no se lee ninguno
    } catch (_) {
        avisarUnaVez('⚠️ Tabla Buzon no disponible (¿migración pendiente?): se usa el buzón del .env.');
    }
    return [buzonLegado()];
}

/** Solo lectura, primera vez: se toman los correos que lleguen desde ahora (no se importa lo viejo). */
function marcarInicioLectura(archivo = graphAuth.archivoEstado(), buzon = null) {
    graphAuth.guardarEstado({ desde: new Date().toISOString(), ids: [] }, archivo);
    console.log(`[Graph API] Solo lectura${buzon && buzon.correo ? ` (${etiquetaBuzon(buzon)})` : ''}: se tomarán los correos que lleguen desde ahora.`);
}

// Id de Graph de cada carpeta ("correo|carpeta" → id): se busca por nombre una vez
const carpetasIds = new Map();
const claveCarpeta = (buzon) => `${buzon.correo || ''}|${partesCarpeta(buzon.carpeta).join('/')}`;
const olvidarCarpeta = (buzon) => carpetasIds.delete(claveCarpeta(buzon));
const escaparOData = (v) => String(v).replace(/'/g, "''");

const MAX_CARPETAS = 300;

/**
 * Árbol de carpetas de una cuenta (hasta 4 niveles y MAX_CARPETAS):
 * [{ id, nombre, ruta: 'FTTX/Soporte', correos, sinLeer }].
 */
async function arbolCarpetas(client, ruta) {
    const lista = [];
    async function bajar(api, prefijo, nivel) {
        const r = await client.api(api).select('id,displayName,childFolderCount,totalItemCount,unreadItemCount').top(100).get();
        for (const f of (r && r.value) || []) {
            if (lista.length >= MAX_CARPETAS) return;
            const rutaF = prefijo ? `${prefijo}/${f.displayName}` : f.displayName;
            lista.push({ id: f.id, nombre: f.displayName, ruta: rutaF, correos: f.totalItemCount || 0, sinLeer: f.unreadItemCount || 0 });
            if (f.childFolderCount && nivel < 3) await bajar(`${ruta}/mailFolders/${f.id}/childFolders`, rutaF, nivel + 1);
        }
    }
    await bajar(`${ruta}/mailFolders`, '', 0);
    return lista;
}

/** Carpetas de una cuenta para elegir en Administración (usa su sesión o el secreto de la app). */
async function listarCarpetas(correo) {
    const c = conexion({ correo, carpeta: '' });
    if (!c) throw new Error('Falta configurar el correo (Graph) en el .env');
    return (await arbolCarpetas(c.client, c.ruta)).map(({ ruta, correos, sinLeer }) => ({ ruta, correos, sinLeer }));
}

/** Id de la carpeta llamada `nombre` dentro de `padre` (o en el primer nivel si `padre` es null), o null. */
async function buscarCarpeta(client, ruta, padre, nombre) {
    const base = padre ? `${ruta}/mailFolders/${padre}/childFolders` : `${ruta}/mailFolders`;
    const r = await client.api(base).filter(`displayName eq '${escaparOData(nombre)}'`).select('id,displayName').get();
    return r && r.value && r.value[0] ? r.value[0].id : null;
}

/**
 * Carpeta de Graph de un buzón: 'inbox' si no tiene. Si no, se busca por nombre:
 * la primera parte dentro de la Bandeja de entrada y, si no está, en el primer
 * nivel; las siguientes ("Soporte/Urgente"), dentro de la anterior.
 */
async function idCarpeta(client, ruta, buzon) {
    const partes = partesCarpeta(buzon.carpeta);
    if (!partes.length) return 'inbox';
    const clave = claveCarpeta(buzon);
    if (carpetasIds.has(clave)) return carpetasIds.get(clave);
    const [primera, ...resto] = partes;
    let id = BANDEJA_RE.test(primera)
        ? 'inbox'
        : (await buscarCarpeta(client, ruta, 'inbox', primera)) || (await buscarCarpeta(client, ruta, null, primera));
    for (const nombre of resto) {
        if (!id) break;
        id = await buscarCarpeta(client, ruta, id, nombre);
    }
    if (!id) {
        // No está en esa ruta: se busca en todo el buzón por su nombre ("SoporteFTTX" encuentra FTTX/SoporteFTTX)
        const buscada = partes.join('/').toLowerCase();
        const iguales = (await arbolCarpetas(client, ruta))
            .filter(f => f.ruta.toLowerCase() === buscada || f.ruta.toLowerCase().endsWith('/' + buscada));
        if (iguales.length > 1) {
            throw new Error(`Hay varias carpetas "${buzon.carpeta}" en ${buzon.correo || 'el buzón'}: escribe la ruta completa, por ejemplo ${iguales.map(f => f.ruta).join(' o ')}`);
        }
        id = iguales.length ? iguales[0].id : null;
    }
    if (!id) throw new Error(`No existe la carpeta "${buzon.carpeta}" en ${buzon.correo || 'el buzón'}. Revisa el nombre en Outlook.`);
    carpetasIds.set(clave, id);
    return id;
}

/** internetMessageId del correo (igual en todos los buzones que lo reciben), o null. */
const correoIdDe = (message) => {
    const id = message && typeof message.internetMessageId === 'string' ? message.internetMessageId.trim() : '';
    return id ? id.slice(0, 250) : null;
};

/** ¿Ya se guardó este correo (como ticket o mensaje)? Un correo en copia a dos buzones llega dos veces. */
async function yaProcesado(correoId, db = prisma) {
    if (!correoId) return false;
    const [ticket, mensaje] = await Promise.all([
        db.ticket.findFirst({ where: { AND: [{ correo_id: correoId }, db.INCLUDE_DELETED] }, select: { id: true } }),
        db.mensaje.findFirst({ where: { correo_id: correoId }, select: { id: true } })
    ]);
    return Boolean(ticket || mensaje);
}

/**
 * Un correo: respuesta a un ticket (INC-xxx en el asunto) o ticket nuevo en el
 * área y subgrupo del buzón. Devuelve 'nuevo', 'respuesta', 'repetido' o 'eliminado'.
 * `cargarReglas` da las reglas de prioridad (se cargan una vez por lote).
 */
async function procesarCorreo(message, buzon, cargarReglas, db = prisma) {
    const correoId = correoIdDe(message);
    if (await yaProcesado(correoId, db)) return 'repetido';

    // 1. Código de incidencia: el del asunto ("INC-XXX") o uno nuevo
    const match = String(message.subject || '').match(/INC-\d+/i);
    const codigoIncidencia = match ? match[0].toUpperCase() : await getNextTicketCode(db);

    // 2. Sumar el correo a la conversación si el ticket ya existe
    const existe = await db.ticket.findUnique({ where: { codigo_incidencia: codigoIncidencia } });
    if (existe && !existe.eliminado_en) {
        // Si lo escribió alguien del portal (respondió desde su correo con el buzón en copia),
        // es una respuesta enviada; si no, es el cliente
        const autor = await autorDelPortal(message, db);
        if (autor) await registrarRespuestaOperador(existe, message, autor, db);
        else await registrarRespuestaCliente(existe, message, db);
        return 'respuesta';
    }
    if (existe) return 'eliminado';

    // 3. Ticket nuevo en el área (y subgrupo) del buzón. Prioridad sugerida por palabras clave
    // (Administración → Reglas); el operador la confirma al tomarlo
    const reglas = await cargarReglas();
    const sugerida = sugerirPrioridad(`${message.subject || ''} ${message.bodyPreview || ''} ${message.from?.emailAddress?.address || ''}`, reglas || undefined);
    const destino = destinoDeBuzon(buzon);
    try {
        await db.ticket.create({
            data: {
                codigo_incidencia: codigoIncidencia,
                asunto: message.subject,
                descripcion: message.bodyPreview,
                origen_ingesta: 'CORREO',
                remitente: message.from.emailAddress.address,
                estado_actual: 'NUEVO',
                area_designada: destino.area_designada,
                ...(destino.subgrupo_id ? { subgrupo_id: destino.subgrupo_id } : {}),
                ...(buzon.id ? { buzon_id: buzon.id } : {}),
                ...(correoId ? { correo_id: correoId } : {}),
                prioridad_sugerida: sugerida
            }
        });
    } catch (error) {
        // Otro buzón guardó el mismo correo al mismo tiempo
        if (error.code === 'P2002' && String(error.meta?.target || '').includes('correo_id')) return 'repetido';
        throw error;
    }
    return 'nuevo';
}

/** Lee un lote de correos nuevos de un buzón y los procesa. Devuelve cuántos trajo la consulta; lanza si Graph falla. */
async function leerLote(buzon) {
    const c = conexion(buzon);
    if (!c) return 0;
    const { client, ruta } = c;

    const soloLectura = soloLecturaDe(buzon);
    const archivoEstado = archivoEstadoDe(buzon);
    let estado = null;
    if (soloLectura) {
        // Solo lectura: no se marca nada en el buzón; se recuerda hasta qué correo se leyó
        estado = graphAuth.leerEstado(archivoEstado);
        if (!estado) { marcarInicioLectura(archivoEstado, buzon); return 0; }
    }
    let consulta = client.api(`${ruta}/mailFolders/${await idCarpeta(client, ruta, buzon)}/messages`);
    consulta = soloLectura
        ? consulta.filter(`receivedDateTime ge ${estado.desde}`).orderby('receivedDateTime asc')
        : consulta.filter('isRead eq false');
    let messages;
    try {
        messages = await consulta
            .top(LOTE)
            .select('id,internetMessageId,subject,body,bodyPreview,from,toRecipients,receivedDateTime')
            .get();
    } catch (error) {
        // La carpeta se borró o renombró en Outlook: se vuelve a buscar en la próxima vuelta
        if (error.statusCode === 404) olvidarCarpeta(buzon);
        throw error;
    }

    if (!messages.value || messages.value.length === 0) {
        return 0; // No hay correos nuevos
    }
    // Las reglas de prioridad se cargan una vez por lote, no por correo
    let reglas;
    const cargarReglas = async () => {
        if (reglas === undefined) reglas = (await loadConfig(prisma).catch(() => null))?.reglas || null;
        return reglas;
    };

    for (const message of messages.value) {
        if (soloLectura && estado.ids.includes(message.id)) continue; // ya procesado
        console.log(`[Graph API] Procesando correo${buzon.correo ? ` (${etiquetaBuzon(buzon)})` : ''}: ${message.subject}`);
        await procesarCorreo(message, buzon, cargarReglas);

        // Que no se vuelva a procesar: avanzar la marca (solo lectura) o marcarlo como leído
        if (soloLectura) {
            estado = graphAuth.avanzarEstado(estado, message);
            graphAuth.guardarEstado(estado, archivoEstado);
        } else {
            await client
                .api(`${ruta}/messages/${message.id}`)
                .patch({ isRead: true });
        }
    }
    return messages.value.length;
}

/**
 * Lee un lote de correos nuevos (del buzón del .env si no se indica otro) y los
 * convierte en tickets. Devuelve cuántos correos trajo la consulta (0 si falla).
 */
async function procesarCorreosEntrantes(buzon = buzonLegado()) {
    try {
        return await leerLote(buzon);
    } catch (error) {
        console.error('❌ Error al procesar correos desde Graph API:', error.message);
        return 0;
    }
}

// Última revisión anotada por buzón (para no escribir en la tabla cada 30 s)
const anotado = new Map();

/** Anota en la tabla la última revisión y su error (cada ANOTAR_CADA_MS, o enseguida si el error cambió). */
async function anotarRevision(buzon, error, db = prisma, ahora = new Date()) {
    if (!buzon || !buzon.id) return false;
    const ultimoError = textoError(error);
    const previo = anotado.get(buzon.id)
        || { t: buzon.ultima_revision ? new Date(buzon.ultima_revision).getTime() : 0, error: buzon.ultimo_error || null };
    if (previo.error === ultimoError && ahora.getTime() - previo.t < ANOTAR_CADA_MS) return false;
    anotado.set(buzon.id, { t: ahora.getTime(), error: ultimoError });
    try {
        await db.buzon.update({ where: { id: buzon.id }, data: { ultima_revision: ahora, ultimo_error: ultimoError } });
        return true;
    } catch (e) {
        console.error(`No se pudo anotar la revisión de ${buzon.correo}:`, e.message);
        return false;
    }
}

/** Revisa un buzón: lotes seguidos mientras vengan llenos. Devuelve el error (o null si fue bien). */
async function revisarUno(buzon) {
    try {
        for (let i = 0; i < LOTES_POR_VUELTA; i++) {
            if (await leerLote(buzon) < LOTE) break;
        }
        return null;
    } catch (error) {
        console.error(`❌ Error al procesar correos de ${buzon.correo ? etiquetaBuzon(buzon) : 'el buzón'}:`, error.message);
        return error;
    }
}

let revisando = false;

/**
 * Una vuelta por los buzones activos, uno tras otro: uno con error no detiene a
 * los demás (su error queda en Administración → Buzones). Si la vuelta anterior
 * sigue en curso, no se encima.
 */
async function revisarBuzones() {
    if (revisando) return;
    revisando = true;
    try {
        for (const buzon of await buzonesActivos()) {
            await anotarRevision(buzon, await revisarUno(buzon));
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
            ...(correoIdDe(message) ? { correo_id: correoIdDe(message) } : {}),
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
            ...(correoIdDe(message) ? { correo_id: correoIdDe(message) } : {}),
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

/** Buzón desde el que se responde un ticket (ver buzonParaResponder); sin buzones en la tabla, el del .env. */
async function buzonDeRespuesta(ticket, db = prisma) {
    try {
        if (await db.buzon.count({ where: FUERA_DE_PAPELERA }) === 0) return buzonLegado();
        return buzonParaResponder(ticket, await db.buzon.findMany({ where: { activo: true, ...FUERA_DE_PAPELERA } }));
    } catch (_) {
        return buzonLegado(); // tabla Buzon aún sin migrar
    }
}

/**
 * Envía la respuesta del operador desde el buzón por donde llegó el ticket.
 * Devuelve { enviado: true } o { enviado: false, configurado: false } si falta configurar Graph.
 * Si Graph está configurado y falla, lanza el error.
 */
async function enviarCorreo({ para, asunto, texto, adjuntos = [], ticket = null }) {
    const buzon = await buzonDeRespuesta(ticket);
    if (!buzon) return { enviado: false, configurado: false };
    if (soloLecturaDe(buzon)) return { enviado: false, configurado: false, soloLectura: true };
    const c = conexion(buzon);
    if (!c) return { enviado: false, configurado: false };
    const destino = extraerCorreo(para);
    if (!destino) throw new Error('Destinatario no válido');
    await c.client.api(`${c.ruta}/sendMail`).post({
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
 * Revisa los buzones al arrancar y luego cada GRAPH_INTERVALO_SEGUNDOS (30 s por defecto)
 */
function iniciarIngesta() {
    const cada = intervaloSegundos();
    console.log(`✅ Servicio de Ingesta Automática (Graph API) preparado (modo ${graphAuth.modo()}${graphAuth.soloLectura() ? ', solo lectura' : ''}, cada ${cada} s).`);

    revisarBuzones();
    setInterval(revisarBuzones, cada * 1000);
}

module.exports = {
    iniciarIngesta,
    procesarCorreosEntrantes,
    procesarCorreo,
    revisarBuzones,
    revisarBuzon: revisarBuzones,
    buzonesActivos,
    listarCarpetas,
    buzonDeRespuesta,
    anotarRevision,
    intervaloSegundos,
    registrarRespuestaCliente,
    registrarRespuestaOperador,
    autorDelPortal,
    enviarCorreo
};
