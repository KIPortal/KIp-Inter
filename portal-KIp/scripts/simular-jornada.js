/**
 * Datos de demostración para ver el portal como en el diseño.
 *
 *   node scripts/simular-jornada.js                       → modo demo: ayer completo + hoy hasta ahora,
 *                                                           14 operadores, guardia y horarios, traspaso de anoche
 *   node scripts/simular-jornada.js --fecha=2026-10-12 --tickets=40 [--seed=7]  → un solo día
 *   Agregue --reales para repartir los tickets entre sus operadores reales (no crea usuarios
 *   demo ni cambia estados, horarios o guardias). Sirve con cualquiera de los dos modos.
 *   --sin-asignar=30 deja ese % de los tickets de hoy en la cola de su área, sin operador
 *   (por defecto 7). Los que llegaron en la última media hora tampoco están asignados aún.
 *
 * Todo queda marcado (remitente SIMULACION, códigos SIM-xxx, usuarios @demo.local).
 * Para borrarlo: node scripts/limpiar-simulacion.js --confirmar
 * Clave de los operadores demo: demo1234 (solo para pruebas locales).
 */
const prisma = require('../src/config/prisma');
const { buildSimulation, buildDemo, asignarAReales, cargarTiposCaso, MARCA_REMITENTE, PREFIJO_CODIGO } = require('../src/services/simulationService');
const { ATIENDE_WHERE } = require('../src/services/roleService');
const { getDayBounds } = require('../src/services/metricsService');
const { getWeekStart } = require('../src/services/shiftService');

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };

(async () => {
    const seed = Number(arg('seed', 7));
    const fecha = arg('fecha');
    const sinAsignar = Math.min(Math.max(Number(arg('sin-asignar', 7)) || 0, 0), 100);
    // Casos comunes del catálogo (Administración → Tipos de caso): cada área con tipos simula sus casos
    const tipos = await cargarTiposCaso(prisma);
    const sim = fecha
        ? (s => ({ operadores: s.operadores, tickets: s.tickets, traspaso: null, dias: [{ fecha, tickets: s.tickets }] }))(buildSimulation({ fecha, cantidad: Number(arg('tickets', 40)), seed, sinAsignar, tipos }))
        : buildDemo({ ahora: new Date(), porDia: Number(arg('tickets', 55)), seed, sinAsignar, tipos });

    const existentes = await prisma.ticket.count({ where: { ...prisma.INCLUDE_DELETED, codigo_incidencia: { startsWith: PREFIJO_CODIGO } } });
    if (existentes) { console.error('Ya hay una simulación cargada. Ejecute primero: node scripts/limpiar-simulacion.js --confirmar'); process.exit(1); }

    // --reales: tickets repartidos entre los operadores reales; no se crean usuarios demo
    const reales = process.argv.includes('--reales');
    if (reales) {
        const ops = await prisma.user.findMany({ where: { AND: [ATIENDE_WHERE, { activo: true }, { NOT: { email: { endsWith: '@demo.local' } } }] }, select: { id: true, nombre: true, area_designada: true, subgrupo_id: true } });
        const repartidos = asignarAReales(sim.tickets, ops);
        if (!repartidos) { console.error('No hay operadores activos que atiendan tickets. Créelos en Administración o quite --reales.'); process.exit(1); }
        sim.tickets = repartidos;
        sim.operadores = [];
        const porArea = {};
        repartidos.forEach(t => { porArea[t.area] = (porArea[t.area] || 0) + 1; });
        console.log(`Repartido entre ${ops.length} operadores reales: ${Object.entries(porArea).map(([a, n]) => `${a} ${n}`).join(', ')}.`);
    }

    // Operadores demo (estado operativo, horario propio y guardia de hoy)
    const ids = {};
    const hoy = getDayBounds(new Date()).start;
    for (const o of sim.operadores) {
        const u = await prisma.user.upsert({
            where: { email: o.email },
            update: { area_designada: o.area, estado_operativo: o.estado || 'DISPONIBLE', activo: true },
            create: { email: o.email, clave: 'demo1234', nombre: o.nombre, rol: 'OPERADOR', area_designada: o.area, estado_operativo: o.estado || 'DISPONIBLE' }
        });
        ids[o.key] = u.id;
        if (o.horario) {
            const h = { dias: o.horario.dias, hora_inicio: o.horario.inicio, hora_fin: o.horario.fin };
            await prisma.horarioOperador.upsert({ where: { userId: u.id }, create: { userId: u.id, ...h }, update: h });
        }
        if (o.guardia) {
            await prisma.guardiaDia.upsert({
                where: { userId_fecha: { userId: u.id, fecha: hoy } },
                create: { userId: u.id, fecha: hoy },
                update: {}
            });
        }
    }

    const ticketIds = {};
    for (const t of sim.tickets) {
        const creado = await prisma.ticket.create({
            data: {
                codigo_incidencia: t.codigo, asunto: t.asunto, remitente: MARCA_REMITENTE,
                descripcion: 'Ticket generado por la simulación de jornada',
                estado_actual: t.estado, puntos_complejidad: t.puntos, prioridad: t.prioridad === 'NONE' ? null : t.prioridad, nivel: t.nivel, tipo_caso_id: t.tipoId || null, area_designada: t.area, estado_ve: t.estadoVe ?? null,
                origen_ingesta: 'CORREO', asignado_a_id: reales ? t.operadorId : (t.operadorKey ? ids[t.operadorKey] : null), subgrupo_id: reales ? t.subgrupoId : null,
                createdAt: t.creado, fecha_asignacion: t.asignado, resueltoEn: t.resuelto, fecha_cierre: t.cierre
            },
            select: { id: true }
        });
        ticketIds[t.codigo] = { id: creado.id, t };
    }

    // Traspaso a guardia de anoche (lote aparte; no cambia el operador)
    if (sim.traspaso) {
        await prisma.traspaso.create({
            data: {
                nota: sim.traspaso.nota,
                semana_inicio: getWeekStart(sim.traspaso.creado),
                createdAt: sim.traspaso.creado,
                tickets: {
                    create: sim.traspaso.codigos.map(c => ({
                        ticketId: ticketIds[c].id,
                        estado_al_pasar: ticketIds[c].t.estado,
                        operador_al_pasar: reales ? ticketIds[c].t.operadorNombre : ((sim.operadores.find(o => o.key === ticketIds[c].t.operadorKey) || {}).nombre || null)
                    }))
                }
            }
        });
    }

    sim.dias.forEach(d => console.log(`Jornada ${d.fecha}: ${d.tickets.length} tickets, ${d.tickets.filter(t => !t.operadorKey).length} en cola sin asignar.`));
    if (!reales) console.log(`${sim.operadores.length} operadores demo (${sim.operadores.filter(o => o.guardia).length} de guardia hoy)${sim.traspaso ? `, traspaso de anoche con ${sim.traspaso.codigos.length} pendientes` : ''}.`);
    console.log('Limpieza: node scripts/limpiar-simulacion.js --confirmar');
    await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
