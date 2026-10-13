const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Borrado lógico: todas las lecturas de Ticket ignoran los tickets eliminados
// (eliminado_en != null) salvo que la consulta mencione explícitamente el campo
// "eliminado_en" en su filtro (papelera, generación de códigos INC-xxx, etc.).
const READ_ACTIONS = new Set(['findMany', 'findFirst', 'count', 'groupBy', 'aggregate']);

if (typeof prisma.$use === 'function') {
    prisma.$use(async (params, next) => {
        if (params.model === 'Ticket' && READ_ACTIONS.has(params.action)) {
            const args = params.args || {};
            const where = args.where || {};
            if (!JSON.stringify(where).includes('eliminado_en')) {
                params.args = { ...args, where: { ...where, eliminado_en: null } };
            }
        }
        return next(params);
    });
}

// Filtro para consultas que deben ver TODOS los tickets, incluidos los eliminados
// (por ejemplo, para no reutilizar un código INC-xxx).
prisma.INCLUDE_DELETED = { OR: [{ eliminado_en: null }, { eliminado_en: { not: null } }] };

module.exports = prisma;
