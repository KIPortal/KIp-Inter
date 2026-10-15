/* Campana "Por cerrar" del coordinador, jefe o gerente: tickets que un operador
 * resolvió y esperan revisión y cierre. Consulta /api/avisos/coordinador cada
 * 20 s; cuando llega uno nuevo muestra un aviso (y una notificación del sistema
 * si la pestaña está en segundo plano y la persona dio permiso). */
(function () {
	'use strict';
	const btn = document.querySelector('[data-avisos-coord]');
	if (!btn) return;
	const badge = btn.querySelector('[data-avisos-n]');
	const CADA = 20000;
	const KEY = 'kip.avisos.vistos';
	let lista = [];
	let pop = null;

	const store = {
		get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } },
		set(v) { try { localStorage.setItem(KEY, JSON.stringify(v.slice(-200))); } catch (e) { /* nada */ } }
	};
	const clave = a => a.codigo + '@' + (a.resueltoEn || '');
	const el = (tag, attrs, ...kids) => {
		const n = document.createElement(tag);
		Object.entries(attrs || {}).forEach(([k, v]) => { if (k === 'text') n.textContent = v; else n.setAttribute(k, v); });
		kids.flat().forEach(k => k && n.append(k));
		return n;
	};

	function pintarConteo() {
		const n = lista.length;
		badge.hidden = n === 0;
		badge.textContent = n > 9 ? '9+' : String(n);
		btn.setAttribute('aria-label', 'Por cerrar, ' + n + (n === 1 ? ' ticket resuelto' : ' tickets resueltos'));
		if (pop) pintarPop();
	}

	function pintarPop() {
		pop.replaceChildren(
			el('div', { class: 'av-hd' }, el('b', { text: 'Por cerrar' }), el('span', { text: lista.length ? lista.length + ' resuelto' + (lista.length === 1 ? '' : 's') + ' esperan tu revisión' : 'Al día' })),
			lista.length
				? el('div', { class: 'av-list' }, lista.map(a => el('a', { class: 'av-row', href: '/tickets#' + encodeURIComponent(a.codigo) },
					el('span', { class: 'l1' }, el('span', { class: 'cod', text: a.codigo }), el('span', { class: 'as', text: a.asunto })),
					el('span', { class: 'l2', text: 'Resuelto por ' + a.operador + ' · ' + a.area + (a.hace ? ' · ' + a.hace : '') }))))
				: el('div', { class: 'av-empty', text: 'No hay tickets resueltos esperando cierre.' }),
			el('a', { class: 'av-ft', href: '/tickets#por-cerrar', text: 'Ver todos en Tickets' }));
	}

	function cerrarPop() {
		if (!pop) return;
		pop.remove();
		pop = null;
		btn.setAttribute('aria-expanded', 'false');
	}

	function abrirPop() {
		pop = el('div', { class: 'av-pop', role: 'dialog', 'aria-label': 'Tickets por cerrar' });
		pintarPop();
		document.body.append(pop);
		const r = btn.getBoundingClientRect();
		const left = Math.min(r.right + 8, window.innerWidth - pop.offsetWidth - 12);
		pop.style.left = Math.max(12, left) + 'px';
		pop.style.top = Math.max(12, Math.min(r.top, window.innerHeight - pop.offsetHeight - 12)) + 'px';
		btn.setAttribute('aria-expanded', 'true');
		const first = pop.querySelector('a');
		if (first) first.focus({ preventScroll: true });
	}

	btn.addEventListener('click', e => {
		e.preventDefault();
		e.stopPropagation();
		if (pop) cerrarPop(); else abrirPop();
		// Pide permiso para avisar con la pestaña en segundo plano (solo con un clic)
		if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => { /* nada */ });
	});
	document.addEventListener('click', e => { if (pop && !pop.contains(e.target)) cerrarPop(); });
	document.addEventListener('keydown', e => { if (e.key === 'Escape' && pop) { cerrarPop(); btn.focus(); } });

	function avisar(nuevos, repetido) {
		const a = nuevos[0];
		const titulo = nuevos.length === 1 ? a.codigo + ' resuelto' : nuevos.length + ' tickets resueltos';
		const texto = nuevos.length === 1 ? a.operador + ' lo resolvió. Revísalo y ciérralo.' : 'Esperan tu revisión y cierre.';
		const destino = nuevos.length === 1 ? '/tickets#' + encodeURIComponent(a.codigo) : '/tickets#por-cerrar';
		const viejo = document.querySelector('.av-toast');
		if (viejo) viejo.remove();
		const t = el('button', { type: 'button', class: 'av-toast', role: 'status', 'aria-live': 'polite' },
			el('span', { class: 'ti', text: '✓' }), el('span', { class: 'tx' }, el('b', { text: titulo }), el('span', { text: texto })));
		t.addEventListener('click', () => { window.location.href = destino; });
		document.body.append(t);
		setTimeout(() => t.remove(), 8000);
		// Si la página se recarga sola enseguida (vivo.js), el aviso se vuelve a mostrar
		try { if (!repetido) sessionStorage.setItem('kip.avisos.toast', JSON.stringify({ en: Date.now(), nuevos })); } catch (e) { /* nada */ }
		if (!repetido && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
			try {
				const n = new Notification(titulo, { body: texto, tag: 'kip-por-cerrar' });
				n.onclick = () => { window.focus(); window.location.href = destino; };
			} catch (e) { /* el navegador no lo permite */ }
		}
	}

	async function revisar() {
		try {
			const r = await fetch('/api/avisos/coordinador', { headers: { Accept: 'application/json' }, cache: 'no-store' });
			if (!r.ok) return;
			const j = await r.json();
			if (!j.success) return;
			lista = j.porCerrar || [];
			pintarConteo();
			const vistos = store.get();
			const claves = lista.map(clave);
			// Primera vez en este navegador: lo pendiente no se anuncia, solo se cuenta
			if (vistos === null) return store.set(claves);
			const nuevos = lista.filter(a => !vistos.includes(clave(a)));
			if (nuevos.length) {
				avisar(nuevos);
				store.set(vistos.concat(nuevos.map(clave)));
			}
		} catch (e) { /* sin red: se reintenta en la próxima vuelta */ }
	}

	try {
		const prev = JSON.parse(sessionStorage.getItem('kip.avisos.toast') || 'null');
		sessionStorage.removeItem('kip.avisos.toast');
		if (prev && Date.now() - prev.en < 15000) avisar(prev.nuevos, true);
	} catch (e) { /* sin aviso pendiente */ }
	revisar();
	setInterval(revisar, CADA);
	document.addEventListener('visibilitychange', () => { if (!document.hidden) revisar(); });
})();
