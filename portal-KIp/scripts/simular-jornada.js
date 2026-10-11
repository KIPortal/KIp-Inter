/**
 * Genera una jornada simulada para ver las gráficas y métricas con datos de demostración.
 *   node scripts/simular-jornada.js --fecha=2026-10-12 --tickets=40 [--seed=7]
 * Todo queda marcado (remitente SIMULACION, códigos SIM-xxx, usuarios @demo.local).
 * Para borrarlo: node scripts/limpiar-simulacion.js --confirmar
 * Clave de los operadores demo: demo1234 (solo para pruebas locales).
 */
const prisma = require('../src/config/prisma');
const { buildSimulation, MARCA_REMITENTE, PREFIJO_CODIGO } = require('../src/services/simulationService');
const { formatCaracasDate } = require('../src/services/metricsService');

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };

(async () => {
    const fecha = arg('fecha', formatCaracasDate(new Date()));
    const cantidad = Number(arg('tickets', 40));
    const seed = Number(arg('seed', 7));
    const sim = buildSimulation({ fecha, cantidad, seed, ahora: arg('fecha') ? null : new Date() });

    const existentes = await prisma.ticket.count({ where: { ...prisma.INCLUDE_DELETED, codigo_incidencia: { startsWith: PREFIJO_CODIGO } } });
    if (existentes) { console.error('Ya hay una simulación cargada. Ejecute primero: node scripts/limpiar-simulacion.js --confirmar'); process.exit(1); }

    const ids = {};
    for (const o of sim.operadores) {
        const u = await prisma.user.upsert({
            where: { email: o.email },
            update: {},
            create: { email: o.email, clave: 'demo1234', nombre: o.nombre, rol: 'OPERADOR', area_designada: o.area, estado_operativo: 'DISPONIBLE' }
        });
        ids[o.key] = u.id;
    }
    for (const t of sim.tickets) {
        await prisma.ticket.create({
            data: {
                codigo_incidencia: t.codigo, asunto: t.asunto, remitente: MARCA_REMITENTE,
                descripcion: 'Ticket generado por la simulación de jornada',
                estado_actual: t.estado, puntos_complejidad: t.puntos, area_designada: t.area,
                origen_ingesta: 'CORREO', asignado_a_id: t.operadorKey ? ids[t.operadorKey] : null,
                createdAt: t.creado, fecha_asignacion: t.asignado, resueltoEn: t.resuelto, fecha_cierre: t.cierre
            }
        });
    }
    console.log(`Jornada ${fecha}: ${sim.tickets.length} tickets y ${sim.operadores.length} operadores demo creados.`);
    console.log('Vea Reportes → Jornada con esa fecha. Limpieza: node scripts/limpiar-simulacion.js --confirmar');
    await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
