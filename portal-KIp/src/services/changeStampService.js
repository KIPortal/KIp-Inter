'use strict';

/**
 * Sello de cambios: una huella corta de lo que mueve las pantallas (tickets,
 * personas, mensajes y auditoría). Si cambia, alguien asignó, resolvió, editó
 * o escribió algo y las vistas abiertas se recargan (public/js/vivo.js).
 */

const iso = d => (d ? new Date(d).toISOString() : '-');

/** Une las partes en un texto estable; una consulta que falló cuenta como '-'. */
function buildStamp(partes) {
    return partes.map(p => (p ? `${p.n ?? '-'}@${iso(p.max)}` : '-')).join('|');
}

async function loadStamp(prisma) {
    const seguro = q => q.catch(() => null);
    const [t, u, m, a] = await Promise.all([
        seguro(prisma.ticket.aggregate({ where: prisma.INCLUDE_DELETED, _count: { _all: true }, _max: { updatedAt: true } })),
        seguro(prisma.user.aggregate({ _count: { _all: true }, _max: { updatedAt: true } })),
        seguro(prisma.mensaje.aggregate({ _count: { _all: true }, _max: { createdAt: true } })),
        seguro(prisma.auditLog.aggregate({ _count: { _all: true }, _max: { createdAt: true } }))
    ]);
    const parte = (r, campo) => (r ? { n: r._count?._all, max: r._max?.[campo] } : null);
    return buildStamp([parte(t, 'updatedAt'), parte(u, 'updatedAt'), parte(m, 'createdAt'), parte(a, 'createdAt')]);
}

/**
 * Con varias pestañas abiertas, cada una consulta el sello cada 20 s. Se guarda
 * unos segundos y las consultas simultáneas comparten la misma ida a la base.
 */
function cachedStamp(loader, { ms = 5000, clock = Date.now } = {}) {
    let valor = null, hasta = 0, enCurso = null;
    return function () {
        if (valor !== null && clock() < hasta) return Promise.resolve(valor);
        if (!enCurso) {
            enCurso = Promise.resolve().then(loader)
                .then(v => { valor = v; hasta = clock() + ms; return v; })
                .finally(() => { enCurso = null; });
        }
        return enCurso;
    };
}

module.exports = { buildStamp, loadStamp, cachedStamp };
