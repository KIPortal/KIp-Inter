/**
 * Borra SOLO los datos de simulación (tickets SIM-xxx, usuarios @demo.local con su
 * horario y guardia, y el traspaso simulado) y los quita del registro de jornadas.
 *   node scripts/limpiar-simulacion.js --confirmar
 */
const prisma = require('../src/config/prisma');
const { PREFIJO_CODIGO, DOMINIO_DEMO, MARCA_REMITENTE } = require('../src/services/simulationService');
const { depurarRegistros } = require('../src/services/jornadaRegistroService');

(async () => {
    if (!process.argv.includes('--confirmar')) {
        console.log('Esto borra los tickets SIM-xxx y los usuarios @' + DOMINIO_DEMO + '. Repita con --confirmar para continuar.');
        process.exit(0);
    }
    // Traspasos simulados (la nota empieza con la marca); sus filas TraspasoTicket se borran en cascada
    const traspasos = await prisma.traspaso.deleteMany({ where: { nota: { startsWith: MARCA_REMITENTE } } }).catch(() => ({ count: 0 }));
    const tickets = await prisma.ticket.findMany({ where: { ...prisma.INCLUDE_DELETED, codigo_incidencia: { startsWith: PREFIJO_CODIGO } }, select: { id: true } });
    const ids = tickets.map(t => t.id);
    if (ids.length) {
        await prisma.adjunto.deleteMany({ where: { ticketId: { in: ids } } });
        await prisma.auditLog.deleteMany({ where: { ticketId: { in: ids } } });
        await prisma.ticket.deleteMany({ where: { id: { in: ids } } });
    }
    const demo = await prisma.user.findMany({ where: { email: { endsWith: '@' + DOMINIO_DEMO } }, select: { id: true } });
    // Registro de jornadas: quitar la simulación de las fotos guardadas
    const jornadas = await depurarRegistros(prisma, { prefijoCodigo: PREFIJO_CODIGO, operadorIds: demo.map(u => u.id) })
        .catch(e => { console.error('No se pudo depurar el registro de jornadas:', e.message); return 0; });
    const users = await prisma.user.deleteMany({ where: { email: { endsWith: '@' + DOMINIO_DEMO } } });
    console.log(`Eliminados ${ids.length} tickets, ${users.count} usuarios y ${traspasos.count} traspasos de simulación; ${jornadas} jornadas registradas depuradas.`);
    await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
