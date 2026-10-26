'use strict';

/**
 * Subida de prioridad por tiempo sin asignar (Administración → Reglas → Antigüedad).
 *
 * Un ticket NUEVO que nadie ha tomado sube un escalón cuando pasa el tiempo de
 * antigüedad de su prioridad: sin prioridad → la sugerida por palabras clave (o P3),
 * P3 → P2, P2 → P1. El tiempo se cuenta desde que llegó o desde su última subida
 * (`Ticket.prioridad_subida_en`). Cada subida queda en Auditoría.
 *
 * `escalones` es pura (ver scripts/test-escalado.js); `revisarEscalado` la aplica en la base.
 */

const { mergeRules } = require('./rulesService');

const SIGUIENTE = Object.freeze({ P3: 'P2', P2: 'P1' });
const MINUTE_MS = 60 * 1000;
const INTERVALO_MS = 60 * 1000;

const actual = p => (['P1', 'P2', 'P3'].includes(p) ? p : 'SP');
const fmtMin = m => (m < 60 ? `${m} min` : `${String(Math.round(m / 6) / 10).replace('.', ',')} h`);

/**
 * Tickets que deben subir de prioridad ahora: [{ id, codigo, de, a, minutos }].
 * @param {Array} tickets  { id, codigo_incidencia, estado_actual, asignado_a_id, prioridad, prioridad_sugerida, createdAt, prioridad_subida_en }
 */
function escalones(tickets, now = new Date(), rules = mergeRules()) {
    const ag = rules.antiguedad;
    if (!ag.activa || !ag.subirPrioridad) return [];
    const nowMs = new Date(now).getTime();
    const out = [];
    (tickets || []).forEach(t => {
        if (!t || t.estado_actual !== 'NUEVO' || t.asignado_a_id || t.eliminado_en) return;
        const de = actual(t.prioridad);
        const a = de === 'SP' ? (['P1', 'P2', 'P3'].includes(t.prioridad_sugerida) ? t.prioridad_sugerida : 'P3') : SIGUIENTE[de];
        if (!a) return; // P1 ya es la más alta
        const desde = new Date(t.prioridad_subida_en || t.createdAt).getTime();
        const limite = ag[de];
        if (!Number.isFinite(desde) || !limite || nowMs - desde < limite * MINUTE_MS) return;
        out.push({ id: t.id, codigo: t.codigo_incidencia, de, a, minutos: limite });
    });
    return out;
}

/** Revisa la cola y sube las prioridades que correspondan. Devuelve cuántos subieron. */
async function revisarEscalado(prisma, now = new Date()) {
    const { loadConfig } = require('./configService');
    const { reglas } = await loadConfig(prisma);
    if (!reglas.antiguedad.activa || !reglas.antiguedad.subirPrioridad) return 0;
    const tickets = await prisma.ticket.findMany({
        where: { estado_actual: 'NUEVO', asignado_a_id: null, eliminado_en: null, OR: [{ prioridad: null }, { prioridad: { not: 'P1' } }] },
        select: { id: true, codigo_incidencia: true, estado_actual: true, asignado_a_id: true, prioridad: true, prioridad_sugerida: true, createdAt: true, prioridad_subida_en: true }
    });
    let subidos = 0;
    for (const e of escalones(tickets, now, reglas)) {
        // Solo si sigue igual (nadie lo tomó ni cambió su prioridad mientras tanto)
        const r = await prisma.ticket.updateMany({
            where: { id: e.id, estado_actual: 'NUEVO', asignado_a_id: null, prioridad: e.de === 'SP' ? null : e.de },
            data: { prioridad: e.a, prioridad_subida_en: now }
        });
        if (r.count !== 1) continue;
        subidos++;
        await prisma.auditLog.create({
            data: {
                accion: 'PRIORIDAD_SUBIDA', ticketId: e.id, userId: null,
                detalles: `Sin asignar por más de ${fmtMin(e.minutos)}: prioridad ${e.de === 'SP' ? 'sin prioridad' : e.de} → ${e.a}`
            }
        }).catch(err => console.error('No se pudo registrar auditoría:', err.message));
    }
    return subidos;
}

/** Revisión cada minuto mientras el portal está encendido. */
function programarEscalado(prisma) {
    const tick = () => revisarEscalado(prisma).catch(err => console.error('Subida de prioridad:', err.message));
    tick();
    return setInterval(tick, INTERVALO_MS);
}

module.exports = { escalones, revisarEscalado, programarEscalado };
