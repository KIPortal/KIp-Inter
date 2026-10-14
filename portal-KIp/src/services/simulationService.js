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

// Equipo demo parecido al del diseño: 14 operadores en las 7 áreas.
// guardia: de guardia esta semana · horario: propio (si no, L–V 08:00–17:00) · estado: operativo
const OPERADORES = [
    { key: 'ftth1', nombre: 'Demo FTTH 1', area: 'REDES_FTTH' },
    { key: 'ftth2', nombre: 'Demo FTTH 2', area: 'REDES_FTTH' },
    { key: 'ftth3', nombre: 'Demo FTTH 3', area: 'REDES_FTTH', horario: { dias: [1, 2, 3, 4, 5], inicio: '10:00', fin: '19:00' } },
    { key: 'ftth4', nombre: 'Demo FTTH 4', area: 'REDES_FTTH', guardia: true },
    { key: 'wan1', nombre: 'Demo WAN 1', area: 'WAN' },
    { key: 'wan2', nombre: 'Demo WAN 2', area: 'WAN', estado: 'EN_TERRENO' },
    { key: 'gc1', nombre: 'Demo Grandes Clientes 1', area: 'GRANDES_CLIENTES' },
    { key: 'gc2', nombre: 'Demo Grandes Clientes 2', area: 'GRANDES_CLIENTES', horario: { dias: [1, 2, 3, 4, 5, 6], inicio: '07:00', fin: '15:00' } },
    { key: 'inal1', nombre: 'Demo Inalámbrico 1', area: 'TRAFICO_INALAMBRICO' },
    { key: 'inal2', nombre: 'Demo Inalámbrico 2', area: 'TRAFICO_INALAMBRICO', guardia: true },
    { key: 'tele1', nombre: 'Demo Telefonía 1', area: 'TELEFONIA', guardia: true },
    { key: 'tele2', nombre: 'Demo Telefonía 2', area: 'TELEFONIA' },
    { key: 'seg1', nombre: 'Demo Seguridad 1', area: 'SEGURIDAD' },
    { key: 'gen1', nombre: 'Demo Operaciones 1', area: 'GENERAL' }
];

const ASUNTOS = {
    REDES_FTTH: ['Corte de fibra en sector Norte', 'Degradación en nodo FTTH', 'OLT sin respuesta', 'Revisión de empalme en caja NAP'],
    WAN: ['BGP inestable con upstream', 'Pérdida de paquetes en circuito MPLS', 'Saturación en enlace WAN principal'],
    TELEFONIA: ['Troncal SIP caída', 'Cola de llamadas desbordada en PBX', 'Eco en conferencias'],
    SEGURIDAD: ['Alerta IDS de tráfico anómalo', 'Certificado SSL expirado', 'Revisión de política de ACL'],
    TRAFICO_INALAMBRICO: ['Interferencia en radioenlace', 'Alta latencia en sector wireless'],
    GRANDES_CLIENTES: ['Corte de servicio corporativo', 'Baja velocidad contratada detectada'],
    GENERAL: ['Consulta de cliente sin clasificar', 'Solicitud de reporte de disponibilidad']
};
const AREA_PESO = [['REDES_FTTH', 34], ['WAN', 22], ['TELEFONIA', 12], ['SEGURIDAD', 9], ['TRAFICO_INALAMBRICO', 9], ['GRANDES_CLIENTES', 9], ['GENERAL', 5]];

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
 * @param {number} [o.desde]   número del primer código SIM-xxx (para simular varios días)
 */
function buildSimulation({ fecha, cantidad = 40, seed = 7, ahora = null, desde = 1 }) {
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
            codigo: '',
            asunto: lista[Math.floor(rand() * lista.length)],
            area, prioridad, puntos: PUNTOS[prioridad], creado
        });
    }
    tickets.sort((a, b) => a.creado - b.creado).forEach((t, i) => { t.codigo = `${PREFIJO_CODIGO}${String(desde + i).padStart(3, '0')}`; });

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
        } else {
            const r = rand();
            if (r < 0.18) t.estado = 'EN_PAUSA';
            else if (r < 0.32) t.estado = 'EN_ESPERA_TERCEROS';
        }
        if (['EN_PROGRESO', 'EN_PAUSA', 'EN_ESPERA_TERCEROS'].includes(t.estado)) carga.set(t.operadorKey, carga.get(t.operadorKey) + 1);
    }
    const f = ms => (ms == null ? null : new Date(ms));
    return {
        fecha, operadores,
        tickets: tickets.map(t => ({ ...t, creado: f(t.creado), asignado: f(t.asignado), resuelto: f(t.resuelto), cierre: f(t.cierre) }))
    };
}

const DAY_MS = 24 * 3600000;
const ymd = ms => new Date(ms - 4 * 3600000).toISOString().slice(0, 10);

/**
 * Datos demo "como en el diseño": ayer completo (para Reportes) y hoy hasta
 * `ahora`, con tantos tickets como corresponden a la hora del día; más un
 * traspaso a guardia de anoche con los pendientes de ayer.
 * @param {object} o
 * @param {Date}   o.ahora
 * @param {number} [o.porDia]  tickets de un día completo (por defecto 55)
 * @param {number} [o.seed]
 */
function buildDemo({ ahora, porDia = 55, seed = 7 }) {
    const nowMs = new Date(ahora).getTime();
    const hoy = ymd(nowMs);
    const ayer = ymd(nowMs - DAY_MS);
    const inicioHoy = new Date(`${hoy}T00:00:00-04:00`).getTime();
    // Fracción del volumen diario que ya llegó según la curva de llegada por hora
    const horaActual = (nowMs - inicioHoy) / 3600000;
    const total = PESO_HORA.reduce((a, b) => a + b, 0);
    const llegado = PESO_HORA.reduce((acc, w, h) => acc + w * Math.max(0, Math.min(1, horaActual - h)), 0);
    const cantidadHoy = Math.max(3, Math.round(porDia * llegado / total));

    const diaAyer = buildSimulation({ fecha: ayer, cantidad: porDia, seed, desde: 1 });
    const diaHoy = buildSimulation({ fecha: hoy, cantidad: cantidadHoy, seed: seed + 1, ahora: new Date(nowMs), desde: porDia + 1 });

    // Traspaso de anoche (16:45): pendientes de ayer, que no cambian de operador
    const pendientes = diaAyer.tickets.filter(t => ['NUEVO', 'EN_PROGRESO', 'EN_PAUSA', 'EN_ESPERA_TERCEROS'].includes(t.estado)).map(t => t.codigo);
    const traspaso = pendientes.length ? {
        creado: new Date(`${ayer}T16:45:00-04:00`),
        nota: `${MARCA_REMITENTE}: quedan ${pendientes.length} pendientes; revisar primero los P1 y la saturación en WAN.`,
        codigos: pendientes
    } : null;

    return {
        operadores: diaAyer.operadores,
        dias: [{ fecha: ayer, tickets: diaAyer.tickets }, { fecha: hoy, tickets: diaHoy.tickets }],
        tickets: diaAyer.tickets.concat(diaHoy.tickets),
        traspaso
    };
}

module.exports = { buildSimulation, buildDemo, MARCA_REMITENTE, DOMINIO_DEMO, PREFIJO_CODIGO, OPERADORES };
