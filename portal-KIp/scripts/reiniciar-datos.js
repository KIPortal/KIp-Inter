/**
 * Deja la base lista para empezar desde cero: borra TODOS los tickets (también los de la
 * papelera), adjuntos, auditoría, guardias, horarios y los usuarios OPERADOR.
 * Conserva a los COORDINADORES (para poder entrar al sistema).
 *   node scripts/reiniciar-datos.js --confirmar
 * Luego, opcionalmente, cargue una jornada de demostración con scripts/simular-jornada.js.
 */
const prisma = require('../src/config/prisma');

(async () => {
    if (!process.argv.includes('--confirmar')) {
        const [t, o] = await Promise.all([
            prisma.ticket.count({ where: prisma.INCLUDE_DELETED }),
            prisma.user.count({ where: { rol: 'OPERADOR' } })
        ]);
        console.log(`Se borrarían ${t} tickets y ${o} operadores (los coordinadores se conservan).`);
        console.log('Repita con --confirmar para continuar.');
        process.exit(0);
    }
    const a = await prisma.auditLog.deleteMany({});
    const j = await prisma.adjunto.deleteMany({});
    const g = await prisma.guardiaSemanal.deleteMany({});
    const h = await prisma.horarioOperador.deleteMany({});
    const t = await prisma.ticket.deleteMany({});
    const u = await prisma.user.deleteMany({ where: { rol: 'OPERADOR' } });
    console.log(`Listo: ${t.count} tickets, ${u.count} operadores, ${a.count} auditorías, ${j.count} adjuntos, ${g.count} guardias y ${h.count} horarios eliminados.`);
    console.log('Coordinadores conservados. Siguiente número de ticket: INC-001.');
    await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
