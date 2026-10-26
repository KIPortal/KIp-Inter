// Convierte los <select class="field"> y los <input list="…"> (datalist) en el
// menú estilo macOS (.combo + .mmenu), también los que se crean después (ventanas).
// El elemento nativo sigue en la página, oculto, con su valor y sus eventos
// change/input: el código de cada pantalla no cambia.
(function () {
	'use strict';
	const CHEV = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
	const CHECK = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>';
	const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
	let abierto = null;

	function el(tag, cls, text) {
		const n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text != null) n.textContent = text;
		return n;
	}
	function cerrar() {
		if (!abierto) return;
		abierto.menu.remove();
		if (abierto.btn) abierto.btn.setAttribute('aria-expanded', 'false');
		abierto = null;
	}
	// items: [{ grupo }] o [{ value, label, hint, sel, dis }]
	function abrir(wrap, btn, items, onPick, enfocar) {
		cerrar();
		const menu = el('div', 'mmenu full');
		menu.setAttribute('role', 'listbox');
		items.forEach(it => {
			if (it.grupo != null) { menu.append(el('div', 'mgrupo', it.grupo)); return; }
			const b = el('button', 'mitem');
			b.type = 'button';
			b.setAttribute('role', 'option');
			b.setAttribute('aria-selected', String(!!it.sel));
			b.dataset.sel = String(!!it.sel);
			b.disabled = !!it.dis;
			const k = el('span', 'mk');
			if (it.sel) k.innerHTML = CHECK;
			b.append(el('span', 'ml', it.label), el('span', 'mh', it.hint || ''), k);
			b.addEventListener('mousedown', e => e.preventDefault());
			b.addEventListener('click', e => { e.stopPropagation(); if (it.dis) return; cerrar(); onPick(it.value); });
			menu.append(b);
		});
		wrap.append(menu);
		if (btn) btn.setAttribute('aria-expanded', 'true');
		abierto = { wrap, btn, menu };
		if (enfocar) {
			const s = menu.querySelector('.mitem[data-sel=true]') || menu.querySelector('.mitem:not([disabled])');
			if (s) s.focus();
		}
	}

	function envolver(nativo, sm) {
		const wrap = el('span', 'selwrap' + (sm ? ' sm' : ''));
		wrap.style.cssText = nativo.style.cssText;
		nativo.parentNode.insertBefore(wrap, nativo);
		return wrap;
	}

	function mejorarSelect(sel) {
		if (sel.dataset.combo) return;
		sel.dataset.combo = '1';
		const sm = sel.classList.contains('sm');
		const wrap = envolver(sel, sm);
		const btn = el('button', 'combo' + (sm ? ' sm' : ''));
		btn.type = 'button';
		btn.setAttribute('aria-haspopup', 'listbox');
		btn.setAttribute('aria-expanded', 'false');
		if (sel.getAttribute('aria-label')) btn.setAttribute('aria-label', sel.getAttribute('aria-label'));
		wrap.append(btn, sel);
		sel.style.display = 'none';
		sel.tabIndex = -1;

		const pintar = () => {
			const o = sel.selectedOptions[0];
			const cv = el('span', 'cv');
			const t = el('span', 'ellipsis', o ? o.text : '');
			if (!o || o.value === '') t.style.color = 'var(--t3)';
			cv.append(t);
			const c = el('span', 'combo-c');
			c.innerHTML = CHEV;
			btn.replaceChildren(cv, c);
			btn.disabled = sel.disabled;
		};
		const items = () => {
			const out = [];
			const opt = o => ({ value: o.value, label: o.text, sel: o.selected, dis: o.disabled });
			Array.from(sel.children).forEach(n => {
				if (n.tagName === 'OPTGROUP') {
					out.push({ grupo: n.label });
					Array.from(n.children).forEach(o => out.push(opt(o)));
				} else if (n.tagName === 'OPTION') out.push(opt(n));
			});
			return out;
		};
		btn.addEventListener('click', e => {
			e.stopPropagation();
			if (abierto && abierto.btn === btn) { cerrar(); return; }
			abrir(wrap, btn, items(), v => {
				valueDesc.set.call(sel, v);
				sel.dispatchEvent(new Event('input', { bubbles: true }));
				sel.dispatchEvent(new Event('change', { bubbles: true }));
				pintar();
				btn.focus();
			}, true);
		});
		// El código que fija el valor o cambia las opciones también repinta
		Object.defineProperty(sel, 'value', {
			configurable: true,
			get() { return valueDesc.get.call(sel); },
			set(v) { valueDesc.set.call(sel, v); pintar(); }
		});
		sel.focus = () => btn.focus();
		sel.addEventListener('change', pintar);
		new MutationObserver(pintar).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected'] });
		pintar();
	}

	// <input list> con sugerencias (p. ej. carpetas del buzón): se sigue escribiendo libre
	function mejorarLista(inp) {
		if (inp.dataset.combo) return;
		const lista = document.getElementById(inp.getAttribute('list'));
		if (!lista) return;
		inp.dataset.combo = '1';
		inp.removeAttribute('list');
		inp.setAttribute('autocomplete', 'off');
		const wrap = envolver(inp, inp.classList.contains('sm'));
		wrap.append(inp);
		inp.style.width = '100%';

		const mostrar = enfocar => {
			const q = inp.value.trim().toLowerCase();
			const opts = Array.from(lista.options)
				.filter(o => o.value && o.value.toLowerCase() !== q && o.value.toLowerCase().includes(q))
				.map(o => ({ value: o.value, label: o.value, hint: o.text !== o.value ? o.text : '' }));
			if (!opts.length) { if (abierto && abierto.wrap === wrap) cerrar(); return; }
			abrir(wrap, null, opts, v => {
				inp.value = v;
				inp.dispatchEvent(new Event('input', { bubbles: true }));
				inp.dispatchEvent(new Event('change', { bubbles: true }));
				inp.focus();
			}, enfocar);
		};
		inp.addEventListener('focus', () => mostrar(false));
		inp.addEventListener('input', () => mostrar(false));
		inp.addEventListener('keydown', e => {
			if (e.key === 'ArrowDown') { e.preventDefault(); mostrar(true); }
		});
		inp.addEventListener('blur', () => setTimeout(() => {
			if (abierto && abierto.wrap === wrap && !wrap.contains(document.activeElement)) cerrar();
		}, 0));
		// Las sugerencias llegan después (se piden al servidor)
		new MutationObserver(() => { if (document.activeElement === inp) mostrar(false); })
			.observe(lista, { childList: true, subtree: true });
	}

	function revisar(raiz) {
		if (!raiz.querySelectorAll) return;
		if (raiz.matches && raiz.matches('select.field')) mejorarSelect(raiz);
		raiz.querySelectorAll('select.field').forEach(mejorarSelect);
		raiz.querySelectorAll('input[list]').forEach(mejorarLista);
		if (raiz.matches && raiz.matches('input[list]')) mejorarLista(raiz);
	}

	document.addEventListener('click', e => {
		if (abierto && !abierto.wrap.contains(e.target)) cerrar();
	});
	// En captura: Escape cierra el menú antes de que la ventana se cierre
	document.addEventListener('keydown', e => {
		if (!abierto) return;
		if (e.key === 'Escape') {
			e.stopPropagation();
			const { btn, wrap } = abierto;
			cerrar();
			(btn || wrap.querySelector('input')).focus();
			return;
		}
		if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && abierto.menu.contains(document.activeElement)) {
			const items = Array.from(abierto.menu.querySelectorAll('.mitem:not([disabled])'));
			const i = items.indexOf(document.activeElement);
			const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
			if (next) { e.preventDefault(); e.stopPropagation(); next.focus(); }
		}
	}, true);

	function iniciar() {
		revisar(document.body);
		new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(revisar)))
			.observe(document.body, { childList: true, subtree: true });
	}
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
	else iniciar();
})();
