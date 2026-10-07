const prisma = require('../config/prisma');

const AREA_DISPLAY_NAMES = {
    'GENERAL': 'General',
    'REDES_FTTH': 'Redes FTTH',
    'TRAFICO_INALAMBRICO': 'Tráfico Inalámbrico',
    'WAN': 'WAN',
    'GRANDES_CLIENTES': 'Grandes Clientes',
    'SEGURIDAD': 'Seguridad',
    'TELEFONIA': 'Telefonía'
};

const ALL_AREAS = [
    'GENERAL',
    'REDES_FTTH',
    'TRAFICO_INALAMBRICO',
    'WAN',
    'GRANDES_CLIENTES',
    'SEGURIDAD',
    'TELEFONIA'
];

async function getReports(req, res) {
    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        // Ejecutar todas las consultas independientes en paralelo para máxima velocidad y tolerancia de red
        const [
            total,
            ticketsJornada,
            resueltos,
            enProgreso,
            puntosCerradosAgg,
            puntosTotalAgg,
            volumenPorAreaGroup,
            puntosPorAreaAllGroup,
            puntosPorAreaClosedGroup,
            operators,
            closedTickets
        ] = await Promise.all([
            // 1. Tickets Totales (global)
            prisma.ticket.count(),

            // 2. Tickets de la jornada (creados o resueltos hoy)
            prisma.ticket.count({
                where: {
                    OR: [
                        { createdAt: { gte: startOfDay } },
                        { fecha_cierre: { gte: startOfDay } },
                        { resueltoEn: { gte: startOfDay } },
                        { estado_actual: 'CERRADO', updatedAt: { gte: startOfDay } }
                    ]
                }
            }),

            // Métricas de estado de tickets resueltos / cerrados
            prisma.ticket.count({
                where: {
                    OR: [
                        { estado_actual: 'CERRADO' },
                        { resueltoEn: { not: null } },
                        { fecha_cierre: { not: null } }
                    ]
                }
            }),

            // Tickets actualmente en progreso
            prisma.ticket.count({
                where: { estado_actual: 'EN_PROGRESO' }
            }),

            // Puntos de tickets completados / cerrados
            prisma.ticket.aggregate({
                where: {
                    OR: [
                        { estado_actual: 'CERRADO' },
                        { resueltoEn: { not: null } },
                        { fecha_cierre: { not: null } }
                    ]
                },
                _sum: { puntos_complejidad: true },
                _avg: { puntos_complejidad: true }
            }),

            // Puntos totales globales (todos los tickets)
            prisma.ticket.aggregate({
                _sum: { puntos_complejidad: true }
            }),

            // 3. Volumen de tickets por área (para gráfico de barras horizontales)
            prisma.ticket.groupBy({
                by: ['area_designada'],
                _count: { id: true }
            }),

            // 4. Total de puntos por área (todos los tickets)
            prisma.ticket.groupBy({
                by: ['area_designada'],
                _sum: { puntos_complejidad: true }
            }),

            // Puntos por área (tickets cerrados)
            prisma.ticket.groupBy({
                by: ['area_designada'],
                where: {
                    OR: [
                        { estado_actual: 'CERRADO' },
                        { resueltoEn: { not: null } },
                        { fecha_cierre: { not: null } }
                    ]
                },
                _sum: { puntos_complejidad: true }
            }),

            // 5. Ranking de operadores: Lista de operadores registrados
            prisma.user.findMany({
                where: { rol: 'OPERADOR' },
                select: {
                    id: true,
                    nombre: true,
                    email: true,
                    area_designada: true,
                    estado_operativo: true,
                    tickets_resueltos: true
                }
            }),

            // Tickets resueltos o cerrados con operador asignado
            prisma.ticket.findMany({
                where: {
                    OR: [
                        { estado_actual: 'CERRADO' },
                        { resueltoEn: { not: null } },
                        { fecha_cierre: { not: null } }
                    ],
                    asignado_a_id: { not: null }
                },
                select: {
                    id: true,
                    asignado_a_id: true,
                    puntos_complejidad: true,
                    createdAt: true,
                    fecha_cierre: true,
                    resueltoEn: true,
                    asignado_a: {
                        select: {
                            id: true,
                            nombre: true,
                            email: true,
                            area_designada: true,
                            estado_operativo: true,
                            rol: true,
                            tickets_resueltos: true
                        }
                    }
                }
            })
        ]);

        const tasa = total > 0 ? `${Math.round((resueltos / total) * 100)}%` : '0%';
        const puntosCerrados = puntosCerradosAgg._sum?.puntos_complejidad || 0;
        const promedioPuntos = Math.round((puntosCerradosAgg._avg?.puntos_complejidad || 0) * 10) / 10;
        const puntosTotales = puntosCerrados > 0 ? puntosCerrados : (puntosTotalAgg._sum?.puntos_complejidad || 0);

        // Mapeo dinámico y ordenamiento de volumen por área
        const areasSet = new Set(ALL_AREAS);
        volumenPorAreaGroup.forEach(item => {
            if (item.area_designada) areasSet.add(item.area_designada);
        });

        const areaVolumeMap = {};
        Array.from(areasSet).forEach(area => {
            areaVolumeMap[area] = 0;
        });
        volumenPorAreaGroup.forEach(item => {
            const areaKey = item.area_designada || 'GENERAL';
            areaVolumeMap[areaKey] = (areaVolumeMap[areaKey] || 0) + (item._count?.id ?? item._count?._all ?? 0);
        });

        const sortedAreasByVolume = Array.from(areasSet).map(area => ({
            area,
            label: AREA_DISPLAY_NAMES[area] || area,
            total: areaVolumeMap[area] || 0
        })).sort((a, b) => b.total - a.total);

        const volumenPorArea = {
            labels: sortedAreasByVolume.map(a => a.label),
            data: sortedAreasByVolume.map(a => a.total),
            values: sortedAreasByVolume.map(a => a.total),
            areas: sortedAreasByVolume.map(a => a.area)
        };

        // Mapeo de puntos por área
        const areaPointsTotalMap = {};
        const areaPointsClosedMap = {};
        Array.from(areasSet).forEach(area => {
            areaPointsTotalMap[area] = 0;
            areaPointsClosedMap[area] = 0;
        });

        puntosPorAreaAllGroup.forEach(item => {
            const areaKey = item.area_designada || 'GENERAL';
            const pts = Math.max(0, item._sum?.puntos_complejidad || 0);
            areaPointsTotalMap[areaKey] = (areaPointsTotalMap[areaKey] || 0) + pts;
        });

        puntosPorAreaClosedGroup.forEach(item => {
            const areaKey = item.area_designada || 'GENERAL';
            const pts = Math.max(0, item._sum?.puntos_complejidad || 0);
            areaPointsClosedMap[areaKey] = (areaPointsClosedMap[areaKey] || 0) + pts;
        });

        const hasAnyTotalPoints = Object.values(areaPointsTotalMap).some(p => p > 0);
        const hasAnyClosedPoints = Object.values(areaPointsClosedMap).some(p => p > 0);
        const hasAnyVolume = Object.values(areaVolumeMap).some(v => v > 0);

        // Si existen puntos, se muestra la distribución de puntos totales de cada área.
        // Si no existen puntos registrados en ninguna área, se recurre elegantemente al volumen de tickets.
        const useVolumeForDonut = !hasAnyTotalPoints && !hasAnyClosedPoints && hasAnyVolume;
        const activePointsMap = hasAnyTotalPoints ? areaPointsTotalMap : areaPointsClosedMap;

        const sortedAreasByPoints = Array.from(areasSet).map(area => ({
            area,
            label: AREA_DISPLAY_NAMES[area] || area,
            puntos: activePointsMap[area] || 0,
            puntosTotales: areaPointsTotalMap[area] || 0,
            puntosCerrados: areaPointsClosedMap[area] || 0,
            volumen: areaVolumeMap[area] || 0
        })).sort((a, b) => {
            const valA = useVolumeForDonut ? a.volumen : a.puntos;
            const valB = useVolumeForDonut ? b.volumen : b.puntos;
            if (valB !== valA) return valB - valA;
            return a.label.localeCompare(b.label);
        });

        const puntosPorArea = {
            labels: sortedAreasByPoints.map(a => a.label),
            data: useVolumeForDonut
                ? sortedAreasByPoints.map(a => a.volumen)
                : sortedAreasByPoints.map(a => a.puntos),
            puntos: sortedAreasByPoints.map(a => a.puntos),
            puntosTotales: sortedAreasByPoints.map(a => a.puntosTotales),
            puntosCerrados: sortedAreasByPoints.map(a => a.puntosCerrados),
            volumen: sortedAreasByPoints.map(a => a.volumen),
            values: useVolumeForDonut
                ? sortedAreasByPoints.map(a => a.volumen)
                : sortedAreasByPoints.map(a => a.puntos),
            areas: sortedAreasByPoints.map(a => a.area),
            tipo: useVolumeForDonut ? 'Tickets' : 'Puntos'
        };

        // 5. Ranking de operadores (basado en puntos_complejidad de tickets resueltos o cerrados)
        const operatorStatsMap = new Map();
        for (const op of operators) {
            operatorStatsMap.set(op.id, {
                id: op.id,
                nombre: op.nombre || 'Operador',
                email: op.email || '',
                area: AREA_DISPLAY_NAMES[op.area_designada] || op.area_designada || 'General',
                area_designada: op.area_designada || 'GENERAL',
                estado: op.estado_operativo || 'DISPONIBLE',
                estado_operativo: op.estado_operativo || 'DISPONIBLE',
                puntos: 0,
                puntos_complejidad: 0,
                resueltos: op.tickets_resueltos || 0,
                tickets_resueltos: op.tickets_resueltos || 0,
                totalMinutos: 0,
                countCerrados: 0,
                countConTiempo: 0
            });
        }

        for (const ticket of closedTickets) {
            let stat = operatorStatsMap.get(ticket.asignado_a_id);
            if (!stat) {
                const u = ticket.asignado_a;
                // Excluir coordinadores del ranking de operadores a menos que no haya operadores disponibles
                if (u?.rol === 'COORDINADOR' && operators.length > 0) {
                    continue;
                }
                stat = {
                    id: ticket.asignado_a_id,
                    nombre: u?.nombre || 'Operador',
                    email: u?.email || '',
                    area: u ? (AREA_DISPLAY_NAMES[u.area_designada] || u.area_designada || 'General') : 'General',
                    area_designada: u?.area_designada || 'GENERAL',
                    estado: u?.estado_operativo || 'DISPONIBLE',
                    estado_operativo: u?.estado_operativo || 'DISPONIBLE',
                    puntos: 0,
                    puntos_complejidad: 0,
                    resueltos: u?.tickets_resueltos || 0,
                    tickets_resueltos: u?.tickets_resueltos || 0,
                    totalMinutos: 0,
                    countCerrados: 0,
                    countConTiempo: 0
                };
                operatorStatsMap.set(ticket.asignado_a_id, stat);
            }

            const pts = Math.max(0, Number(ticket.puntos_complejidad) || 0);
            stat.puntos += pts;
            stat.puntos_complejidad = stat.puntos;
            stat.countCerrados += 1;
            stat.resueltos = Math.max(stat.resueltos, stat.countCerrados);
            stat.tickets_resueltos = stat.resueltos;

            const fin = ticket.fecha_cierre || ticket.resueltoEn;
            if (fin && ticket.createdAt) {
                const finTime = new Date(fin).getTime();
                const createTime = new Date(ticket.createdAt).getTime();
                if (!isNaN(finTime) && !isNaN(createTime) && finTime >= createTime) {
                    const diff = Math.max(1, Math.round((finTime - createTime) / 60000));
                    stat.totalMinutos += diff;
                    stat.countConTiempo += 1;
                }
            }
        }

        const rankingList = Array.from(operatorStatsMap.values()).map(stat => {
            let tiempoPromedio = 'N/A';
            if (stat.countConTiempo > 0 && stat.totalMinutos > 0) {
                const avg = Math.round(stat.totalMinutos / stat.countConTiempo);
                tiempoPromedio = avg >= 60 ? `${(avg / 60).toFixed(1)} h` : `${avg} min`;
            }
            return {
                id: stat.id,
                nombre: stat.nombre,
                email: stat.email,
                area: stat.area,
                area_designada: stat.area_designada,
                estado: stat.estado,
                estado_operativo: stat.estado_operativo,
                puntos: stat.puntos,
                puntos_complejidad: stat.puntos,
                resueltos: stat.resueltos,
                tickets_resueltos: stat.resueltos,
                tiempoPromedio
            };
        });

        rankingList.sort((a, b) => {
            if (b.puntos !== a.puntos) return b.puntos - a.puntos;
            if (b.resueltos !== a.resueltos) return b.resueltos - a.resueltos;
            return (a.nombre || '').localeCompare(b.nombre || '');
        });

        const rankingOperadores = rankingList.map((op, index) => ({
            ...op,
            posicion: index + 1,
            rank: index + 1
        }));

        const kpis = {
            total,
            ticketsTotales: total,
            tickets_totales: total,
            jornada: ticketsJornada,
            ticketsJornada,
            tickets_jornada: ticketsJornada,
            resueltos,
            enProgreso,
            tasa,
            puntosTotales,
            puntos_totales: puntosTotales,
            puntosCerrados,
            puntos_cerrados: puntosCerrados,
            promedioPuntos,
            promedio_puntos: promedioPuntos
        };

        const reportData = {
            ticketsTotales: total,
            tickets_totales: total,
            total,
            ticketsJornada,
            tickets_jornada: ticketsJornada,
            jornada: ticketsJornada,
            volumenPorArea,
            volumen_por_area: volumenPorArea,
            puntosPorArea,
            puntos_por_area: puntosPorArea,
            rankingOperadores,
            ranking_operadores: rankingOperadores,
            ranking: rankingOperadores,
            operadores: rankingOperadores,
            kpis
        };

        res.render('reports', {
            titulo: 'NOC Portal - Reportes',
            currentUser: req.user,
            kpis,
            ticketsTotales: total,
            tickets_totales: total,
            total,
            ticketsJornada,
            tickets_jornada: ticketsJornada,
            jornada: ticketsJornada,
            volumenPorArea,
            volumen_por_area: volumenPorArea,
            puntosPorArea,
            puntos_por_area: puntosPorArea,
            ranking: rankingOperadores,
            operadores: rankingOperadores,
            rankingOperadores,
            ranking_operadores: rankingOperadores,
            reportData
        });
    } catch (error) {
        console.error('Error fetching reports:', error);
        res.status(500).send('Error interno del servidor');
    }
}

module.exports = { getReports };
