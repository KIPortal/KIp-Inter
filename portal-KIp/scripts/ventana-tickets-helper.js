// Ayuda de las pruebas: tickets al azar (con cerrados viejos) y un filtro que
// imita en memoria el `where` de ventanaDashboard / ventanaCola.
const ESTADOS = ['NUEVO', 'EN_PROGRESO', 'EN_PAUSA', 'EN_ESPERA_TERCEROS', 'RESUELTO', 'CERRADO', 'CERRADO', 'CERRADO'];
const AREAS = ['WAN', 'REDES_FTTH', 'TELEFONIA', 'GENERAL'];

function ticketsAlAzar(now, n = 400, semilla = 7) {
    let s = semilla;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const H = 3600 * 1000;
    return Array.from({ length: n }, (_, i) => {
        const creado = new Date(now.getTime() - rnd() * 40 * 24 * H);
        const estado = ESTADOS[Math.floor(rnd() * ESTADOS.length)];
        const despues = h => new Date(Math.min(now.getTime(), creado.getTime() + h * H));
        const asignado = rnd() < 0.8;
        return {
            codigo_incidencia: `INC-${i + 1}`, estado_actual: estado, area_designada: AREAS[i % AREAS.length],
            puntos_complejidad: [0, 1, 5, 8][i % 4], asignado_a_id: asignado ? ['a', 'b', 'c'][i % 3] : null,
            createdAt: creado, updatedAt: despues(rnd() * 30),
            fecha_asignacion: asignado ? despues(rnd() * 2) : null,
            resueltoEn: ['RESUELTO', 'CERRADO'].includes(estado) && rnd() < 0.9 ? despues(rnd() * 48) : null,
            fecha_cierre: estado === 'CERRADO' && rnd() < 0.9 ? despues(48 + rnd() * 48) : null
        };
    });
}

function cumple(ticket, where) {
    return where.OR.some(cond => Object.entries(cond).every(([campo, regla]) => {
        if ('not' in regla) return ticket[campo] !== regla.not;
        return ticket[campo] != null && new Date(ticket[campo]).getTime() >= regla.gte.getTime();
    }));
}

module.exports = { ticketsAlAzar, cumple };
