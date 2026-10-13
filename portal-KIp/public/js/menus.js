// Menús desplegables estilo macOS dibujados por el servidor:
// <span class="popwrap"><button data-menu-btn aria-expanded="false">…</button><div class="mmenu" hidden>…</div></span>
// Un solo menú abierto a la vez; se cierra con clic fuera o Escape.
(function () {
	'use strict';
	let abierto = null;

	function cerrar() {
		if (!abierto) return;
		abierto.menu.hidden = true;
		abierto.btn.setAttribute('aria-expanded', 'false');
		abierto = null;
	}

	document.addEventListener('click', e => {
		const btn = e.target.closest('[data-menu-btn]');
		if (btn) {
			const menu = btn.parentElement.querySelector('.mmenu');
			const mismo = abierto && abierto.btn === btn;
			cerrar();
			if (!mismo && menu) {
				menu.hidden = false;
				btn.setAttribute('aria-expanded', 'true');
				abierto = { btn, menu };
				const sel = menu.querySelector('[data-sel=true]') || menu.querySelector('.mitem');
				if (sel) sel.focus();
			}
			return;
		}
		if (abierto && !abierto.menu.contains(e.target)) cerrar();
	});
	document.addEventListener('keydown', e => {
		if (!abierto) return;
		if (e.key === 'Escape') { const b = abierto.btn; cerrar(); b.focus(); return; }
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			const items = Array.from(abierto.menu.querySelectorAll('.mitem'));
			const i = items.indexOf(document.activeElement);
			const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
			if (next) { e.preventDefault(); next.focus(); }
		}
	});
})();
