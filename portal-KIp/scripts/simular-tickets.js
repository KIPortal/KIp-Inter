/**
 * Simulación SOLO de tickets: no crea, cambia ni borra operadores (ni estados, horarios,
 * guardias, áreas o subgrupos). Solo lee quiénes atienden tickets y les reparte los tickets.
 *
 *   node scripts/simular-tickets.js                          → ayer completo + hoy hasta ahora (55 por día)
 *   node scripts/simular-tickets.js --fecha=2026-10-12 --tickets=40   → un solo día
 *   --sin-asignar=30  deja ese % de los tickets de hoy en la cola de su área (por defecto 7)
 *   --seed=7          cambia el reparto aleatorio
 *
 * Los tickets quedan marcados (códigos SIM-xxx, remitente SIMULACION).
 * Para borrarlos: node scripts/limpiar-simulacion.js --confirmar (no toca a sus operadores).
 */
const prisma = require('../src/config/prisma');
const { buildSimulation, buildDemo, asignarAReales, cargarTiposCaso, MARCA_REMITENTE, PREFIJO_CODIGO } = require('../src/services/simulationService');
const { ATIENDE_WHERE } = require('../src/services/roleService');

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };

(async () => {
    const seed = Number(arg('seed', 7));
    const fecha = arg('fecha');
    const sinAsignar = Math.min(Math.max(Number(arg('sin-asignar', 7)) || 0, 0), 100);
    // Casos comunes del catálogo (Administración → Tipos de caso): cada área con tipos simula sus casos
    const tipos = await cargarTiposCaso(prisma);
    const dias = fecha
        ? [{ fecha, tickets: buildSimulation({ fecha, cantidad: Number(arg('tickets', 40)), seed, sinAsignar, tipos }).tickets }]
        : buildDemo({ ahora: new Date(), porDia: Number(arg('tickets', 55)), seed, sinAsignar, tipos }).dias;

    const existentes = await prisma.ticket.count({ where: { ...prisma.INCLUDE_DELETED, codigo_incidencia: { startsWith: PREFIJO_CODIGO } } });
    if (existentes) { console.error('Ya hay una simulación cargada. Ejecute primero: node scripts/limpiar-simulacion.js --confirmar'); process.exit(1); }

    // Solo lectura de usuarios: los operadores activos que atienden tickets
    const ops = await prisma.user.findMany({ where: { AND: [ATIENDE_WHERE, { activo: true }, { NOT: { email: { endsWith: '@demo.local' } } }] }, select: { id: true, nombre: true, area_designada: true, subgrupo_id: true } });
    if (!ops.length) { console.error('No hay operadores activos que atiendan tickets. Créelos en Administración.'); process.exit(1); }

    for (const d of dias) {
        const tickets = asignarAReales(d.tickets, ops);
        for (const t of tickets) {
            await prisma.ticket.create({
                data: {
                    codigo_incidencia: t.codigo, asunto: t.asunto, remitente: MARCA_REMITENTE,
                    descripcion: 'Ticket generado por la simulación de tickets',
                    estado_actual: t.estado, puntos_complejidad: t.puntos, prioridad: t.prioridad === 'NONE' ? null : t.prioridad, nivel: t.nivel, tipo_caso_id: t.tipoId || null, area_designada: t.area, estado_ve: t.estadoVe ?? null,
                    origen_ingesta: 'CORREO', asignado_a_id: t.operadorId, subgrupo_id: t.subgrupoId,
                    createdAt: t.creado, fecha_asignacion: t.asignado, resueltoEn: t.resuelto, fecha_cierre: t.cierre
                }
            });
        }
        console.log(`Jornada ${d.fecha}: ${tickets.length} tickets, ${tickets.filter(t => !t.operadorId).length} en cola sin asignar.`);
    }
    console.log(`Repartidos entre ${ops.length} operadores (sin modificarlos). Limpieza: node scripts/limpiar-simulacion.js --confirmar`);
    await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
