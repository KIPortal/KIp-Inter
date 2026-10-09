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
        const endOfDay = new Date(startOfDay);
        endOfDay.setDate(endOfDay.getDate() + 1);

        // Consultas dinámicas concurrentes con Prisma sin alterar esquema
        const [
            total,
            ticketsJornada,
            resueltos,
            enProgreso,
            puntosCerradosAgg,
            puntosTotalAgg,
            volumenPorAreaGroup,
            cerradosPorAreaGroup,
            abiertosPorAreaGroup,
            puntosPorAreaAllGroup,
            puntosPorAreaClosedGroup,
            operators,
            assignedCountsGroup,
            closedCountsGroup,
            activeCountsGroup,
            closedTickets,
            todayTickets
        ] = await Promise.all([
            // 1. Tickets Totales (global)
            prisma.ticket.count(),

            // 2. Tickets de la jornada (creados o resueltos hoy)
            prisma.ticket.count({
                where: {
                    OR: [
                        { createdAt: { gte: startOfDay, lt: endOfDay } },
                        { fecha_cierre: { gte: startOfDay, lt: endOfDay } },
                        { resueltoEn: { gte: startOfDay, lt: endOfDay } },
                        { estado_actual: 'CERRADO', updatedAt: { gte: startOfDay, lt: endOfDay } }
                    ]
                }
            }),

            // 3. Tickets resueltos / cerrados totales
            prisma.ticket.count({
                where: {
                    OR: [
                        { estado_actual: 'CERRADO' },
                        { resueltoEn: { not: null } },
                        { fecha_cierre: { not: null } }
                    ]
                }
            }),

            // 4. Tickets en progreso global
            prisma.ticket.count({
                where: { estado_actual: 'EN_PROGRESO' }
            }),

            // 5. Puntos de complejidad en tickets cerrados
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

            // 6. Puntos de complejidad globales
            prisma.ticket.aggregate({
                _sum: { puntos_complejidad: true }
            }),

            // 7. Volumen de tickets por área (Total)
            prisma.ticket.groupBy({
                by: ['area_designada'],
                _count: { id: true }
            }),

            // 8. Tickets cerrados por área
            prisma.ticket.groupBy({
                by: ['area_designada'],
                where: {
                    OR: [
                        { estado_actual: 'CERRADO' },
                        { resueltoEn: { not: null } },
                        { fecha_cierre: { not: null } }
                    ]
                },
                _count: { id: true }
            }),

            // 9. Tickets abiertos por área (para determinar Área Crítica y saturación)
            prisma.ticket.groupBy({
                by: ['area_designada'],
                where: {
                    estado_actual: { not: 'CERRADO' },
                    resueltoEn: null,
                    fecha_cierre: null
                },
                _count: { id: true }
            }),

            // 10. Total de puntos por área (todos)
            prisma.ticket.groupBy({
                by: ['area_designada'],
                _sum: { puntos_complejidad: true }
            }),

            // 11. Total de puntos por área (tickets cerrados)
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

            // 12. Lista de operadores
            prisma.user.findMany({
                where: { rol: 'OPERADOR' },
                select: {
                    id: true,
                    nombre: true,
                    email: true,
                    area_designada: true,
                    estado_operativo: true,
                    rol: true,
                    tickets_resueltos: true
                }
            }),

            // 13. Asignados totales por operador
            prisma.ticket.groupBy({
                by: ['asignado_a_id'],
                where: { asignado_a_id: { not: null } },
                _count: { id: true }
            }),

            // 14. Cerrados por operador con suma de puntos
            prisma.ticket.groupBy({
                by: ['asignado_a_id'],
                where: {
                    asignado_a_id: { not: null },
                    OR: [
                        { estado_actual: 'CERRADO' },
                        { resueltoEn: { not: null } },
                        { fecha_cierre: { not: null } }
                    ]
                },
                _count: { id: true },
                _sum: { puntos_complejidad: true }
            }),

            // 15. Carga actual por operador (tickets en EN_PROGRESO o EN_PAUSA)
            prisma.ticket.groupBy({
                by: ['asignado_a_id'],
                where: {
                    asignado_a_id: { not: null },
                    estado_actual: { in: ['EN_PROGRESO', 'EN_PAUSA'] }
                },
                _count: { id: true }
            }),

            // 16. Tickets cerrados con operador asignado (para tiempos de resolución y puntos detallados)
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
            }),

            // 17. Tickets de hoy para calcular flujo de creados vs cerrados por hora
            prisma.ticket.findMany({
                where: {
                    OR: [
                        { createdAt: { gte: startOfDay, lt: endOfDay } },
                        { fecha_cierre: { gte: startOfDay, lt: endOfDay } },
                        { resueltoEn: { gte: startOfDay, lt: endOfDay } },
                        { estado_actual: 'CERRADO', updatedAt: { gte: startOfDay, lt: endOfDay } }
                    ]
                },
                select: {
                    id: true,
                    createdAt: true,
                    fecha_cierre: true,
                    resueltoEn: true,
                    updatedAt: true,
                    estado_actual: true
                }
            })
        ]);

        const tasa = total > 0 ? `${Math.round((resueltos / total) * 100)}%` : '0%';
        const puntosCerrados = puntosCerradosAgg._sum?.puntos_complejidad || 0;
        const promedioPuntos = Math.round((puntosCerradosAgg._avg?.puntos_complejidad || 0) * 10) / 10;
        const totalGlobalPts = puntosTotalAgg._sum?.puntos_complejidad || 0;
        const puntosTotales = totalGlobalPts > 0 ? totalGlobalPts : puntosCerrados;

        // ----------------------------------------------------
        // R1.6: Cálculo de Área Crítica (mayor cantidad de tickets abiertos)
        // ----------------------------------------------------
        const areasSet = new Set(ALL_AREAS);
        volumenPorAreaGroup.forEach(item => { if (item.area_designada) areasSet.add(item.area_designada); });
        cerradosPorAreaGroup.forEach(item => { if (item.area_designada) areasSet.add(item.area_designada); });
        abiertosPorAreaGroup.forEach(item => { if (item.area_designada) areasSet.add(item.area_designada); });

        const areaOpenMap = {};
        const areaVolumeMap = {};
        const areaClosedMap = {};

        Array.from(areasSet).forEach(area => {
            areaOpenMap[area] = 0;
            areaVolumeMap[area] = 0;
            areaClosedMap[area] = 0;
        });

        abiertosPorAreaGroup.forEach(item => {
            const areaKey = item.area_designada || 'GENERAL';
            areaOpenMap[areaKey] = (areaOpenMap[areaKey] || 0) + (item._count?.id ?? item._count?._all ?? 0);
        });

        volumenPorAreaGroup.forEach(item => {
            const areaKey = item.area_designada || 'GENERAL';
            areaVolumeMap[areaKey] = (areaVolumeMap[areaKey] || 0) + (item._count?.id ?? item._count?._all ?? 0);
        });

        cerradosPorAreaGroup.forEach(item => {
            const areaKey = item.area_designada || 'GENERAL';
            areaClosedMap[areaKey] = (areaClosedMap[areaKey] || 0) + (item._count?.id ?? item._count?._all ?? 0);
        });

        let criticalAreaKey = null;
        let maxOpenCount = -1;
        let maxOpenSaturation = -1;

        for (const area of Array.from(areasSet)) {
            const totalArea = areaVolumeMap[area] || 0;
            const closedArea = areaClosedMap[area] || 0;
            const count = (areaOpenMap[area] !== undefined && areaOpenMap[area] > 0)
                ? areaOpenMap[area]
                : Math.max(0, totalArea - closedArea);
            areaOpenMap[area] = count;
            const sat = totalArea > 0 ? (count / totalArea) : 0;
            if (count > maxOpenCount || (count === maxOpenCount && count > 0 && sat > maxOpenSaturation)) {
                maxOpenCount = count;
                maxOpenSaturation = sat;
                criticalAreaKey = area;
            }
        }

        const areaCritica = {
            area: maxOpenCount > 0 ? (criticalAreaKey || 'GENERAL') : 'Ninguna',
            nombre: maxOpenCount > 0 ? (AREA_DISPLAY_NAMES[criticalAreaKey] || criticalAreaKey || 'Ninguna') : 'Ninguna',
            label: maxOpenCount > 0 ? (AREA_DISPLAY_NAMES[criticalAreaKey] || criticalAreaKey || 'Ninguna') : 'Ninguna',
            ticketsAbiertos: Math.max(0, maxOpenCount),
            abiertos: Math.max(0, maxOpenCount)
        };

        // ----------------------------------------------------
        // R1.2: Volumen vs Cerrados por Área (Saturación)
        // ----------------------------------------------------
        const sortedAreasByVolume = Array.from(areasSet).map(area => {
            const totalArea = areaVolumeMap[area] || 0;
            const closedArea = areaClosedMap[area] || 0;
            const openArea = areaOpenMap[area] || Math.max(0, totalArea - closedArea);
            const saturacion = totalArea > 0 ? Math.round((openArea / totalArea) * 100) : 0;
            const tasaCierre = totalArea > 0 ? Math.round((closedArea / totalArea) * 100) : 0;
            return {
                area,
                label: AREA_DISPLAY_NAMES[area] || area,
                total: totalArea,
                volumen: totalArea,
                cerrados: closedArea,
                abiertos: openArea,
                saturacion,
                tasaCierre
            };
        }).sort((a, b) => {
            if (b.total !== a.total) return b.total - a.total;
            if (b.abiertos !== a.abiertos) return b.abiertos - a.abiertos;
            return a.label.localeCompare(b.label);
        });

        const volumenPorArea = {
            labels: sortedAreasByVolume.map(a => a.label),
            data: sortedAreasByVolume.map(a => a.total),
            values: sortedAreasByVolume.map(a => a.total),
            totales: sortedAreasByVolume.map(a => a.total),
            cerrados: sortedAreasByVolume.map(a => a.cerrados),
            abiertos: sortedAreasByVolume.map(a => a.abiertos),
            saturaciones: sortedAreasByVolume.map(a => a.saturacion),
            tasasCierre: sortedAreasByVolume.map(a => a.tasaCierre),
            areas: sortedAreasByVolume.map(a => a.area),
            detalles: sortedAreasByVolume
        };

        // ----------------------------------------------------
        // R1.3: Total de Puntos por Área
        // ----------------------------------------------------
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

        // ----------------------------------------------------
        // R1.4: Ranking Dinámico de Operadores
        // ----------------------------------------------------
        const assignedMap = new Map();
        assignedCountsGroup.forEach(item => {
            if (item.asignado_a_id) {
                assignedMap.set(item.asignado_a_id, item._count?.id ?? item._count?._all ?? 0);
            }
        });

        const closedCountMap = new Map();
        const closedPointsMap = new Map();
        closedCountsGroup.forEach(item => {
            if (item.asignado_a_id) {
                closedCountMap.set(item.asignado_a_id, item._count?.id ?? item._count?._all ?? 0);
                closedPointsMap.set(item.asignado_a_id, item._sum?.puntos_complejidad || 0);
            }
        });

        const activeLoadMap = new Map();
        activeCountsGroup.forEach(item => {
            if (item.asignado_a_id) {
                activeLoadMap.set(item.asignado_a_id, item._count?.id ?? item._count?._all ?? 0);
            }
        });

        // Tiempos de resolución
        const opTimeMap = new Map();
        for (const ticket of closedTickets) {
            if (!ticket.asignado_a_id) continue;
            let tStat = opTimeMap.get(ticket.asignado_a_id);
            if (!tStat) {
                tStat = { totalMinutos: 0, countConTiempo: 0 };
                opTimeMap.set(ticket.asignado_a_id, tStat);
            }
            const fin = ticket.fecha_cierre || ticket.resueltoEn;
            if (fin && ticket.createdAt) {
                const finTime = new Date(fin).getTime();
                const createTime = new Date(ticket.createdAt).getTime();
                if (!isNaN(finTime) && !isNaN(createTime) && finTime >= createTime) {
                    const diff = Math.max(1, Math.round((finTime - createTime) / 60000));
                    tStat.totalMinutos += diff;
                    tStat.countConTiempo += 1;
                }
            }
        }

        const operatorStatsMap = new Map();

        // Procesar operadores formales
        for (const op of operators) {
            const cerrados = closedCountMap.get(op.id) || 0;
            const rawAsignados = assignedMap.get(op.id) || 0;
            const cargaActual = activeLoadMap.get(op.id) || 0;
            const asignadosTotales = Math.max(rawAsignados, cerrados + cargaActual);
            const puntos = closedPointsMap.get(op.id) || 0;
            const eficiencia = asignadosTotales > 0
                ? Math.min(100, Math.round((cerrados / asignadosTotales) * 100))
                : 0;

            const tStat = opTimeMap.get(op.id);
            let tiempoPromedio = 'N/A';
            if (tStat && tStat.countConTiempo > 0 && tStat.totalMinutos > 0) {
                const avg = Math.round(tStat.totalMinutos / tStat.countConTiempo);
                tiempoPromedio = avg >= 60 ? `${(avg / 60).toFixed(1)} h` : `${avg} min`;
            }

            const cargaNivel = cargaActual <= 2 ? 'baja' : (cargaActual <= 4 ? 'media' : 'alta');

            operatorStatsMap.set(op.id, {
                id: op.id,
                nombre: op.nombre || 'Operador',
                email: op.email || '',
                area: AREA_DISPLAY_NAMES[op.area_designada] || op.area_designada || 'General',
                area_designada: op.area_designada || 'GENERAL',
                estado: op.estado_operativo || 'DISPONIBLE',
                estado_operativo: op.estado_operativo || 'DISPONIBLE',
                asignadosTotales,
                asignados_totales: asignadosTotales,
                asignados: asignadosTotales,
                cerrados,
                resueltos: cerrados,
                tickets_resueltos: cerrados,
                eficiencia,
                cargaActual,
                carga_actual: cargaActual,
                carga: cargaActual,
                cargaNivel,
                puntos,
                puntos_complejidad: puntos,
                tiempoPromedio
            });
        }

        // Si no hay operadores con rol OPERADOR registrados, incluir asignados de tickets
        if (operators.length === 0) {
            const fallbackOpIds = new Set();
            for (const ticket of closedTickets) {
                if (ticket.asignado_a_id) fallbackOpIds.add(ticket.asignado_a_id);
            }
            assignedCountsGroup.forEach(item => {
                if (item.asignado_a_id) fallbackOpIds.add(item.asignado_a_id);
            });
            activeCountsGroup.forEach(item => {
                if (item.asignado_a_id) fallbackOpIds.add(item.asignado_a_id);
            });
            closedCountsGroup.forEach(item => {
                if (item.asignado_a_id) fallbackOpIds.add(item.asignado_a_id);
            });

            const ticketUserMap = new Map();
            for (const ticket of closedTickets) {
                if (ticket.asignado_a_id && ticket.asignado_a) {
                    ticketUserMap.set(ticket.asignado_a_id, ticket.asignado_a);
                }
            }

            for (const opId of fallbackOpIds) {
                if (operatorStatsMap.has(opId)) continue;
                const u = ticketUserMap.get(opId);
                const cerrados = closedCountMap.get(opId) || 0;
                const rawAsignados = assignedMap.get(opId) || 0;
                const cargaActual = activeLoadMap.get(opId) || 0;
                const asignadosTotales = Math.max(rawAsignados, cerrados + cargaActual);
                const puntos = closedPointsMap.get(opId) || 0;
                const eficiencia = asignadosTotales > 0
                    ? Math.min(100, Math.round((cerrados / asignadosTotales) * 100))
                    : 0;

                const tStat = opTimeMap.get(opId);
                let tiempoPromedio = 'N/A';
                if (tStat && tStat.countConTiempo > 0 && tStat.totalMinutos > 0) {
                    const avg = Math.round(tStat.totalMinutos / tStat.countConTiempo);
                    tiempoPromedio = avg >= 60 ? `${(avg / 60).toFixed(1)} h` : `${avg} min`;
                }

                const cargaNivel = cargaActual <= 2 ? 'baja' : (cargaActual <= 4 ? 'media' : 'alta');

                operatorStatsMap.set(opId, {
                    id: opId,
                    nombre: u?.nombre || 'Operador',
                    email: u?.email || '',
                    area: u ? (AREA_DISPLAY_NAMES[u.area_designada] || u.area_designada || 'General') : 'General',
                    area_designada: u?.area_designada || 'GENERAL',
                    estado: u?.estado_operativo || 'DISPONIBLE',
                    estado_operativo: u?.estado_operativo || 'DISPONIBLE',
                    asignadosTotales,
                    asignados_totales: asignadosTotales,
                    asignados: asignadosTotales,
                    cerrados,
                    resueltos: cerrados,
                    tickets_resueltos: cerrados,
                    eficiencia,
                    cargaActual,
                    carga_actual: cargaActual,
                    carga: cargaActual,
                    cargaNivel,
                    puntos,
                    puntos_complejidad: puntos,
                    tiempoPromedio
                });
            }
        }

        const rankingList = Array.from(operatorStatsMap.values());
        rankingList.sort((a, b) => {
            if (b.cerrados !== a.cerrados) return b.cerrados - a.cerrados;
            if (b.puntos !== a.puntos) return b.puntos - a.puntos;
            if (b.eficiencia !== a.eficiencia) return b.eficiencia - a.eficiencia;
            return (a.nombre || '').localeCompare(b.nombre || '');
        });

        const rankingOperadores = rankingList.map((op, index) => ({
            ...op,
            posicion: index + 1,
            rank: index + 1
        }));

        // ----------------------------------------------------
        // R1.5: Flujo de Tickets Creados vs Cerrados por Hora Hoy
        // ----------------------------------------------------
        const horasLabels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
        const creadosPorHora = new Array(24).fill(0);
        const cerradosPorHora = new Array(24).fill(0);

        todayTickets.forEach(t => {
            if (t.createdAt) {
                const d = new Date(t.createdAt);
                if (d >= startOfDay && d < endOfDay) {
                    const h = d.getHours();
                    if (h >= 0 && h < 24) creadosPorHora[h]++;
                }
            }
            let closedDate = null;
            if (t.fecha_cierre) {
                const fc = new Date(t.fecha_cierre);
                if (fc >= startOfDay && fc < endOfDay) closedDate = fc;
            }
            if (!closedDate && t.resueltoEn) {
                const re = new Date(t.resueltoEn);
                if (re >= startOfDay && re < endOfDay) closedDate = re;
            }
            if (!closedDate && t.estado_actual === 'CERRADO' && t.updatedAt) {
                const ua = new Date(t.updatedAt);
                if (ua >= startOfDay && ua < endOfDay) closedDate = ua;
            }
            if (closedDate) {
                const h = closedDate.getHours();
                if (h >= 0 && h < 24) cerradosPorHora[h]++;
            }
        });

        const flujoPorHora = {
            labels: horasLabels,
            creados: creadosPorHora,
            cerrados: cerradosPorHora
        };

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
            promedio_puntos: promedioPuntos,
            areaCritica,
            area_critica: areaCritica
        };

        const reportData = {
            ticketsTotales: total,
            tickets_totales: total,
            total,
            ticketsJornada,
            tickets_jornada: ticketsJornada,
            jornada: ticketsJornada,
            resueltos,
            enProgreso,
            tasa,
            areaCritica,
            area_critica: areaCritica,
            volumenPorArea,
            volumen_por_area: volumenPorArea,
            puntosPorArea,
            puntos_por_area: puntosPorArea,
            rankingOperadores,
            ranking_operadores: rankingOperadores,
            ranking: rankingOperadores,
            operadores: rankingOperadores,
            flujoPorHora,
            flujo_por_hora: flujoPorHora,
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
            resueltos,
            enProgreso,
            areaCritica,
            area_critica: areaCritica,
            volumenPorArea,
            volumen_por_area: volumenPorArea,
            puntosPorArea,
            puntos_por_area: puntosPorArea,
            ranking: rankingOperadores,
            operadores: rankingOperadores,
            rankingOperadores,
            ranking_operadores: rankingOperadores,
            flujoPorHora,
            flujo_por_hora: flujoPorHora,
            reportData
        });
    } catch (error) {
        console.error('Error fetching reports:', error);
        res.status(500).send('Error interno del servidor');
    }
}

module.exports = { getReports };
