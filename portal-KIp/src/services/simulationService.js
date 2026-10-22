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
const { puntosDeNivel } = require('./tipoCasoService');
// Nivel de dificultad de los casos "Otro" (fuera del catálogo) y de las áreas sin tipos de caso
const NIVEL_PESO = [[1, 30], [2, 45], [3, 18], [4, 7]];
// Tasa de ocurrencia: un caso de frecuencia Alta llega 6 veces más que uno de frecuencia Baja
const FRECUENCIA_PESO = { ALTA: 6, MEDIA: 3, BAJA: 1 };
// Parte de los casos de un área con catálogo que no está en él (se clasifican como "Otro")
const PCT_OTRO = 0.1;

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

// Reparto geográfico de la demo (como el mapa del diseño): Caracas y el centro concentran la carga.
const ESTADO_PESO = [['VEA', 9], ['VEV', 7], ['VEG', 6], ['VEF', 5], ['VEM', 5], ['VEK', 4], ['VED', 3], ['VEB', 3],
    ['VEL', 2], ['VES', 2], ['VEN', 1], ['VEX', 1], [null, 2]];

const emailDe = key => `${key}@${DOMINIO_DEMO}`;

/**
 * @param {object} o
 * @param {string} o.fecha     AAAA-MM-DD (día de Caracas)
 * @param {number} [o.cantidad] tickets a crear (por defecto 40)
 * @param {number} [o.seed]
 * @param {Date}   [o.ahora]   si la fecha es hoy, nada ocurre después de este instante
 * @param {number} [o.desde]   número del primer código SIM-xxx (para simular varios días)
 * @param {Array}  [o.tipos]   catálogo de tipos de caso [{ id, nombre, area, nivel, minutos, frecuencia }]
 *                             (Administración → Tipos de caso). En un área con tipos, cada ticket es uno
 *                             de ellos, elegido según su frecuencia, y su tiempo sale del estimado.
 */
function buildSimulation({ fecha, cantidad = 40, seed = 7, ahora = null, desde = 1, sinAsignar = 7, tipos = [] }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) throw new Error('fecha inválida (AAAA-MM-DD)');
    const rand = rng(seed);
    const randEstado = rng(seed + 1000); // aparte, para no alterar el resto de la simulación
    const randTipo = rng(seed + 3000); // igual con el tipo de caso
    const tiposDe = new Map();
    (tipos || []).filter(x => x && x.activo !== false && x.nivel).forEach(x => {
        if (!tiposDe.has(x.area)) tiposDe.set(x.area, []);
        tiposDe.get(x.area).push([x, FRECUENCIA_PESO[x.frecuencia] || FRECUENCIA_PESO.MEDIA]);
    });
    const randNivel = rng(seed + 2000); // igual con el nivel de dificultad
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
        let asunto = lista[Math.floor(rand() * lista.length)];
        // Caso común del catálogo del área (según su frecuencia), o "Otro" con un nivel al azar
        const delArea = tiposDe.get(area);
        const tipo = delArea && randTipo() >= PCT_OTRO ? pick(randTipo, delArea) : null;
        const nivel = tipo ? tipo.nivel : pick(randNivel, NIVEL_PESO);
        if (tipo) asunto = tipo.nombre;
        tickets.push({
            codigo: '',
            asunto,
            area, prioridad, nivel, tipoId: tipo ? tipo.id : null, minutosEstimados: tipo ? tipo.minutos || null : null,
            puntos: puntosDeNivel(nivel), creado, estadoVe: pick(randEstado, ESTADO_PESO)
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
        if (asignado >= limite || rand() < sinAsignar / 100) continue; // algunos quedan en la cola del área, sin asignar
        t.operadorKey = elegido.key; t.asignado = asignado; t.estado = 'EN_PROGRESO';
        // Tiempo de trabajo: el estimado del tipo de caso; sin él, según la prioridad
        const base = t.minutosEstimados || { P1: 90, P2: 150, P3: 70, NONE: 100 }[t.prioridad];
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
    // Los que siguen en la cola sin tomar aún no tienen tipo de caso: lo elige quien los tome
    tickets.filter(t => !t.operadorKey).forEach(t => { t.nivel = null; t.tipoId = null; t.puntos = 0; });
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
 * @param {number} [o.sinAsignar]  % de los tickets de hoy que quedan en la cola del área (por defecto 7)
 */
function buildDemo({ ahora, porDia = 55, seed = 7, sinAsignar = 7, tipos = [] }) {
    const nowMs = new Date(ahora).getTime();
    const hoy = ymd(nowMs);
    const ayer = ymd(nowMs - DAY_MS);
    const inicioHoy = new Date(`${hoy}T00:00:00-04:00`).getTime();
    // Fracción del volumen diario que ya llegó según la curva de llegada por hora
    const horaActual = (nowMs - inicioHoy) / 3600000;
    const total = PESO_HORA.reduce((a, b) => a + b, 0);
    const llegado = PESO_HORA.reduce((acc, w, h) => acc + w * Math.max(0, Math.min(1, horaActual - h)), 0);
    const cantidadHoy = Math.max(3, Math.round(porDia * llegado / total));

    const diaAyer = buildSimulation({ fecha: ayer, cantidad: porDia, seed, desde: 1, tipos });
    // El % sin asignar solo aplica a hoy: ayer el coordinador ya repartió todo lo que pudo
    const diaHoy = buildSimulation({ fecha: hoy, cantidad: cantidadHoy, seed: seed + 1, ahora: new Date(nowMs), desde: porDia + 1, sinAsignar, tipos });

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

/**
 * Reparte los tickets simulados entre operadores reales (no crea usuarios demo).
 * Cada ticket va a un operador de su misma área; si su área no tiene operadores
 * reales, pasa a un área que sí tenga (proporcional a cuántos operadores tiene).
 * Los que en la simulación quedaron sin asignar siguen sin asignar.
 * @param {Array} tickets  de buildSimulation/buildDemo (con area y operadorKey)
 * @param {Array} reales   [{ id, nombre, area_designada, subgrupo_id? }]
 * @returns {Array} copias de los tickets con area, operadorId, operadorNombre y subgrupoId
 */
function asignarAReales(tickets, reales) {
    const porArea = new Map();
    (reales || []).forEach(o => {
        if (!porArea.has(o.area_designada)) porArea.set(o.area_designada, []);
        porArea.get(o.area_designada).push(o);
    });
    if (!porArea.size) return null;
    // Áreas de reemplazo: una entrada por operador, así un área con más gente recibe más
    const relleno = [...porArea.entries()].flatMap(([area, ops]) => ops.map(() => area));
    const turno = new Map();
    let i = 0;
    return tickets.map(t => {
        const area = porArea.has(t.area) ? t.area : relleno[i++ % relleno.length];
        const out = { ...t, area, operadorId: null, operadorNombre: null, subgrupoId: null };
        // Si pasó a otra área, su tipo de caso no es de ella: queda como "Otro" con el mismo nivel
        if (area !== t.area) out.tipoId = null;
        if (t.operadorKey) {
            const ops = porArea.get(area);
            const n = turno.get(area) || 0;
            const op = ops[n % ops.length];
            turno.set(area, n + 1);
            Object.assign(out, { operadorId: op.id, operadorNombre: op.nombre, subgrupoId: op.subgrupo_id || null });
        }
        return out;
    });
}

/** Tipos de caso activos de la base, con la forma que usa la simulación ([] si aún no hay tabla). */
async function cargarTiposCaso(prisma) {
    try {
        const filas = await prisma.tipoCaso.findMany({ where: { activo: true } });
        return filas.map(x => ({ id: x.id, nombre: x.nombre, area: x.area_codigo, nivel: x.nivel, minutos: x.minutos_estimados, frecuencia: x.frecuencia }));
    } catch (e) {
        console.error('Sin tipos de caso (¿falta la migración?): se simula con niveles al azar.');
        return [];
    }
}

module.exports = { cargarTiposCaso, buildSimulation, buildDemo, asignarAReales, MARCA_REMITENTE, DOMINIO_DEMO, PREFIJO_CODIGO, OPERADORES };
