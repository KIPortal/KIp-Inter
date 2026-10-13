// Códigos de ticket INC-xxx: siguiente = mayor número usado + 1.
// Cuenta los eliminados (los códigos nunca se reutilizan) e ignora otros
// prefijos, como los SIM-xxx de la simulación.
const CODE_RE = /^INC-(\d+)$/i;

function nextTicketCode(codigos) {
    const numeros = codigos
        .map(codigo => CODE_RE.exec(String(codigo || '').trim()))
        .filter(Boolean)
        .map(match => Number(match[1]));
    const siguiente = numeros.reduce((max, n) => Math.max(max, n), 0) + 1;
    return `INC-${String(siguiente).padStart(3, '0')}`;
}

async function getNextTicketCode(prisma) {
    const tickets = await prisma.ticket.findMany({
        where: { ...prisma.INCLUDE_DELETED, codigo_incidencia: { startsWith: 'INC-' } },
        select: { codigo_incidencia: true }
    });
    return nextTicketCode(tickets.map(t => t.codigo_incidencia));
}

module.exports = { nextTicketCode, getNextTicketCode };
