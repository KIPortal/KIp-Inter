/**
 * Borra SOLO los datos de simulación (tickets SIM-xxx y usuarios @demo.local).
 *   node scripts/limpiar-simulacion.js --confirmar
 */
const prisma = require('../src/config/prisma');
const { PREFIJO_CODIGO, DOMINIO_DEMO } = require('../src/services/simulationService');

(async () => {
    if (!process.argv.includes('--confirmar')) {
        console.log('Esto borra los tickets SIM-xxx y los usuarios @' + DOMINIO_DEMO + '. Repita con --confirmar para continuar.');
        process.exit(0);
    }
    const tickets = await prisma.ticket.findMany({ where: { ...prisma.INCLUDE_DELETED, codigo_incidencia: { startsWith: PREFIJO_CODIGO } }, select: { id: true } });
    const ids = tickets.map(t => t.id);
    if (ids.length) {
        await prisma.adjunto.deleteMany({ where: { ticketId: { in: ids } } });
        await prisma.auditLog.deleteMany({ where: { ticketId: { in: ids } } });
        await prisma.ticket.deleteMany({ where: { id: { in: ids } } });
    }
    const users = await prisma.user.deleteMany({ where: { email: { endsWith: '@' + DOMINIO_DEMO } } });
    console.log(`Eliminados ${ids.length} tickets y ${users.count} usuarios de simulación.`);
    await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
