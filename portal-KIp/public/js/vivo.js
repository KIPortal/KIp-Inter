/* Actualización en vivo: si alguien asigna, resuelve o edita algo, la página
 * se recarga sola. Consulta /api/cambios cada 20 s mientras la pestaña está a
 * la vista. Si la persona está escribiendo, tiene una ventana abierta o una
 * selección a medias, no la interrumpe: muestra un aviso para actualizar. */
(function () {
	'use strict';
	if (!document.body || !document.body.hasAttribute('data-vivo')) return;
	const CADA = 20000;
	const KEY = 'kip.vivo:' + location.pathname;
	let sello = null;
	let aviso = null;

	// Restaura la posición (y el área abierta del Dashboard) tras una recarga automática
	try {
		const prev = JSON.parse(sessionStorage.getItem(KEY) || 'null');
		sessionStorage.removeItem(KEY);
		if (prev) {
			window.addEventListener('load', () => {
				if (prev.area) {
					const b = document.querySelector('[data-area="' + CSS.escape(prev.area) + '"]');
					if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
				}
				window.scrollTo(0, prev.y || 0);
				const main = document.querySelector('.app-main');
				if (main && prev.my) main.scrollTop = prev.my;
			});
		}
	} catch (e) { /* sin estado guardado */ }

	function ocupado() {
		const a = document.activeElement;
		if (a && (a.isContentEditable || (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'radio'))) return true;
		if (document.querySelector('[aria-modal="true"], dialog[open]')) return true;
		const s = window.getSelection && window.getSelection();
		if (s && String(s).trim()) return true;
		return typeof window.kipOcupado === 'function' && window.kipOcupado() === true;
	}

	function recargar() {
		try {
			const abierta = document.querySelector('[data-area][aria-pressed="true"]');
			const main = document.querySelector('.app-main');
			sessionStorage.setItem(KEY, JSON.stringify({ y: window.scrollY, my: main ? main.scrollTop : 0, area: abierta ? abierta.getAttribute('data-area') : null }));
		} catch (e) { /* se recarga igual */ }
		window.location.reload();
	}

	function mostrarAviso() {
		if (aviso) return;
		aviso = document.createElement('button');
		aviso.type = 'button';
		aviso.className = 'vivo-aviso';
		aviso.setAttribute('role', 'status');
		aviso.textContent = 'Hay cambios nuevos · Actualizar';
		aviso.addEventListener('click', recargar);
		document.body.appendChild(aviso);
	}

	async function revisar() {
		if (document.hidden) return;
		try {
			const r = await fetch('/api/cambios', { headers: { Accept: 'application/json' }, cache: 'no-store' });
			if (!r.ok) return;
			const j = await r.json();
			if (!j.success || !j.sello) return;
			if (sello === null) { sello = j.sello; return; }
			if (j.sello === sello) return;
			if (ocupado()) mostrarAviso(); else recargar();
		} catch (e) { /* sin red: se reintenta en la próxima vuelta */ }
	}

	revisar();
	setInterval(revisar, CADA);
	document.addEventListener('visibilitychange', () => { if (!document.hidden) revisar(); });
})();
