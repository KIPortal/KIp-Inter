'use strict';

/**
 * Actualización en vivo por empuje (Server-Sent Events). En vez de que cada
 * pestaña pregunte por /api/cambios, el servidor revisa el sello de cambios
 * cada pocos segundos (una sola consulta para todas las pestañas) y avisa a las
 * conectadas apenas cambia. avisar() fuerza la revisión enseguida, por ejemplo
 * cuando llega un correo nuevo.
 */

function crearDifusor({ cargarSello, cada = 3000, latido = 25000, timers = { setInterval, clearInterval } } = {}) {
    const clientes = new Set();
    let ultimo = null;
    let revision = null, pulso = null, enCurso = null;

    const escribir = (res, texto) => { try { res.write(texto); } catch (e) { clientes.delete(res); } };
    const enviar = (res, sello) => escribir(res, `event: cambio\ndata: ${JSON.stringify({ sello })}\n\n`);

    function revisar() {
        if (enCurso || clientes.size === 0) return enCurso || Promise.resolve();
        enCurso = Promise.resolve().then(cargarSello).then(sello => {
            if (!sello || sello === ultimo) return;
            ultimo = sello;
            for (const res of clientes) enviar(res, sello);
        }).catch(() => { /* la base no respondió: se reintenta en la próxima vuelta */ })
            .finally(() => { enCurso = null; });
        return enCurso;
    }

    function arrancar() {
        if (revision) return;
        revision = timers.setInterval(revisar, cada);
        // Latido: que túneles y proxies no corten la conexión, y que la pestaña sepa que sigue viva
        pulso = timers.setInterval(() => { for (const res of clientes) escribir(res, 'event: latido\ndata: 1\n\n'); }, latido);
    }

    function detener() {
        if (!revision) return;
        timers.clearInterval(revision);
        timers.clearInterval(pulso);
        revision = pulso = null;
    }

    /** Conecta una respuesta HTTP como canal de eventos; le manda el sello actual. */
    async function suscribir(req, res) {
        res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.flushHeaders?.();
        escribir(res, 'retry: 5000\n\n');
        clientes.add(res);
        arrancar();
        req.on('close', () => {
            clientes.delete(res);
            if (clientes.size === 0) detener();
        });
        try {
            const sello = await cargarSello();
            if (sello) { if (ultimo === null) ultimo = sello; enviar(res, sello); }
        } catch (e) { /* recibirá el próximo */ }
    }

    return { suscribir, avisar: revisar, conectados: () => clientes.size };
}

// Difusor del portal: lo arma app.js con el sello real; otros servicios solo llaman avisar()
let difusor = null;
function configurar(d) { difusor = d; return d; }
function avisar() { return difusor ? difusor.avisar() : Promise.resolve(); }

module.exports = { crearDifusor, configurar, avisar };
