// Pruebas de la conversación del ticket (pestaña Conversación del detalle del operador):
// armado del hilo, permisos, envío de respuestas y notas, "enviar y esperar" y
// correos del cliente que llegan a un ticket existente. Sin base de datos: prisma se simula.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const prisma = require('../src/config/prisma');
const conv = require('../src/services/conversationService');
const ctrl = require('../src/controllers/conversationController');
const { registrarRespuestaCliente } = require('../src/services/emailIngestionService');

let total = 0, passed = 0;
async function t(name, fn) {
    total++;
    try { await fn(); passed++; console.log(`  ✅ [PASS] ${name}`); }
    catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.message}`); }
}
function mockRes() {
    const r = { code: 200, body: null };
    r.status = c => { r.code = c; return r; };
    r.json = b => { r.body = b; return r; };
    return r;
}

const NOW = new Date('2026-10-14T16:00:00Z'); // 12:00 en Caracas
const OP = { id: 'op1', rol: 'OPERADOR', nombre: 'Ana', area_designada: 'WAN' };
const OTRO = { id: 'op2', rol: 'OPERADOR', nombre: 'Luis', area_designada: 'SEGURIDAD' };
const COORD = { id: 'c1', rol: 'COORDINADOR', nombre: 'Coord' };
const baseTicket = (extra) => ({
    id: 't1', codigo_incidencia: 'INC-007', asunto: 'Sin servicio en Los Ruices', descripcion: 'No hay internet desde las 8.',
    remitente: 'Cliente Uno <cliente@empresa.com>', origen_ingesta: 'CORREO', area_designada: 'WAN',
    estado_actual: 'EN_PROGRESO', asignado_a_id: 'op1', eliminado_en: null,
    createdAt: new Date('2026-10-14T13:05:00Z'),
    adjuntos: [{ nombre_original: 'foto.jpg', ruta: '/uploads/1-foto.jpg', peso: 2048, mensajeId: null }, { nombre_original: 'resp.pdf', ruta: '/uploads/2-resp.pdf', mensajeId: 'm2' }],
    ...extra
});

let store;
function setup(ticket) {
    store = { ticket, mensajes: [], audits: [], updates: [] };
    prisma.ticket.findUnique = async () => store.ticket && { ...store.ticket };
    prisma.ticket.updateMany = async ({ where, data }) => {
        const tk = store.ticket;
        const ok = tk && tk.id === where.id && (!where.estado_actual || (where.estado_actual.in ? where.estado_actual.in.includes(tk.estado_actual) : where.estado_actual === tk.estado_actual));
        if (ok) { Object.assign(tk, data); store.updates.push(data); }
        return { count: ok ? 1 : 0 };
    };
    prisma.mensaje = {
        findMany: async () => store.mensajes.map(m => ({ ...m, autor: m.autor_id === 'op1' ? { id: 'op1', nombre: 'Ana' } : null, adjuntos: m.adjuntos || [] })),
        create: async ({ data }) => {
            const m = { id: 'm' + (store.mensajes.length + 1), createdAt: new Date(), ...data, adjuntos: data.adjuntos ? data.adjuntos.create : [] };
            store.mensajes.push(m);
            return m;
        }
    };
    prisma.auditLog = {
        findMany: async () => store.audits.map(a => ({ ...a, user: a.userId ? { nombre: 'Ana' } : null })),
        create: async ({ data }) => { store.audits.push({ id: 'a' + store.audits.length, createdAt: new Date(), ...data }); }
    };
}

(async () => {
    console.log('\n=== PRUEBAS: CONVERSACIÓN DEL TICKET ===\n');

    await t('Hora en Caracas: hoy, ayer y otra fecha', async () => {
        assert.strictEqual(conv.formatHora(new Date('2026-10-14T15:41:00Z'), NOW), 'Hoy 11:41');
        assert.strictEqual(conv.formatHora(new Date('2026-10-14T03:30:00Z'), NOW), 'Ayer 23:30');
        assert.strictEqual(conv.formatHora(new Date('2026-10-02T20:20:00Z'), NOW), '2 oct 16:20');
    });

    await t('Validación: tipo, texto vacío o largo, esperar solo con respuesta', async () => {
        assert(conv.validarMensaje({ tipo: 'x', texto: 'hola' }).error);
        assert(conv.validarMensaje({ tipo: 'out', texto: '   ' }).error);
        assert(conv.validarMensaje({ tipo: 'out', texto: 'a'.repeat(conv.MAX_TEXTO + 1) }).error);
        assert(conv.validarMensaje({ tipo: 'note', texto: 'nota', esperar: 'true' }).error);
        assert.deepStrictEqual(conv.validarMensaje({ tipo: 'out', texto: ' hola ', esperar: 'true' }), { tipo: 'SALIENTE', texto: 'hola', esperar: true });
        assert.strictEqual(conv.validarMensaje({ tipo: 'NOTA', texto: 'x' }).tipo, 'NOTA');
    });

    await t('Adjuntos: máximo por mensaje y 3 MB en un correo', async () => {
        assert(conv.validarAdjuntos(new Array(6).fill({ size: 1 }), 'NOTA'));
        assert(conv.validarAdjuntos([{ size: 4 * 1024 * 1024 }], 'SALIENTE'));
        assert.strictEqual(conv.validarAdjuntos([{ size: 4 * 1024 * 1024 }], 'NOTA'), null);
    });

    await t('Permisos: ver y escribir', async () => {
        const nuevo = baseTicket({ estado_actual: 'NUEVO', asignado_a_id: null });
        assert(conv.puedeVer(nuevo, OP), 'sin tomar en su área');
        assert(!conv.puedeVer(nuevo, OTRO), 'otra área');
        assert(conv.puedeVer({ ...nuevo, area_designada: 'GENERAL' }, OTRO), 'área general');
        assert(!conv.puedeVer(baseTicket({ asignado_a_id: 'op9' }), OP), 'asignado a otro');
        assert(conv.puedeVer(baseTicket(), COORD));
        assert.strictEqual(conv.motivoNoEscribir(nuevo, OP), 'Toma el ticket para responder o dejar notas');
        assert.strictEqual(conv.motivoNoEscribir(baseTicket(), OP), null);
        assert(conv.motivoNoEscribir(baseTicket({ estado_actual: 'CERRADO' }), OP).startsWith('Ticket cerrado'));
        assert(conv.motivoNoEscribir(baseTicket(), COORD));
        assert.strictEqual(conv.motivoNoEscribir(baseTicket({ estado_actual: 'RESUELTO' }), OP), null);
    });

    await t('Hilo: correo inicial, mensajes y eventos en orden; el contador no cuenta eventos', async () => {
        const c = conv.buildConversation({
            ticket: baseTicket({ estado_actual: 'EN_ESPERA_TERCEROS' }),
            mensajes: [
                { id: 'm2', tipo: 'SALIENTE', texto: 'Ya lo revisamos', autor_id: 'op1', autor: { nombre: 'Ana' }, enviado: true, para: 'cliente@empresa.com', createdAt: new Date('2026-10-14T15:00:00Z'), adjuntos: [{ nombre_original: 'resp.pdf', ruta: '/uploads/2-resp.pdf' }] },
                { id: 'm1', tipo: 'NOTA', texto: 'Conector sucio', autor_id: 'op3', autor: { nombre: 'Luis' }, createdAt: new Date('2026-10-14T14:00:00Z') }
            ],
            logs: [
                { id: 'l1', accion: 'TICKET_TOMADO', user: { nombre: 'Ana' }, createdAt: new Date('2026-10-14T13:30:00Z') },
                { id: 'l2', accion: 'TICKET_EN_ESPERA', createdAt: new Date('2026-10-14T15:00:01Z') },
                { id: 'l3', accion: 'TICKET_EDITADO', createdAt: new Date('2026-10-14T15:10:00Z') }
            ],
            viewer: OP, now: NOW
        });
        assert.deepStrictEqual(c.items.map(i => i.k), ['in', 'sys', 'note', 'out', 'sys']);
        assert.strictEqual(c.total, 3);
        assert.strictEqual(c.items[0].quien, 'Cliente Uno <cliente@empresa.com>');
        assert.deepStrictEqual(c.items[0].adjuntos.map(a => a.nombre), ['foto.jpg'], 'el adjunto de un mensaje no va en el correo inicial');
        assert.strictEqual(c.items[1].texto, 'Tomado por Ana');
        assert.strictEqual(c.items[2].quien, 'Luis');
        assert.strictEqual(c.items[2].meta, 'Nota interna · solo el equipo');
        assert.strictEqual(c.items[3].quien, 'Tú');
        assert.strictEqual(c.items[3].hora, 'Hoy 11:00');
        assert.strictEqual(c.items[4].texto, 'Pasó a Espera de terceros');
        assert.strictEqual(c.para, 'cliente@empresa.com');
        assert.strictEqual(c.asunto, 'Re: [INC-007] Sin servicio en Los Ruices');
        assert(c.esperando && c.esperaTexto.includes('desde 11:00'));
        assert.strictEqual(c.plantillas.length, 3);
    });

    await t('Hilo: correo no enviado se marca; rutas ajenas no se enlazan', async () => {
        const c = conv.buildConversation({
            ticket: baseTicket({ adjuntos: [{ nombre_original: 'x', ruta: 'https://malo.com/x', mensajeId: null }] }),
            mensajes: [{ id: 'm1', tipo: 'SALIENTE', texto: 'hola', autor_id: 'op1', enviado: false, createdAt: NOW }],
            viewer: OP, now: NOW
        });
        assert(/no enviado/i.test(c.items[1].meta));
        assert.strictEqual(c.items[0].adjuntos[0].url, null);
    });

    await t('Ticket sin tomar: se ve, no se escribe; sin correo no se puede esperar', async () => {
        const c = conv.buildConversation({ ticket: baseTicket({ estado_actual: 'NUEVO', asignado_a_id: null, remitente: null }), viewer: OP, now: NOW });
        assert.strictEqual(c.puedeEscribir, false);
        assert.strictEqual(c.puedeEsperar, false);
        assert.strictEqual(c.motivoNoEscribir, 'Toma el ticket para responder o dejar notas');
        assert.strictEqual(c.para, null);
        assert.strictEqual(c.total, 1);
    });

    await t('Texto de un correo HTML de Graph', async () => {
        const txt = conv.textoDeCorreo({ body: { contentType: 'html', content: '<html><style>p{}</style><p>Hola&nbsp;equipo</p><div>Sigue <b>caído</b><br>Gracias</div></html>' } });
        assert.strictEqual(txt, 'Hola equipo\nSigue caído\nGracias');
        assert.strictEqual(conv.textoDeCorreo({ bodyPreview: 'vista previa' }), 'vista previa');
    });

    await t('GET conversación: 404, 403 para otra área y datos para el asignado', async () => {
        setup(null);
        let res = mockRes();
        await ctrl.getConversation({ params: { ticketCode: 'INC-404' }, user: OP }, res);
        assert.strictEqual(res.code, 404);
        setup(baseTicket({ estado_actual: 'NUEVO', asignado_a_id: null }));
        res = mockRes();
        await ctrl.getConversation({ params: { ticketCode: 'INC-007' }, user: OTRO }, res);
        assert.strictEqual(res.code, 403);
        setup(baseTicket());
        res = mockRes();
        await ctrl.getConversation({ params: { ticketCode: 'INC-007' }, user: OP }, res);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(res.body.conversacion.puedeEscribir, true);
        setup(baseTicket({ eliminado_en: new Date() }));
        res = mockRes();
        await ctrl.getConversation({ params: { ticketCode: 'INC-007' }, user: COORD }, res);
        assert.strictEqual(res.code, 404, 'un ticket en la papelera no se muestra');
    });

    await t('POST nota interna: se guarda con autor y adjuntos', async () => {
        setup(baseTicket());
        const res = mockRes();
        await ctrl.postMessage({ params: { ticketCode: 'INC-007' }, user: OP, body: { tipo: 'note', texto: 'Revisé el splitter' },
            files: [{ originalname: 'medicion.png', filename: '9-medicion.png', path: '/nope/9-medicion.png', size: 10, mimetype: 'image/png' }] }, res);
        assert.strictEqual(res.body.success, true, res.body.error);
        const m = store.mensajes[0];
        assert.strictEqual(m.tipo, 'NOTA');
        assert.strictEqual(m.autor_id, 'op1');
        assert.strictEqual(m.adjuntos[0].ruta, '/uploads/9-medicion.png');
        assert.strictEqual(m.adjuntos[0].ticketId, 't1');
        assert.strictEqual(res.body.conversacion.total, 2);
        assert.strictEqual(store.updates.length, 0, 'una nota no cambia el estado');
    });

    await t('POST respuesta sin envío configurado: se guarda como no enviada y avisa', async () => {
        setup(baseTicket());
        const res = mockRes();
        await ctrl.postMessage({ params: { ticketCode: 'INC-007' }, user: OP, body: { tipo: 'out', texto: 'Ya lo revisamos' } }, res);
        assert.strictEqual(res.body.success, true, res.body.error);
        assert.strictEqual(res.body.enviado, false);
        assert(res.body.aviso);
        assert.strictEqual(store.mensajes[0].para, 'cliente@empresa.com');
    });

    await t('POST enviar y esperar: pasa a Espera de terceros y audita', async () => {
        setup(baseTicket());
        const res = mockRes();
        await ctrl.postMessage({ params: { ticketCode: 'INC-007' }, user: OP, body: { tipo: 'out', texto: 'Necesitamos la dirección', esperar: 'true' } }, res);
        assert.strictEqual(res.body.success, true, res.body.error);
        assert.strictEqual(res.body.estado, 'EN_ESPERA_TERCEROS');
        assert.strictEqual(store.ticket.estado_actual, 'EN_ESPERA_TERCEROS');
        assert.strictEqual(store.audits[0].accion, 'TICKET_EN_ESPERA');
        assert.strictEqual(res.body.conversacion.esperando, true);
    });

    await t('POST: rechazos (sin tomar, asignado a otro, sin empezar, sin correo, tipo inválido)', async () => {
        setup(baseTicket({ estado_actual: 'NUEVO', asignado_a_id: null }));
        let res = mockRes();
        await ctrl.postMessage({ params: { ticketCode: 'INC-007' }, user: OP, body: { tipo: 'note', texto: 'x' } }, res);
        assert.strictEqual(res.code, 403);
        setup(baseTicket({ asignado_a_id: 'op2' }));
        res = mockRes();
        await ctrl.postMessage({ params: { ticketCode: 'INC-007' }, user: OP, body: { tipo: 'note', texto: 'x' } }, res);
        assert.strictEqual(res.code, 403);
        setup(baseTicket({ estado_actual: 'NUEVO' }));
        res = mockRes();
        await ctrl.postMessage({ params: { ticketCode: 'INC-007' }, user: OP, body: { tipo: 'out', texto: 'x', esperar: 'true' } }, res);
        assert.strictEqual(res.code, 409);
        setup(baseTicket({ remitente: 'Llamada de la sede' }));
        res = mockRes();
        await ctrl.postMessage({ params: { ticketCode: 'INC-007' }, user: OP, body: { tipo: 'out', texto: 'x' } }, res);
        assert.strictEqual(res.code, 400);
        res = mockRes();
        await ctrl.postMessage({ params: { ticketCode: 'INC-007' }, user: OP, body: { tipo: 'otro', texto: 'x' } }, res);
        assert.strictEqual(res.code, 400);
        assert.strictEqual(store.mensajes.length, 0);
    });

    await t('Correo del cliente sobre un ticket en espera: entra al hilo y vuelve a En atención', async () => {
        setup(baseTicket({ estado_actual: 'EN_ESPERA_TERCEROS' }));
        const reanudo = await registrarRespuestaCliente(store.ticket, {
            from: { emailAddress: { address: 'cliente@empresa.com' } }, receivedDateTime: '2026-10-14T15:30:00Z',
            body: { contentType: 'text', content: 'La dirección es Av. Principal' }
        });
        assert.strictEqual(reanudo, true);
        assert.strictEqual(store.mensajes[0].tipo, 'ENTRANTE');
        assert.strictEqual(store.mensajes[0].de, 'cliente@empresa.com');
        assert.strictEqual(store.ticket.estado_actual, 'EN_PROGRESO');
        assert.strictEqual(store.audits[0].accion, 'TICKET_REANUDADO');
        assert.strictEqual(conv.eventoSistema(store.audits[0]), 'Respondió el cliente: vuelve a En atención');
        setup(baseTicket({ estado_actual: 'EN_PAUSA' }));
        assert.strictEqual(await registrarRespuestaCliente(store.ticket, { body: { content: 'hola' } }), false);
        assert.strictEqual(store.ticket.estado_actual, 'EN_PAUSA', 'solo reanuda si esperaba al cliente');
    });

    await t('Vista del operador: pestañas, conversación y estilos del tema', async () => {
        const file = path.join(__dirname, '..', 'views', 'operator-dashboard.ejs');
        const html = ejs.render(fs.readFileSync(file, 'utf8'), { currentUser: OP, ticketsAvailable: [], ticketsAssigned: [], ticketsPaused: [], ticketsWaiting: [], ticketsResolved: [] }, { filename: file });
        ['id="tdTabInfo"', 'id="tdTabThread"', 'id="tdMsgCount"', 'role="log"', 'id="tdSendWait"', 'Nota interna', '/css/ticket-detalle.css', '/js/ticket-conversacion.js', "localStorage.getItem('kip.theme')"]
            .forEach(s => assert(html.includes(s), 'falta ' + s));
        const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'ticket-detalle.css'), 'utf8');
        assert(css.includes('[data-theme=dark] .tdlg-overlay'), 'tema oscuro');
        assert(css.includes('@media (max-width: 640px)'), 'teléfono');
        const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ticket-conversacion.js'), 'utf8');
        assert(!/innerHTML/.test(js), 'el hilo no debe usar innerHTML');
        new Function(js);
    });

    console.log(`\nResultado: ${passed}/${total} pruebas pasaron\n`);
    process.exit(passed === total ? 0 : 1);
})();
