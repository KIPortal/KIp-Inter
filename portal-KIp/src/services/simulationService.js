'use strict';

/**
 * Simulación de una jornada (datos de demostración). Función pura y determinista:
 * la misma semilla produce siempre la misma jornada. No toca la base de datos.
 * Todo lo generado queda marcado: remitente 'SIMULACION', códigos 'SIM-xxx' y
 * correos '@demo.local', para poder limpiarlo sin afectar datos reales.
 */

const MARCA_REMITENTE = 'SIMULACION';
const DOMINIO_DEMO = 'demo.local';
const PREFIJO_CODIGO = 'SIM-';
const PUNTOS = { P1: 8, P2: 5, P3: 1, NONE: 0 };

const OPERADORES = [
    { key: 'ftth1', nombre: 'Demo FTTH 1', area: 'REDES_FTTH' },
    { key: 'ftth2', nombre: 'Demo FTTH 2', area: 'REDES_FTTH' },
    { key: 'ftth3', nombre: 'Demo FTTH 3', area: 'REDES_FTTH' },
    { key: 'wan1', nombre: 'Demo WAN 1', area: 'WAN' },
    { key: 'wan2', nombre: 'Demo WAN 2', area: 'WAN' },
    { key: 'tele1', nombre: 'Demo Telefonía 1', area: 'TELEFONIA' },
    { key: 'seg1', nombre: 'Demo Seguridad 1', area: 'SEGURIDAD' },
    { key: 'inal1', nombre: 'Demo Inalámbrico 1', area: 'TRAFICO_INALAMBRICO' },
    { key: 'gc1', nombre: 'Demo Grandes Clientes 1', area: 'GRANDES_CLIENTES' }
];

const ASUNTOS = {
    REDES_FTTH: ['Corte de fibra en sector Norte', 'Degradación en nodo FTTH', 'OLT sin respuesta', 'Revisión de empalme en caja NAP'],
    WAN: ['BGP inestable con upstream', 'Pérdida de paquetes en circuito MPLS', 'Saturación en enlace WAN principal'],
    TELEFONIA: ['Troncal SIP caída', 'Cola de llamadas desbordada en PBX', 'Eco en conferencias'],
    SEGURIDAD: ['Alerta IDS de tráfico anómalo', 'Certificado SSL expirado', 'Revisión de política de ACL'],
    TRAFICO_INALAMBRICO: ['Interferencia en radioenlace', 'Alta latencia en sector wireless'],
    GRANDES_CLIENTES: ['Corte de servicio corporativo', 'Baja velocidad contratada detectada']
};
const AREA_PESO = [['REDES_FTTH', 36], ['WAN', 24], ['TELEFONIA', 14], ['SEGURIDAD', 10], ['TRAFICO_INALAMBRICO', 8], ['GRANDES_CLIENTES', 8]];

// Peso de llegada por hora de Caracas: pico a media mañana y tras el almuerzo
const PESO_HORA = [1, 1, 1, 1, 1, 1, 2, 4, 9, 12, 12, 10, 6, 9, 11, 10, 8, 5, 3, 2, 2, 1, 1, 1];

function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function pick(rand, weighted) {
    const total = weighted.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    for (const [v, w] of weighted) { if ((r -= w) < 0) return v; }
    return weighted[weighted.length - 1][0];
}

const emailDe = key => `${key}@${DOMINIO_DEMO}`;

/**
 * @param {object} o
 * @param {string} o.fecha     AAAA-MM-DD (día de Caracas)
 * @param {number} [o.cantidad] tickets a crear (por defecto 40)
 * @param {number} [o.seed]
 * @param {Date}   [o.ahora]   si la fecha es hoy, nada ocurre después de este instante
 */
function buildSimulation({ fecha, cantidad = 40, seed = 7, ahora = null }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) throw new Error('fecha inválida (AAAA-MM-DD)');
    const rand = rng(seed);
    const dayStart = new Date(`${fecha}T00:00:00-04:00`).getTime();
    const limite = ahora ? new Date(ahora).getTime() : dayStart + 24 * 3600000;
    const min = 60000;
    const coloca = (hora, offsetMin) => dayStart + hora * 60 * min + offsetMin * min;

    const horas = PESO_HORA.map((w, h) => [h, w]);
    const operadores = OPERADORES.map(o => ({ ...o, email: emailDe(o.key) }));
    const porArea = area => operadores.filter(o => o.area === area);
    const carga = new Map(operadores.map(o => [o.key, 0]));

    const tickets = [];
    for (let i = 0; i < cantidad; i++) {
        const hora = pick(rand, horas);
        const creado = coloca(hora, Math.floor(rand() * 60));
        if (creado >= limite) { i--; if (limite <= dayStart + 60 * min) break; continue; }
        const area = pick(rand, AREA_PESO);
        const prioridad = pick(rand, [['P1', 12], ['P2', 33], ['P3', 45], ['NONE', 10]]);
        const lista = ASUNTOS[area];
        tickets.push({
            codigo: `${PREFIJO_CODIGO}${String(i + 1).padStart(3, '0')}`,
            asunto: lista[Math.floor(rand() * lista.length)],
            area, prioridad, puntos: PUNTOS[prioridad], creado
        });
    }
    tickets.sort((a, b) => a.creado - b.creado).forEach((t, i) => { t.codigo = `${PREFIJO_CODIGO}${String(i + 1).padStart(3, '0')}`; });

    // Ciclo de vida: asignación (el coordinador reparte), resolución y cierre
    for (const t of tickets) {
        const ops = porArea(t.area);
        t.operadorKey = null; t.estado = 'NUEVO'; t.asignado = null; t.resuelto = null; t.cierre = null;
        if (!ops.length) continue;
        // Caso de sobrecarga intencional: parte de WAN recae en un solo operador
        const elegido = t.area === 'WAN' && rand() < 0.8 ? ops[0]
            : [...ops].sort((a, b) => carga.get(a.key) - carga.get(b.key))[0];
        const asignado = t.creado + (3 + Math.floor(rand() * 25)) * min;
        if (asignado >= limite || rand() < 0.07) continue; // algunos quedan sin asignar
        t.operadorKey = elegido.key; t.asignado = asignado; t.estado = 'EN_PROGRESO';
        const base = { P1: 90, P2: 150, P3: 70, NONE: 100 }[t.prioridad];
        const resuelto = asignado + Math.max(10, Math.round(base * (0.4 + rand() * 1.4))) * min;
        const quedaAbierto = t.area === 'WAN' && elegido.key === 'wan1' && rand() < 0.55; // acumula carga activa
        if (resuelto < limite && !quedaAbierto) {
            t.resuelto = resuelto; t.estado = 'RESUELTO';
            const cierre = resuelto + (5 + Math.floor(rand() * 90)) * min;
            if (cierre < limite && rand() < 0.75) { t.cierre = cierre; t.estado = 'CERRADO'; }
        } else if (rand() < 0.2) {
            t.estado = 'EN_PAUSA';
        }
        if (t.estado === 'EN_PROGRESO' || t.estado === 'EN_PAUSA') carga.set(t.operadorKey, carga.get(t.operadorKey) + 1);
    }
    const f = ms => (ms == null ? null : new Date(ms));
    return {
        fecha, operadores,
        tickets: tickets.map(t => ({ ...t, creado: f(t.creado), asignado: f(t.asignado), resuelto: f(t.resuelto), cierre: f(t.cierre) }))
    };
}

module.exports = { buildSimulation, MARCA_REMITENTE, DOMINIO_DEMO, PREFIJO_CODIGO, OPERADORES };
