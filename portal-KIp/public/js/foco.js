// Accesibilidad común de ventanas (.overlay) y del panel lateral (.drawer-panel):
// - les asocia su título (aria-labelledby → primer h2),
// - mantiene el Tab dentro de la ventana modal abierta,
// - al cerrarla, devuelve el foco al elemento que la abrió.
(function () {
	'use strict';
	const ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
	const abiertas = []; // { el, anterior }
	let n = 0;

	function titular(el) {
		const dlg = el.matches('[role=dialog]') ? el : el.querySelector('[role=dialog]');
		if (!dlg || dlg.hasAttribute('aria-labelledby')) return;
		const h = dlg.querySelector('h2');
		if (!h) return;
		if (!h.id) h.id = 'dlg-titulo-' + (++n);
		dlg.setAttribute('aria-labelledby', h.id);
	}

	const esVentana = node => node.nodeType === 1 && (node.classList.contains('overlay') || node.classList.contains('drawer-panel'));

	new MutationObserver(cambios => {
		cambios.forEach(c => {
			c.addedNodes.forEach(node => {
				if (!esVentana(node)) return;
				abiertas.push({ el: node, anterior: document.activeElement });
				// El contenido se arma justo después de insertar la ventana
				setTimeout(() => titular(node), 0);
			});
			c.removedNodes.forEach(node => {
				if (!esVentana(node)) return;
				const i = abiertas.findIndex(a => a.el === node);
				if (i < 0) return;
				const { anterior } = abiertas.splice(i, 1)[0];
				if (anterior && document.contains(anterior) && typeof anterior.focus === 'function') anterior.focus();
			});
		});
	}).observe(document.documentElement, { childList: true, subtree: true });

	document.addEventListener('keydown', e => {
		if (e.key !== 'Tab') return;
		const modal = [...abiertas].reverse().find(a => a.el.classList.contains('overlay') && document.contains(a.el));
		if (!modal) return;
		titular(modal.el);
		const items = Array.from(modal.el.querySelectorAll(ENFOCABLES)).filter(x => !x.closest('[hidden]'));
		if (!items.length) return;
		const primero = items[0];
		const ultimo = items[items.length - 1];
		if (!modal.el.contains(document.activeElement)) { e.preventDefault(); primero.focus(); return; }
		if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
		else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
	});
})();
