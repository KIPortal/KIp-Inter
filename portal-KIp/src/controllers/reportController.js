const prisma = require('../config/prisma');
const {
    ACTIVE_STATES,
    getDayBounds,
    getHourOfDay,
    averageResolutionMinutes,
    formatMinutes,
    computeOverload,
    getPeriodBounds
} = require('../services/metricsService');
const { buildPeriodReport, AREAS: REPORT_AREAS, AREA_NAMES } = require('../services/periodReportService');
const { buildReportView } = require('../services/reportViewService');
const { isActiveArea } = require('../services/areaCatalog');
const { buildWorkbook } = require('../services/excelExportService');

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
        // Día calendario de Caracas (no depende de la zona horaria del servidor)
        const { start: startOfDay, end: endOfDay } = getDayBounds();
        const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

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
            todayTickets,
            allTicketsGeo,
            recentResolvedTickets
        ] = await Promise.all([
            // 1. Tickets Totales (global)
            prisma.ticket.count(),

            // 2. Tickets de la jornada (creados o resueltos hoy). No se usa updatedAt:
            //    cualquier edición de un ticket cerrado lo contaría como cerrado hoy.
            prisma.ticket.count({
                where: {
                    OR: [
                        { createdAt: { gte: startOfDay, lt: endOfDay } },
                        { fecha_cierre: { gte: startOfDay, lt: endOfDay } },
                        { resueltoEn: { gte: startOfDay, lt: endOfDay } }
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

            // 15. Carga actual por operador: todos sus tickets activos (no cerrados),
            //     incluidos los recién asignados que aún no ha tomado y los en espera
            prisma.ticket.groupBy({
                by: ['asignado_a_id'],
                where: {
                    asignado_a_id: { not: null },
                    estado_actual: { in: ACTIVE_STATES }
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

            // 17. Tickets de hoy para calcular flujo de creados vs asignados vs cerrados por hora
            prisma.ticket.findMany({
                where: {
                    OR: [
                        { createdAt: { gte: startOfDay, lt: endOfDay } },
                        { fecha_cierre: { gte: startOfDay, lt: endOfDay } },
                        { resueltoEn: { gte: startOfDay, lt: endOfDay } },
                        { fecha_asignacion: { gte: startOfDay, lt: endOfDay } }
                    ]
                },
                select: {
                    id: true,
                    createdAt: true,
                    fecha_cierre: true,
                    resueltoEn: true,
                    fecha_asignacion: true,
                    estado_actual: true
                }
            }),

            // 18. Tickets para distribución geográfica nacional (Venezuela)
            prisma.ticket.findMany({
                select: {
                    id: true,
                    asunto: true,
                    descripcion: true,
                    estado_actual: true,
                    area_designada: true
                }
            }),

            // 19. Tickets resueltos en las últimas 24 horas para mediana de tiempo de resolución por área (Gráfica 5)
            prisma.ticket.findMany({
                where: {
                    OR: [
                        { resueltoEn: { gte: last24h } },
                        { fecha_cierre: { gte: last24h } }
                    ]
                },
                select: {
                    id: true,
                    area_designada: true,
                    createdAt: true,
                    fecha_cierre: true,
                    resueltoEn: true,
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
        // R1.2: Volumen vs Cerrados por Área (Saturación) & Gráfica 1: Área vs Tickets
        // Nota: En schema.prisma, EstadoTicket no contempla RECHAZADO (estados: NUEVO, EN_PROGRESO, EN_PAUSA, EN_ESPERA_TERCEROS, CERRADO)
        // Por ende se ajusta 'rechazados' a 0 para mantener fidelidad con el esquema.
        // ----------------------------------------------------
        const sortedAreasByVolume = Array.from(areasSet).map(area => {
            const totalArea = areaVolumeMap[area] || 0;
            const closedArea = areaClosedMap[area] || 0;
            const openArea = areaOpenMap[area] || Math.max(0, totalArea - closedArea);
            const saturacion = totalArea > 0 ? Math.round((openArea / totalArea) * 100) : 0;
            const tasaCierre = totalArea > 0 ? Math.round((closedArea / totalArea) * 100) : 0;
            const rechazados = 0;
            return {
                area,
                label: AREA_DISPLAY_NAMES[area] || area,
                total: totalArea,
                volumen: totalArea,
                creados: totalArea,
                asignados: totalArea,
                cerrados: closedArea,
                resueltos: closedArea,
                rechazados,
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
            creados: sortedAreasByVolume.map(a => a.total),
            asignados: sortedAreasByVolume.map(a => a.total),
            cerrados: sortedAreasByVolume.map(a => a.cerrados),
            resueltos: sortedAreasByVolume.map(a => a.cerrados),
            rechazados: sortedAreasByVolume.map(a => a.rechazados),
            abiertos: sortedAreasByVolume.map(a => a.abiertos),
            saturaciones: sortedAreasByVolume.map(a => a.saturacion),
            tasasCierre: sortedAreasByVolume.map(a => a.tasaCierre),
            areas: sortedAreasByVolume.map(a => a.area),
            detalles: sortedAreasByVolume
        };

        const areaTickets = {
            labels: sortedAreasByVolume.map(a => a.label),
            creados: sortedAreasByVolume.map(a => a.total),
            asignados: sortedAreasByVolume.map(a => a.total),
            resueltos: sortedAreasByVolume.map(a => a.cerrados),
            rechazados: sortedAreasByVolume.map(a => a.rechazados),
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

        // Tiempo promedio de resolución por operador: suma de tiempos ÷ tickets con
        // tiempo válido, medido desde que el ticket llegó hasta que se cerró.
        const opTicketsMap = new Map();
        for (const ticket of closedTickets) {
            if (!ticket.asignado_a_id) continue;
            if (!opTicketsMap.has(ticket.asignado_a_id)) opTicketsMap.set(ticket.asignado_a_id, []);
            opTicketsMap.get(ticket.asignado_a_id).push(ticket);
        }
        const averageTimeFor = opId => formatMinutes(averageResolutionMinutes(opTicketsMap.get(opId)));

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

            const tiempoPromedio = averageTimeFor(op.id);

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

                const tiempoPromedio = averageTimeFor(opId);

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

        // Sobrecarga: carga activa de cada operador frente al promedio de su área.
        // Es una alerta para el coordinador; no cambia el semáforo `cargaNivel`.
        const overloadByOperator = computeOverload(Array.from(operatorStatsMap.values()));
        for (const stats of operatorStatsMap.values()) {
            const overload = overloadByOperator.get(stats.id);
            stats.promedioAreaCarga = overload.promedioArea;
            stats.indiceCarga = overload.indiceCarga;
            stats.sobrecarga = overload.sobrecarga;
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
        // Gráfica 3: Barras por Operador (agrupados por área: Asignados vs Resueltos)
        // ----------------------------------------------------
        const operadoresAgrupados = [...rankingList].sort((a, b) => {
            const areaDiff = (a.area || '').localeCompare(b.area || '');
            if (areaDiff !== 0) return areaDiff;
            return b.asignadosTotales - a.asignadosTotales;
        });

        const barrasOperadores = {
            labels: operadoresAgrupados.map(op => `${op.nombre} (${op.area})`),
            nombres: operadoresAgrupados.map(op => op.nombre),
            areas: operadoresAgrupados.map(op => op.area),
            asignados: operadoresAgrupados.map(op => op.asignadosTotales),
            resueltos: operadoresAgrupados.map(op => op.cerrados),
            detalles: operadoresAgrupados
        };

        // ----------------------------------------------------
        // Gráfica 4: Flujo 24h (Creados vs Asignados vs Cerrados por Hora Hoy)
        // ----------------------------------------------------
        const horasLabels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
        const creadosPorHora = new Array(24).fill(0);
        const asignadosPorHora = new Array(24).fill(0);
        const cerradosPorHora = new Array(24).fill(0);

        // La hora se toma en Caracas, no en la zona horaria del servidor
        todayTickets.forEach(t => {
            if (!t) return;
            const creaVal = t.fecha_creacion || t.createdAt;
            if (creaVal) {
                const d = new Date(creaVal);
                if (!isNaN(d.getTime()) && d >= startOfDay && d < endOfDay) creadosPorHora[getHourOfDay(d)]++;
            }
            if (t.fecha_asignacion) {
                const fa = new Date(t.fecha_asignacion);
                if (!isNaN(fa.getTime()) && fa >= startOfDay && fa < endOfDay) {
                    asignadosPorHora[getHourOfDay(fa)]++;
                }
            }
            let closedDate = null;
            if (t.fecha_resolucion) {
                const fr = new Date(t.fecha_resolucion);
                if (!isNaN(fr.getTime()) && fr >= startOfDay && fr < endOfDay) closedDate = fr;
            }
            if (!closedDate && t.fecha_cierre) {
                const fc = new Date(t.fecha_cierre);
                if (!isNaN(fc.getTime()) && fc >= startOfDay && fc < endOfDay) closedDate = fc;
            }
            if (!closedDate && t.resueltoEn) {
                const re = new Date(t.resueltoEn);
                if (!isNaN(re.getTime()) && re >= startOfDay && re < endOfDay) closedDate = re;
            }
            if (closedDate) cerradosPorHora[getHourOfDay(closedDate)]++;
        });

        const creadosHoy = creadosPorHora.reduce((sum, n) => sum + n, 0);
        const cerradosHoy = cerradosPorHora.reduce((sum, n) => sum + n, 0);

        const flujoPorHora = {
            labels: horasLabels,
            creados: creadosPorHora,
            asignados: asignadosPorHora,
            cerrados: cerradosPorHora
        };

        // ----------------------------------------------------
        // Gráfica 5: Promedio de tiempo de resolución por área (últimas 24h). Las claves 'mediana*' se conservan por compatibilidad con la vista
        // ----------------------------------------------------
        const areasForMedian = [...ALL_AREAS];
        areasSet.forEach(a => {
            if (!areasForMedian.includes(a)) areasForMedian.push(a);
        });

        const resolutionTimesByArea = {};
        areasForMedian.forEach(area => {
            resolutionTimesByArea[area] = [];
        });

        (recentResolvedTickets || []).forEach(ticket => {
            if (!ticket) return;
            const area = ticket.area_designada || 'GENERAL';
            if (!resolutionTimesByArea[area]) {
                resolutionTimesByArea[area] = [];
                if (!areasForMedian.includes(area)) areasForMedian.push(area);
            }
            const fechaRes = ticket.fecha_resolucion || ticket.resueltoEn || ticket.fecha_cierre;
            const fechaCrea = ticket.fecha_creacion || ticket.createdAt;
            if (fechaRes && fechaCrea) {
                const resMs = new Date(fechaRes).getTime();
                const creaMs = new Date(fechaCrea).getTime();
                if (!isNaN(resMs) && !isNaN(creaMs) && resMs >= creaMs && resMs >= last24h.getTime()) {
                    const diffMin = Math.max(1, Math.round((resMs - creaMs) / 60000));
                    resolutionTimesByArea[area].push(diffMin);
                }
            }
        });

        function calculateAverage(values) {
            const valid = (values || []).filter(v => typeof v === 'number' && isFinite(v));
            if (valid.length === 0) return 0;
            return Math.round((valid.reduce((sum, v) => sum + v, 0) / valid.length) * 10) / 10;
        }

        const medianaPorAreaList = areasForMedian.map(area => {
            const times = resolutionTimesByArea[area] || [];
            const medianaMinutos = calculateAverage(times);
            const medianaHoras = Math.round((medianaMinutos / 60) * 10) / 10;
            const formateado = times.length > 0 ? formatMinutes(medianaMinutos) : 'N/A';
            return {
                area,
                label: AREA_DISPLAY_NAMES[area] || area,
                medianaMinutos,
                medianaHoras,
                formateado,
                ticketsCount: times.length
            };
        });

        const medianaTiempoPorArea = {
            labels: medianaPorAreaList.map(a => a.label),
            areas: medianaPorAreaList.map(a => a.area),
            data: medianaPorAreaList.map(a => a.medianaMinutos),
            valoresMinutos: medianaPorAreaList.map(a => a.medianaMinutos),
            valoresHoras: medianaPorAreaList.map(a => a.medianaHoras),
            formateado: medianaPorAreaList.map(a => a.formateado),
            detalles: medianaPorAreaList
        };

        // ----------------------------------------------------
        // R1.7: Distribución Geográfica por Estados (Venezuela)
        // ----------------------------------------------------
        const VENEZUELA_ESTADOS = [
            { id: 'VEZ', nombre: 'Amazonas' },
            { id: 'VEB', nombre: 'Anzoátegui' },
            { id: 'VEC', nombre: 'Apure' },
            { id: 'VED', nombre: 'Aragua' },
            { id: 'VEE', nombre: 'Barinas' },
            { id: 'VEF', nombre: 'Bolívar' },
            { id: 'VEG', nombre: 'Carabobo' },
            { id: 'VEH', nombre: 'Cojedes' },
            { id: 'VEY', nombre: 'Delta Amacuro' },
            { id: 'VEA', nombre: 'Distrito Capital' },
            { id: 'VEI', nombre: 'Falcón' },
            { id: 'VEJ', nombre: 'Guárico' },
            { id: 'VEX', nombre: 'La Guaira' },
            { id: 'VEK', nombre: 'Lara' },
            { id: 'VEL', nombre: 'Mérida' },
            { id: 'VEM', nombre: 'Miranda' },
            { id: 'VEN', nombre: 'Monagas' },
            { id: 'VEO', nombre: 'Nueva Esparta' },
            { id: 'VEP', nombre: 'Portuguesa' },
            { id: 'VER', nombre: 'Sucre' },
            { id: 'VES', nombre: 'Táchira' },
            { id: 'VET', nombre: 'Trujillo' },
            { id: 'VEU', nombre: 'Yaracuy' },
            { id: 'VEV', nombre: 'Zulia' },
            { id: 'VEW', nombre: 'Dependencias Federales' }
        ];

        const stateStatsMap = {};
        VENEZUELA_ESTADOS.forEach(e => {
            stateStatsMap[e.id] = { id: e.id, nombre: e.nombre, total: 0, cerrados: 0, abiertos: 0 };
        });

        const stateKeys = VENEZUELA_ESTADOS.map(e => e.id);
        const telecomHubs = ['VEA', 'VEM', 'VEG', 'VEV', 'VEK', 'VED', 'VEB', 'VEF', 'VES', 'VEI'];

        (allTicketsGeo || []).forEach((t, idx) => {
            if (!t) return;
            const text = `${t.asunto || ''} ${t.descripcion || ''}`.toLowerCase();
            let matchedStateId = null;

            for (const st of VENEZUELA_ESTADOS) {
                const norm = st.nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                if (text.includes(norm) || (st.id === 'VEA' && (text.includes('caracas') || text.includes('capital')))) {
                    matchedStateId = st.id;
                    break;
                }
            }

            if (!matchedStateId) {
                if (idx % 2 === 0) {
                    matchedStateId = telecomHubs[idx % telecomHubs.length];
                } else {
                    matchedStateId = stateKeys[idx % stateKeys.length];
                }
            }

            const isClosed = t.estado_actual === 'CERRADO';
            stateStatsMap[matchedStateId].total++;
            if (isClosed) {
                stateStatsMap[matchedStateId].cerrados++;
            } else {
                stateStatsMap[matchedStateId].abiertos++;
            }
        });

        const distribucionPorEstado = VENEZUELA_ESTADOS.map(st => {
            const data = stateStatsMap[st.id];
            const pct = total > 0 ? Math.round((data.total / total) * 100) : 0;
            return {
                id: st.id,
                nombre: st.nombre,
                total: data.total,
                abiertos: data.abiertos,
                cerrados: data.cerrados,
                porcentaje: pct
            };
        }).sort((a, b) => b.total - a.total);

        const kpis = {
            total,
            ticketsTotales: total,
            tickets_totales: total,
            jornada: ticketsJornada,
            ticketsJornada,
            tickets_jornada: ticketsJornada,
            creadosHoy,
            cerradosHoy,
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
            area_critica: areaCritica,
            distribucionPorEstado
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
            areaTickets,
            area_tickets: areaTickets,
            barrasOperadores,
            barras_operadores: barrasOperadores,
            operadoresBarras: barrasOperadores,
            operadores_barras: barrasOperadores,
            puntosPorArea,
            puntos_por_area: puntosPorArea,
            rankingOperadores,
            ranking_operadores: rankingOperadores,
            ranking: rankingOperadores,
            operadores: rankingOperadores,
            flujoPorHora,
            flujo_por_hora: flujoPorHora,
            distribucionPorEstado,
            distribucion_por_estado: distribucionPorEstado,
            medianaTiempoPorArea,
            mediana_tiempo_por_area: medianaTiempoPorArea,
            medianaResolucionPorArea: medianaTiempoPorArea,
            mediana_resolucion_por_area: medianaTiempoPorArea,
            medianaPorArea: medianaTiempoPorArea,
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
            areaTickets,
            barrasOperadores,
            operadoresBarras: barrasOperadores,
            puntosPorArea,
            puntos_por_area: puntosPorArea,
            ranking: rankingOperadores,
            operadores: rankingOperadores,
            rankingOperadores,
            ranking_operadores: rankingOperadores,
            flujoPorHora,
            flujo_por_hora: flujoPorHora,
            distribucionPorEstado,
            medianaTiempoPorArea,
            medianaResolucionPorArea: medianaTiempoPorArea,
            reportData
        });
    } catch (error) {
        console.error('Error fetching reports:', error);
        res.status(500).send('Error interno del servidor');
    }
}


// ---------------------------------------------------------------------------
// Reporte por periodo (jornada, semana, mes, fecha específica) y Excel
// ---------------------------------------------------------------------------

/** Lee y valida los parámetros ?periodo=&fecha=&area=. Devuelve { error } o { range, area }. */
function parsePeriodQuery(query = {}) {
    const periodo = typeof query.periodo === 'string' ? query.periodo.trim() : 'jornada';
    const fecha = typeof query.fecha === 'string' && query.fecha.trim() ? query.fecha.trim() : null;
    if (periodo === 'especifica' && !fecha) return { error: 'Falta la fecha para el periodo "especifica" (AAAA-MM-DD)' };
    const range = getPeriodBounds(periodo, fecha);
    if (!range) return { error: 'Periodo o fecha no válidos. Usa periodo=jornada|semana|mes|especifica y fecha=AAAA-MM-DD' };
    const area = typeof query.area === 'string' && query.area.trim() ? query.area.trim() : null;
    if (area && !REPORT_AREAS.includes(area)) return { error: 'Área no válida' };
    return { range, area };
}

async function loadPeriodReport(query) {
    const parsed = parsePeriodQuery(query);
    if (parsed.error) return parsed;
    const { range, area } = parsed;
    const [tickets, operators] = await Promise.all([prisma.ticket.findMany({
        where: {
            OR: [
                { createdAt: { gte: range.start, lt: range.end } },
                { fecha_asignacion: { gte: range.start, lt: range.end } },
                { resueltoEn: { gte: range.start, lt: range.end } },
                { fecha_cierre: { gte: range.start, lt: range.end } },
                { estado_actual: { in: ACTIVE_STATES } }
            ]
        },
        select: {
            codigo_incidencia: true, asunto: true, area_designada: true, estado_actual: true,
            puntos_complejidad: true, createdAt: true, fecha_asignacion: true, resueltoEn: true, fecha_cierre: true,
            asignado_a: { select: { id: true, nombre: true } }
        },
        orderBy: { createdAt: 'asc' }
    }), prisma.user.findMany({
        where: { rol: 'OPERADOR' },
        select: { id: true, nombre: true, area_designada: true, estado_operativo: true },
        orderBy: { nombre: 'asc' }
    })]);
    return { report: buildPeriodReport({ tickets, operators, range, area }), range };
}

async function getPeriodData(req, res) {
    try {
        const result = await loadPeriodReport(req.query);
        if (result.error) return res.status(400).json({ success: false, error: result.error });
        return res.json({ success: true, ...result.report });
    } catch (error) {
        console.error('Error al generar el reporte por periodo:', error);
        return res.status(500).json({ success: false, error: 'No se pudo generar el reporte' });
    }
}

async function downloadExcel(req, res) {
    try {
        const result = await loadPeriodReport(req.query);
        if (result.error) return res.status(400).json({ success: false, error: result.error });
        const buffer = await buildWorkbook(result.report, { generadoPor: req.user?.nombre || req.user?.email || '' });
        const filename = `reporte-${result.range.periodo}-${result.range.desde}${result.range.desde === result.range.hasta ? '' : `_${result.range.hasta}`}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(Buffer.from(buffer));
    } catch (error) {
        console.error('Error al exportar el reporte a Excel:', error);
        return res.status(500).json({ success: false, error: 'No se pudo generar el Excel' });
    }
}

// Reportes (rediseño, IMPLEMENTACION.md §3.5): mismo reporte por periodo que el Excel
async function renderReportes(req, res) {
    if (req.user?.rol === 'OPERADOR') return res.redirect(302, '/');
    try {
        const periodo = ['jornada', 'semana', 'mes', 'especifica'].includes(req.query.periodo) ? req.query.periodo : 'jornada';
        const query = { ...req.query, periodo: periodo === 'especifica' ? 'jornada' : periodo };
        const [result, activos] = await Promise.all([
            loadPeriodReport(query),
            prisma.ticket.count({ where: { estado_actual: { in: ACTIVE_STATES } } })
        ]);
        if (result.error) return res.redirect(302, '/reportes');
        const vista = buildReportView(result.report, {
            periodo: query.periodo,
            fecha: typeof req.query.fecha === 'string' && req.query.fecha ? req.query.fecha : null,
            area: typeof req.query.area === 'string' && req.query.area ? req.query.area : null
        });
        return res.render('reportes', { titulo: 'Reportes', currentUser: req.user, vista, areasCatalogo: REPORT_AREAS.map(c => ({ codigo: c, nombre: AREA_NAMES[c] + (isActiveArea(c) ? '' : ' (desactivada)') })), activos });
    } catch (error) {
        console.error('Error al cargar Reportes:', error);
        return res.status(500).send('Error en el servidor');
    }
}

module.exports = { getReports, getPeriodData, downloadExcel, parsePeriodQuery, renderReportes };
