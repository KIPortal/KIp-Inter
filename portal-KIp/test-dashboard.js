const prisma = require('./src/config/prisma');

async function test() {
    try {
        const ticketRelations = {
            asignado_a: { select: { id: true, nombre: true, email: true, rol: true, area_designada: true, estado_operativo: true } },
            creado_por: { select: { nombre: true, email: true } }
        };

        const tickets = await prisma.ticket.findMany({
            include: ticketRelations,
            orderBy: { createdAt: 'desc' },
            take: 1
        });
        console.log("tickets ok");
        
        const operadoresTurno = await prisma.user.findMany({
            where: { rol: 'OPERADOR' },
            select: {
                id: true,
                email: true,
                nombre: true,
                rol: true,
                area_designada: true,
                estado_operativo: true,
                tickets_asignados: {
                    where: { estado_actual: { in: ['ASIGNADO', 'EN_PROGRESO', 'EN_PAUSA', 'EN_ESPERA_TERCEROS'] } },
                    select: { codigo_incidencia: true, estado_actual: true },
                    orderBy: { createdAt: 'desc' }
                }
            },
            orderBy: { nombre: 'asc' },
            take: 1
        });
        console.log("operadoresTurno ok");

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
test();
