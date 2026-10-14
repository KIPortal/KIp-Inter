// Cola de tickets del coordinador: tabla agrupada, filtros, panel lateral y ventanas.
// Los datos llegan del servidor en #tickets-data (ticketQueueService.buildQueue).
// Toda acción llama a /api/tickets y, al terminar, recarga la página con un aviso.
(function () {
	'use strict';

	let D;
	try { D = JSON.parse(document.getElementById('tickets-data').textContent); } catch (e) { return; }

	// ---------- Catálogos ----------
	const STATES = [
		['NUEVO', 'Nuevo', 'Nuevos'],
		['EN_PROGRESO', 'En progreso', 'En progreso'],
		['EN_PAUSA', 'En pausa', 'En pausa'],
		['EN_ESPERA_TERCEROS', 'En espera de terceros', 'En espera de terceros'],
		['RESUELTO', 'Resuelto', 'Resueltos, pendientes de cierre'],
		['CERRADO', 'Cerrado', 'Cerrados hoy']
	];
	const STATE_NAME = {};
	STATES.forEach(s => { STATE_NAME[s[0]] = s[1]; });
	const ACTIVE = ['NUEVO', 'EN_PROGRESO', 'EN_PAUSA', 'EN_ESPERA_TERCEROS'];
	const PR = { P1: ['P1 Crítica', 8], P2: ['P2 Media', 5], P3: ['P3 Baja', 1], SP: ['Sin prioridad', 0] };
	const PKEYS = ['P1', 'P2', 'P3', 'SP'];
	const PR_API = { P1: 'P1', P2: 'P2', P3: 'P3', SP: 'NONE' };
	const PR_DOT = { P1: 'var(--c-red)', P2: 'var(--c-amber)', P3: 'var(--c-slate)', SP: 'var(--sep)' };
	const ST_DOT = { NUEVO: 'var(--t3)', EN_PROGRESO: 'var(--c-blue)', EN_PAUSA: 'var(--c-amber)', EN_ESPERA_TERCEROS: 'var(--c-purple)', RESUELTO: 'var(--c-green)', CERRADO: 'var(--t2)' };
	const ORIGINS = [['CORREO', 'Correo'], ['LLAMADA', 'Llamada'], ['JEFATURA', 'Jefatura'], ['COORDINADOR', 'Coordinador']];
	// Plantillas de Administración (con estas como respaldo)
	const CLOSE_TPL = (D.plantillas && D.plantillas.cierre) || ['Servicio restablecido', 'Resuelto por el operador', 'Falla del proveedor resuelta', 'Duplicado de otro ticket'];
	const HAND_TPL = (D.plantillas && D.plantillas.traspaso) || ['Sin novedades pendientes', 'Quedan P1 abiertos, revisar primero', 'Esperando respuesta de proveedor', 'Vigilar enlaces con saturación'];
	const AREA_NAME = {};
	D.areas.forEach(a => { AREA_NAME[a.codigo] = a.nombre; });
	// Subgrupos activos de cada área (p. ej. FTTx: Soporte y Cabecera)
	const SUBS = {};
	const SG_NAME = {};
	D.areas.forEach(a => { SUBS[a.codigo] = a.subgrupos || []; SUBS[a.codigo].forEach(g => { SG_NAME[g.id] = g.nombre; }); });
	// Filtro de área: "AREA" o "AREA|subgrupo"
	const areaMatch = (t, v) => { const [a, g] = String(v).split('|'); return t.area === a && (!g || t.subgrupo === g); };
	const OPS = {};
	D.operadores.forEach(o => { OPS[o.id] = o; });
	const BY_CODE = {};
	D.tickets.forEach(t => { BY_CODE[t.codigo] = t; });
	// Sugerencia por área: { id, motivo } o null (assignmentService)
	const sugOf = area => (D.sugeridos && D.sugeridos[area]) || null;
	const otherOf = area => (D.otraArea && D.otraArea[area]) || null;

	const ICON = {
		assign: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/></svg>',
		unassign: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 11h6"/></svg>',
		close: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>',
		edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
		history: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
		trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
		x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
		chev: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
		chev9: '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
		check: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>',
		warn: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.5"/></svg>',
		file: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
		handoff: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>',
		ok: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L19 7"/></svg>'
	};

	// ---------- Utilidades ----------
	// Crea un elemento; el texto siempre entra como texto (nunca como HTML)
	function h(tag, props) {
		const n = document.createElement(tag);
		const p = props || {};
		Object.keys(p).forEach(k => {
			const v = p[k];
			if (v === undefined || v === null || v === false) return;
			if (k === 'class') n.className = v;
			else if (k === 'text') n.textContent = v;
			else if (k === 'icon') n.insertAdjacentHTML('afterbegin', ICON[v]);
			else if (k === 'style') n.setAttribute('style', v);
			else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2).toLowerCase(), v);
			else if (v === true) n.setAttribute(k, '');
			else n.setAttribute(k, String(v));
		});
		for (let i = 2; i < arguments.length; i++) append(n, arguments[i]);
		return n;
	}
	function append(n, c) {
		if (c === undefined || c === null || c === false) return;
		if (Array.isArray(c)) { c.forEach(x => append(n, x)); return; }
		n.append(c.nodeType ? c : document.createTextNode(String(c)));
	}
	const $ = s => document.querySelector(s);
	const fmt = m => m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
	const hhmm = iso => new Date(iso).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit' });
	const fecha = iso => new Date(iso).toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
	const plural = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios);

	async function api(method, url, body) {
		const res = await fetch(url, {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: body ? JSON.stringify(body) : undefined
		});
		let json = {};
		try { json = await res.json(); } catch (e) { /* sin cuerpo */ }
		if (!res.ok || json.success === false) {
			const err = new Error(json.error || json.message || 'Error ' + res.status);
			err.status = res.status;
			err.body = json;
			throw err;
		}
		return json;
	}

	// Aviso tras una acción: se guarda y se muestra al recargar
	function done(title, msg, tone) {
		try { sessionStorage.setItem('kip.toast', JSON.stringify({ title, msg, tone: tone || 'blue' })); } catch (e) { /* solo se pierde el aviso */ }
		window.location.reload();
	}
	function toast(title, msg, tone) {
		const old = document.querySelector('.toast');
		if (old) old.remove();
		const bg = { blue: 'var(--c-blue)', green: 'var(--c-green)', violet: 'var(--c-violet)', red: 'var(--c-red)' }[tone] || 'var(--c-blue)';
		const n = h('div', { class: 'notif toast', role: 'status', 'aria-live': 'polite' },
			h('span', { class: 'ti', style: 'background:' + bg, icon: tone === 'violet' ? 'handoff' : 'ok' }),
			h('div', { class: 'tx' }, h('b', { text: title }), h('span', { text: msg })),
			h('span', { class: 't3', style: 'font-size:11px', text: 'Ahora' }));
		document.body.append(n);
		setTimeout(() => n.remove(), 4200);
	}
	function showError(err) {
		toast('No se pudo completar', err.message || 'Error inesperado', 'red');
	}

	// ---------- Estado de la vista ----------
	const DEF = { area: '', fecha: '', prio: '', estado: '', op: '' };
	const S = { f: Object.assign({}, DEF), q: '', sel: new Set(), onlyHanded: false };
	try {
		const saved = JSON.parse(sessionStorage.getItem('kip.tickets.f') || 'null');
		if (saved) Object.assign(S.f, saved);
	} catch (e) { /* sin filtros guardados */ }
	const saveFilters = () => { try { sessionStorage.setItem('kip.tickets.f', JSON.stringify(S.f)); } catch (e) { /* nada */ } };

	const pendientesTraspaso = new Set(D.traspaso ? D.traspaso.pendientes : []);

	function match(t, skip) {
		const f = S.f;
		if (skip !== 'estado') {
			if (f.estado ? t.estado !== f.estado : t.estado === 'CERRADO') return false;
		} else if (t.estado === 'CERRADO') return false;
		if (skip !== 'area' && f.area && !areaMatch(t, f.area)) return false;
		if (skip !== 'prio' && f.prio && t.prioridad !== f.prio) return false;
		if (skip !== 'fecha' && f.fecha) {
			if (f.fecha === 'hoy' && t.diasAtras !== 0) return false;
			if (f.fecha === 'ayer' && t.diasAtras !== 1) return false;
			if (f.fecha === '7d' && !(t.diasAtras <= 6)) return false;
		}
		if (skip !== 'op' && f.op) {
			if (f.op === '__none') { if (t.operador) return false; }
			else if (f.op === '__cola') { if (!t.enCola) return false; }
			else if (!t.operador || t.operador.id !== f.op) return false;
		}
		if (S.onlyHanded && !pendientesTraspaso.has(t.codigo)) return false;
		if (S.q) {
			const hay = (t.codigo + ' ' + t.asunto + ' ' + (t.operador ? t.operador.nombre : '')).toLowerCase();
			if (!hay.includes(S.q)) return false;
		}
		return true;
	}
	const order = (a, b) => ((b.prioridad === 'P1') - (a.prioridad === 'P1')) || (b.edadMin - a.edadMin);

	// ---------- Menú desplegable estilo macOS (uno abierto a la vez) ----------
	let openMenu = null;
	function closeMenu() {
		if (!openMenu) return;
		openMenu.menu.remove();
		openMenu.btn.setAttribute('aria-expanded', 'false');
		openMenu = null;
	}
	document.addEventListener('click', e => {
		if (openMenu && !openMenu.menu.contains(e.target) && !openMenu.btn.contains(e.target)) closeMenu();
	});
	document.addEventListener('keydown', e => {
		// Menú abierto: ↑↓ recorren las opciones (Enter las elige: son botones)
		if (openMenu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
			const items = Array.from(openMenu.menu.querySelectorAll('.mitem:not([disabled])'));
			const i = items.indexOf(document.activeElement);
			const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
			if (next) { e.preventDefault(); next.focus(); }
			return;
		}
		if (e.key !== 'Escape') return;
		if (openMenu) { const b = openMenu.btn; closeMenu(); b.focus(); return; }
		const top = layer.lastElementChild;
		if (top) top.remove();
		else if (panelCode) closePanel();
	});
	/**
	 * opts: [{ value, label, hint, dot, badge: [texto, clase], sel, dis }]
	 */
	function toggleMenu(btn, wrap, opts, onPick, cls) {
		if (openMenu && openMenu.btn === btn) { closeMenu(); return; }
		closeMenu();
		const menu = h('div', { class: 'mmenu ' + (cls || 'right'), role: 'listbox' },
			opts.map(o => h('button', {
				type: 'button', class: 'mitem', role: 'option', 'aria-selected': String(!!o.sel), 'data-sel': String(!!o.sel), disabled: !!o.dis,
				onclick: ev => { ev.stopPropagation(); if (o.dis) return; closeMenu(); onPick(o.value); }
			},
			o.dot ? h('span', { class: 'mdot', style: 'background:' + o.dot }) : null,
			h('span', { class: 'ml', text: o.label }),
			o.badge ? h('span', { class: 'mbadge tag ' + o.badge[1], text: o.badge[0] }) : null,
			h('span', { class: 'mh', text: o.hint || '' }),
			h('span', { class: 'mk', icon: o.sel ? 'check' : undefined }))));
		wrap.append(menu);
		btn.setAttribute('aria-expanded', 'true');
		openMenu = { btn, menu };
		const sel = menu.querySelector('.mitem[data-sel=true]') || menu.querySelector('.mitem:not([disabled])');
		if (sel) sel.focus();
	}

	// Campo desplegable (.combo) que abre el mismo menú
	function combo(getValue, getOpts, onPick) {
		const wrap = h('div', { style: 'position:relative' });
		const btn = h('button', { type: 'button', class: 'combo', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' });
		const paint = () => {
			const v = getValue();
			btn.replaceChildren(
				h('span', { class: 'cv' }, v.dot ? h('i', { style: 'background:' + v.dot }) : null, h('span', { class: 'ellipsis', text: v.label, style: v.muted ? 'color:var(--t3)' : '' })),
				h('span', { class: 'combo-c', icon: 'chev9' }));
		};
		btn.addEventListener('click', ev => { ev.stopPropagation(); toggleMenu(btn, wrap, getOpts(), val => { onPick(val); paint(); }, 'full'); });
		paint();
		wrap.append(btn);
		wrap.repaint = paint;
		return wrap;
	}

	// ---------- Filtros ----------
	const FILTERS = [
		['area', 'Área', () => [{ value: '', label: 'Todas' }].concat(...D.areas.map(a => [{ value: a.codigo, label: a.nombre }]
			.concat(SUBS[a.codigo].map(g => ({ value: a.codigo + '|' + g.id, label: a.nombre + ' · ' + g.nombre })))))],
		['fecha', 'Fecha', () => [{ value: '', label: 'Todas' }, { value: 'hoy', label: 'Hoy' }, { value: 'ayer', label: 'Ayer' }, { value: '7d', label: 'Últimos 7 días' }]],
		['prio', 'Prioridad', () => [{ value: '', label: 'Todas' }].concat(PKEYS.map(k => ({ value: k, label: PR[k][0], dot: k === 'SP' ? null : PR_DOT[k] })))],
		['estado', 'Estado', () => [{ value: '', label: 'Todos' }].concat(STATES.map(s => ({ value: s[0], label: s[1], dot: ST_DOT[s[0]] })))],
		['op', 'Operador', () => [{ value: '', label: 'Todos' }, { value: '__none', label: 'Sin asignar' }, { value: '__cola', label: 'En cola de espera' }].concat(D.operadores.map(o => ({ value: o.id, label: o.nombre })))]
	];
	function countFor(key, value) {
		const n = D.tickets.filter(t => {
			if (!match(t, key)) return false;
			if (key === 'estado') return value ? t.estado === value : t.estado !== 'CERRADO';
			if (!value) return true;
			if (key === 'area') return areaMatch(t, value);
			if (key === 'prio') return t.prioridad === value;
			if (key === 'fecha') return value === 'hoy' ? t.diasAtras === 0 : value === 'ayer' ? t.diasAtras === 1 : t.diasAtras <= 6;
			if (key === 'op') return value === '__none' ? !t.operador : value === '__cola' ? !!t.enCola : !!t.operador && t.operador.id === value;
			return true;
		}).length;
		return n ? String(n) : '';
	}
	function renderFilters() {
		const box = $('[data-filters]');
		box.replaceChildren();
		FILTERS.forEach(([key, label, optsFn]) => {
			const opts = optsFn();
			const current = opts.find(o => o.value === S.f[key]) || opts[0];
			const wrap = h('span', { class: 'popwrap' });
			const btn = h('button', { type: 'button', class: 'popup', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'data-active': String(!!S.f[key]) },
				h('span', { class: 'pl', text: label + ':' }), h('span', { class: 'pv', text: current.label }), h('span', { class: 't2', icon: 'chev' }));
			btn.addEventListener('click', ev => {
				ev.stopPropagation();
				toggleMenu(btn, wrap, opts.map(o => Object.assign({}, o, { sel: o.value === S.f[key], hint: countFor(key, o.value) })), v => {
					S.f[key] = v;
					saveFilters();
					render();
				});
			});
			wrap.append(btn);
			box.append(wrap);
		});
		const dirty = Object.keys(DEF).some(k => S.f[k]) || !!S.q || S.onlyHanded;
		document.querySelectorAll('[data-clear-filters]').forEach(b => { b.hidden = !dirty; });
		return dirty;
	}
	function clearFilters() {
		S.f = Object.assign({}, DEF);
		S.q = '';
		S.onlyHanded = false;
		$('[data-search]').value = '';
		saveFilters();
		render();
	}

	// ---------- Tabla agrupada ----------
	function render() {
		const dirty = renderFilters();
		const visibles = D.tickets.filter(t => match(t));
		const tbody = $('[data-rows]');
		const frag = document.createDocumentFragment();
		STATES.forEach(([codigo, , titulo]) => {
			const rows = visibles.filter(t => t.estado === codigo).sort(order);
			if (!rows.length) return;
			const grupo = h('tbody', { class: 'g-' + codigo });
			grupo.append(h('tr', { class: 'gap', 'aria-hidden': 'true' }, h('td', { colspan: 8 })));
			grupo.append(h('tr', { class: 'ghead' }, h('td', { colspan: 8 }, h('span', {}, titulo, h('i', { text: rows.length })))));
			rows.forEach((t, i) => grupo.append(rowOf(t, i === rows.length - 1)));
			frag.append(grupo);
		});
		// Sustituye los grupos anteriores (cada grupo es un <tbody>)
		const table = tbody.closest('table');
		table.querySelectorAll('tbody').forEach(b => { if (b !== tbody) b.remove(); });
		tbody.replaceChildren();
		table.append(frag);

		$('[data-empty]').hidden = visibles.length > 0;
		const cerrados = S.f.estado === 'CERRADO';
		$('[data-scope]').textContent = S.onlyHanded ? 'Pendientes del traspaso' : cerrados ? 'Cerrados hoy' : 'Solo activos';
		$('[data-footer]').textContent = cerrados
			? 'Mostrando ' + visibles.length + ' de ' + D.resumen.cerradosHoy + ' cerrados hoy'
			: (dirty ? plural(visibles.length, 'resultado', 'resultados') + ' · ' : 'Mostrando ' + visibles.length + ' de ' + D.resumen.activos + ' activos · ')
				+ 'Nuevos → Resueltos; en cada grupo P1 primero y luego los más antiguos';
		const all = $('[data-select-all]');
		all.checked = visibles.length > 0 && visibles.every(t => S.sel.has(t.codigo));
		renderBatch();
		renderHandoffCard();
	}

	function rowOf(t, last) {
		const sel = S.sel.has(t.codigo);
		const open = panelCode === t.codigo;
		const cls = ['qrow', last ? 'last' : '', open ? 'open' : sel ? 'sel' : (t.alerta ? 'alert' : '')].join(' ');
		const viva = ACTIVE.includes(t.estado);
		return h('tr', { class: cls },
			h('td', {}, h('input', {
				type: 'checkbox', 'aria-label': 'Seleccionar ' + t.codigo, style: 'margin:0;cursor:pointer', checked: sel,
				onchange: () => { if (S.sel.has(t.codigo)) S.sel.delete(t.codigo); else S.sel.add(t.codigo); render(); }
			})),
			h('td', {}, h('button', { type: 'button', class: 'code', title: 'Ver detalle', text: t.codigo, onclick: () => openPanel(t.codigo) })),
			h('td', {}, h('span', { class: 'prio ' + t.prioridad }, h('i'), PR[t.prioridad][0])),
			h('td', {}, h('span', { class: 'state' }, h('i', { class: 's-' + t.estado }), STATE_NAME[t.estado])),
			h('td', { style: 'max-width:0' }, h('button', { type: 'button', class: 'subj', title: t.asunto, onclick: () => openPanel(t.codigo) },
				h('span', { style: 'font-weight:500', text: t.asunto }), h('span', { class: 'area', text: '  ·  ' + t.areaNombre + (t.subgrupoNombre ? ' · ' + t.subgrupoNombre : '') }))),
			h('td', {}, t.operador
				? h('span', { class: 'who' }, h('span', { class: 'avatar', text: t.operador.iniciales }), t.operador.nombre)
				: h('span', { class: 'unassigned' + (t.enCola ? ' t-red' : ''), text: t.enCola ? 'En cola de espera' : 'Sin asignar' })),
			h('td', { class: 'qtime' + (t.alerta && viva ? ' late' : ''), title: t.alerta || '' },
				t.alerta && viva ? h('span', { icon: 'warn' }) : null, fmt(t.edadMin)),
			h('td', {}, h('div', { class: 'acts' },
				!t.operador && t.estado !== 'CERRADO' ? h('button', { type: 'button', class: 'ico accent', title: 'Asignar', 'aria-label': 'Asignar ' + t.codigo, icon: 'assign', onclick: () => openAssign([t.codigo]) }) : null,
				t.operador && t.estado !== 'CERRADO' ? h('button', { type: 'button', class: 'ico', title: 'Desasignar', 'aria-label': 'Desasignar ' + t.codigo, icon: 'unassign', onclick: () => doUnassign([t.codigo]) }) : null,
				t.estado !== 'CERRADO' ? h('button', { type: 'button', class: 'ico' + (t.estado === 'RESUELTO' ? ' ok' : ''), title: 'Cerrar', 'aria-label': 'Cerrar ' + t.codigo, icon: 'close', onclick: () => openClose(t.codigo) }) : null,
				h('button', { type: 'button', class: 'ico', title: 'Editar', 'aria-label': 'Editar ' + t.codigo, icon: 'edit', onclick: () => openPanel(t.codigo, true) }),
				h('button', { type: 'button', class: 'ico', title: 'Historial', 'aria-label': 'Historial ' + t.codigo, icon: 'history', onclick: () => openPanel(t.codigo) }),
				h('button', { type: 'button', class: 'ico danger', title: 'Eliminar', 'aria-label': 'Eliminar ' + t.codigo, icon: 'trash', onclick: () => openDelete(t.codigo) }))));
	}

	function renderBatch() {
		const bar = $('[data-batch]');
		const n = S.sel.size;
		bar.hidden = n === 0;
		$('[data-batch-label]').textContent = plural(n, 'seleccionado', 'seleccionados');
	}

	// ---------- Tarjeta de traspaso ----------
	function renderHandoffCard() {
		const box = $('[data-handoff-card]');
		box.replaceChildren();
		const tr = D.traspaso;
		if (!tr) return;
		box.append(h('section', { class: 'glass ho-card', 'aria-label': 'Traspaso a guardia' },
			h('span', { class: 'ho-ico', icon: 'handoff' }),
			h('div', { class: 'txt' },
				h('b', { text: 'Traspaso a guardia · ' + plural(tr.pendientes.length, 'pendiente', 'pendientes') }),
				h('span', { text: tr.nota, title: tr.nota }),
				h('small', { text: 'Enviado ' + hhmm(tr.creadoEn) + ' por ' + tr.autor + ' · se muestra hasta las 08:00 o hasta que se atiendan' })),
			h('button', { type: 'button', class: 'pill pillbtn plain', text: 'Marcar atendido', onclick: () => api('POST', '/api/tickets/handoff/' + encodeURIComponent(tr.id) + '/atendido').then(() => done('Traspaso atendido', 'La tarjeta deja de mostrarse', 'violet')).catch(showError) }),
			h('button', { type: 'button', class: 'pill pillbtn accent', 'aria-pressed': String(S.onlyHanded), text: S.onlyHanded ? 'Ver todos' : 'Ver lista', onclick: () => { S.onlyHanded = !S.onlyHanded; render(); } })));
	}

	// ---------- Capa de ventanas ----------
	const layer = $('[data-layer]');
	function dialog(width, content) {
		const ov = h('div', { class: 'overlay', onclick: e => { if (e.target === ov) ov.remove(); } },
			h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', style: 'width:' + width + 'px' }, content));
		layer.append(ov);
		const first = ov.querySelector('textarea, input, button.primary');
		if (first) setTimeout(() => first.focus(), 30);
		return ov;
	}
	const cancelBtn = ov => h('button', { type: 'button', class: 'pill pillbtn plain', text: 'Cancelar', onclick: () => ov.remove() });

	// ---------- Panel lateral de detalle ----------
	let panelCode = null;
	function closePanel() {
		panelCode = null;
		const p = document.querySelector('.drawer-panel');
		if (p) p.remove();
		render();
	}
	function openPanel(code, editing) {
		const t = BY_CODE[code];
		if (!t) return;
		closeMenu();
		const prev = document.querySelector('.drawer-panel');
		if (prev) prev.remove();
		panelCode = code;
		render();
		const panel = h('aside', { class: 'drawer-panel', role: 'dialog', 'aria-labelledby': 'dp-title' });
		const head = h('div', { class: 'dp-head' },
			h('div', { class: 'top' }, h('span', { class: 'mono', text: t.codigo }), h('span', { class: 't3', text: t.areaNombre }), h('span', { style: 'flex:1' }),
				h('button', { type: 'button', class: 'ico', title: 'Cerrar panel', 'aria-label': 'Cerrar panel', icon: 'x', onclick: closePanel })),
			h('h2', { id: 'dp-title', text: t.asunto }),
			h('div', { class: 'chips' },
				h('span', { class: 'pillchip prio ' + t.prioridad }, h('i'), PR[t.prioridad][0]),
				h('span', { class: 'pillchip state', style: 'font-weight:500' }, h('i', { class: 's-' + t.estado }), STATE_NAME[t.estado]),
				t.alerta && ACTIVE.includes(t.estado) ? h('span', { class: 'pillchip red', text: t.alerta }) : null));
		panel.append(head);
		if (editing) panel.append(...editView(t)); else panel.append(...detailView(t));
		document.body.append(panel);
	}

	function detailView(t) {
		const body = h('div', { class: 'dp-body' });
		const viva = ACTIVE.includes(t.estado);
		// Coordinador que también atiende tickets: lo toma él y lo trabaja en Mi panel
		if (D.usuario.atiende && !t.operador && t.estado === 'NUEVO') {
			body.append(h('div', { class: 'sugbox' },
				h('div', { class: 'row1' }, h('b', { text: 'Tomarlo tú' }), h('span', { text: 'Pasa a En atención a tu nombre' })),
				h('div', { class: 'row2' }, h('span', { style: 'flex:1;font-size:12px;color:var(--t2)', text: 'Lo trabajas, respondes y resuelves desde Mi panel.' }),
					h('button', { type: 'button', class: 'primary', text: 'Tomar', onclick: e => {
						e.currentTarget.disabled = true;
						api('POST', '/api/tickets/' + encodeURIComponent(t.codigo) + '/claim')
							.then(() => done('Ticket tomado', t.codigo + ' está en tu panel, En atención', 'green'))
							.catch(err => { e.target.disabled = false; showError(err); });
					} }))));
		}
		if (!t.operador && viva) {
			const sg = sugOf(t.area);
			const sug = sg ? OPS[sg.id] : null;
			const sugBox = (op, motivo, titulo) => h('div', { class: 'sugbox' },
				h('div', { class: 'row1' }, h('b', { text: titulo }), h('span', { text: motivo })),
				h('div', { class: 'row2' }, h('span', { class: 'avatar', text: op.iniciales }),
					h('div', { class: 'nm' }, h('b', { text: op.nombre }), h('span', { text: op.areaNombre + ' · ' + plural(op.carga, 'activo', 'activos') })),
					h('button', { type: 'button', class: 'primary', text: 'Asignar', onclick: () => doAssign([t.codigo], op.id, {}) })),
				h('button', { type: 'button', class: 'linkbtn', style: 'align-self:flex-start;font-size:12px;font-weight:600', text: 'Elegir otro operador', onclick: () => openAssign([t.codigo]) }));
			if (sug) {
				body.append(sugBox(sug, sg.motivo, 'Operador sugerido'));
			} else {
				const otra = otherOf(t.area);
				const slot = h('div');
				body.append(h('div', { class: 'sugbox none' },
					h('div', { class: 'row1' }, h('b', { text: 'En cola de espera' })),
					h('span', { style: 'font-size:12px;line-height:17px', text: 'Nadie de ' + t.areaNombre + ' está disponible ahora. El Dashboard le avisa al coordinador. Nunca se asigna solo.' }),
					h('div', { style: 'display:flex;align-items:center;gap:14px;margin-top:4px' },
						otra ? h('button', {
							type: 'button', class: 'linkbtn', style: 'font-size:12px;font-weight:600', text: 'Sugerir de otra área',
							onclick: e => { e.target.remove(); slot.replaceChildren(sugBox(OPS[otra.id], otra.motivo, 'Sugerido de otra área')); }
						}) : null,
						h('button', { type: 'button', class: 'linkbtn', style: 'font-size:12px;font-weight:600', text: 'Elegir operador', onclick: () => openAssign([t.codigo]) }))));
				body.append(slot);
			}
		}
		body.append(h('div', { class: 'dgrid' },
			h('span', { text: 'Operador' }),
			h('span', { style: 'display:flex;align-items:center;gap:8px;min-width:0' },
				h('span', { style: 'font-weight:500' + (t.operador ? '' : ';color:var(--orange-t)'), text: t.operador ? t.operador.nombre : 'Sin asignar' }), h('span', { style: 'flex:1' }),
				t.operador && viva ? h('button', { type: 'button', class: 'linkbtn', style: 'font-size:12px;font-weight:600', text: 'Reasignar', onclick: () => openAssign([t.codigo]) }) : null),
			h('span', { text: 'Llegada' }), h('span', { text: fecha(t.llegada) + ' · ' + t.origen }),
			h('span', { text: 'Remitente' }), h('span', { class: 'ellipsis', text: t.remitente || '—' }),
			h('span', { text: 'Creado por' }), h('span', { text: t.creadoPor }),
			h('span', { text: 'Desde la llegada' }), h('span', { style: 'font-weight:600;font-variant-numeric:tabular-nums' + (t.alerta && viva ? ';color:var(--red-t)' : ''), text: fmt(t.edadMin) }),
			h('span', { text: 'Último movimiento' }), h('span', { text: t.estado === 'CERRADO' || t.inmovilMin === null ? '—' : (t.inmovilMin < 1 ? 'Ahora' : 'Hace ' + fmt(t.inmovilMin)) })));
		body.append(h('div', { class: 'dsec' }, h('b', { text: 'Descripción' }), h('p', { text: t.descripcion || 'Sin descripción' })));
		body.append(h('div', { class: 'dsec' }, h('b', { text: 'Adjuntos' }),
			t.adjuntos.length
				? t.adjuntos.map(a => {
					const segura = typeof a.ruta === 'string' && a.ruta.startsWith('/uploads/');
					return h(segura ? 'a' : 'div', { class: 'file', href: segura ? a.ruta : undefined, target: segura ? '_blank' : undefined, rel: segura ? 'noopener' : undefined },
						h('span', { class: 'ic', icon: 'file' }), h('span', { class: 'ellipsis', text: a.nombre }));
				})
				: h('span', { class: 't3', style: 'font-size:13px', text: 'Sin adjuntos' })));
		const timeline = h('ol', { class: 'timeline' }, h('li', {}, h('span', { class: 'rail' }, h('i'), h('em')), h('span', { class: 'ev' }, h('b', { text: 'Cargando historial…' }))));
		body.append(h('div', { class: 'dsec', style: 'gap:8px' }, h('b', { text: 'Historial de eventos' }), timeline));
		loadHistory(t.codigo, timeline);

		const foot = h('div', { class: 'dp-foot' },
			h('button', { type: 'button', class: 'textbtn', style: 'padding:0 6px', text: 'Eliminar', onclick: () => openDelete(t.codigo) }),
			h('span', { class: 'grow' }),
			h('button', { type: 'button', class: 'pill pillbtn plain', text: 'Editar', onclick: () => openPanel(t.codigo, true) }),
			t.estado !== 'CERRADO' ? h('button', { type: 'button', class: 'primary', text: 'Cerrar ticket', onclick: () => openClose(t.codigo) }) : null);
		return [body, foot];
	}

	const HIST = {
		TICKET_CERRADO: ['Cerrado', 'var(--t2)'], TICKET_ELIMINADO: ['Enviado a la papelera', 'var(--c-red)'], TICKET_RESTAURADO: ['Restaurado', 'var(--c-green)'],
		TICKET_EDITADO: ['Editado', 'var(--c-blue)'], TICKET_TRASPASADO_GUARDIA: ['En la lista de la guardia', 'var(--c-violet)'],
		TICKET_ASIGNADO: ['Asignado', 'var(--c-blue)'], TICKET_REASIGNADO: ['Reasignado', 'var(--c-blue)'], TICKET_DESASIGNADO: ['Desasignado', 'var(--c-amber)']
	};
	function loadHistory(code, ol) {
		api('GET', '/api/tickets/' + encodeURIComponent(code) + '/history').then(res => {
			const t = BY_CODE[code];
			const items = (res.historial || []).map(e => {
				const k = HIST[e.accion] || [e.accion.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()), 'var(--c-blue)'];
				return [k[0] + (e.detalles ? ' · ' + e.detalles : ''), fecha(e.fecha) + ' · ' + e.usuario, k[1]];
			});
			items.push(['Llegó por ' + t.origen.toLowerCase(), fecha(t.llegada) + ' · ' + t.creadoPor, 'var(--t3)']);
			ol.replaceChildren(...items.map(([txt, meta, dot]) => h('li', {},
				h('span', { class: 'rail' }, h('i', { style: 'background:' + dot }), h('em')),
				h('span', { class: 'ev' }, h('b', { text: txt }), h('span', { text: meta })))));
		}).catch(() => {
			ol.replaceChildren(h('li', {}, h('span', { class: 'rail' }, h('i'), h('em')), h('span', { class: 'ev' }, h('b', { text: 'No se pudo leer el historial' }))));
		});
	}

	function prioSeg(get, set) {
		const box = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Prioridad' });
		const paint = () => box.replaceChildren(...PKEYS.map(k => h('button', {
			type: 'button', role: 'radio', 'aria-checked': String(get() === k),
			onclick: () => { set(k); paint(); }
		}, h('span', {}, h('i', { class: 'mdot', style: 'background:' + PR_DOT[k] }), k === 'SP' ? 'Sin prioridad' : PR[k][0]), h('small', { text: PR[k][1] + ' pts' }))));
		paint();
		return box;
	}
	const estadoVeOpts = cur => [{ value: '', label: 'Sin estado', sel: !cur }].concat(D.estadosVe.map(e => ({ value: e.codigo, label: e.nombre, sel: e.codigo === cur })));
	const estadoVeLabel = cod => { const e = D.estadosVe.find(x => x.codigo === cod); return e ? { label: e.nombre } : { label: 'Sin estado', muted: true }; };
	const areaOpts = cur => D.areas.map(a => ({ value: a.codigo, label: a.nombre, sel: a.codigo === cur }));
	// Campo Subgrupo: solo aparece si el área tiene subgrupos
	function sgField(cls, getArea, get, set) {
		const slot = h('div', { class: cls });
		slot.repaint = () => {
			const lista = SUBS[getArea()] || [];
			slot.hidden = !lista.length;
			slot.replaceChildren(...(lista.length ? [
				cls === 'dsec' ? h('b', { text: 'Subgrupo' }) : h('span', { class: 'flabel', text: 'Subgrupo' }),
				combo(() => (get() ? { label: SG_NAME[get()] || 'Subgrupo' } : { label: 'Sin subgrupo', muted: true }),
					() => [{ value: '', label: 'Sin subgrupo', sel: !get(), hint: 'Lo ve todo el área' }].concat(lista.map(g => ({ value: g.id, label: g.nombre, sel: g.id === get() }))),
					v => set(v))
			] : []));
		};
		slot.repaint();
		return slot;
	}

	function editView(t) {
		const ed = { asunto: t.asunto, prioridad: t.prioridad, area: t.area, subgrupo: t.subgrupo || '', estadoVe: t.estadoVe };
		const input = h('input', { class: 'field', value: t.asunto, oninput: e => { ed.asunto = e.target.value; } });
		const sgSlot = sgField('dsec', () => ed.area, () => ed.subgrupo, v => { ed.subgrupo = v; });
		const body = h('div', { class: 'dp-body', style: 'gap:18px' },
			h('label', { class: 'dsec' }, h('b', { text: 'Asunto' }), input),
			h('div', { class: 'dsec' }, h('b', { text: 'Prioridad' }), prioSeg(() => ed.prioridad, k => { ed.prioridad = k; })),
			h('div', { class: 'dsec' }, h('b', { text: 'Área' }), combo(() => ({ label: AREA_NAME[ed.area] }), () => areaOpts(ed.area), v => { if (v !== ed.area) ed.subgrupo = ''; ed.area = v; sgSlot.repaint(); })),
			sgSlot,
			h('div', { class: 'dsec' }, h('b', { text: 'Estado (mapa del Dashboard)' }), combo(() => estadoVeLabel(ed.estadoVe), () => estadoVeOpts(ed.estadoVe), v => { ed.estadoVe = v; })));
		const foot = h('div', { class: 'dp-foot' },
			h('span', { class: 't3', style: 'font-size:12px', text: 'El cambio queda en Auditoría' }),
			h('span', { class: 'grow' }),
			h('button', { type: 'button', class: 'pill pillbtn plain', text: 'Cancelar', onclick: () => openPanel(t.codigo) }),
			h('button', {
				type: 'button', class: 'primary', text: 'Guardar cambios', onclick: () => {
					const cambios = {};
					if (ed.asunto.trim() !== t.asunto) cambios.asunto = ed.asunto.trim();
					if (ed.prioridad !== t.prioridad) cambios.prioridad = PR_API[ed.prioridad];
					if (ed.area !== t.area) cambios.area_designada = ed.area;
					if (ed.subgrupo !== (t.subgrupo || '')) cambios.subgrupo_id = ed.subgrupo || null;
					if (ed.estadoVe !== t.estadoVe) cambios.estado_ve = ed.estadoVe || null;
					if (!Object.keys(cambios).length) { openPanel(t.codigo); return; }
					if (cambios.asunto === '') { toast('Falta el asunto', 'El asunto no puede quedar vacío', 'red'); return; }
					api('PATCH', '/api/tickets/' + encodeURIComponent(t.codigo), cambios)
						.then(() => done('Ticket actualizado', t.codigo + ' · el cambio queda en Auditoría', 'green')).catch(showError);
				}
			}));
		return [body, foot];
	}

	// ---------- Asignar ----------
	const STATE_ORDER = { turno: 0, guardia: 1, fuera: 2 };
	function opPool(area) {
		return D.operadores.filter(o => !area || o.area === area)
			.sort((a, b) => (STATE_ORDER[a.estado.grupo] - STATE_ORDER[b.estado.grupo]) || (a.carga - b.carga) || a.nombre.localeCompare(b.nombre));
	}
	const ST_COLOR = { turno: 'var(--c-green)', guardia: 'var(--c-violet)', fuera: 'var(--t3)' };

	function openAssign(codes) {
		closeMenu();
		const rs = codes.map(c => BY_CODE[c]).filter(Boolean);
		if (!rs.length) return;
		const single = rs.length === 1 ? rs[0] : null;
		const areas0 = Array.from(new Set(rs.map(r => r.area)));
		const p0s = Array.from(new Set(rs.map(r => r.prioridad)));
		const M = { area: areas0.length === 1 ? areas0[0] : '', p: '', pick: null };
		const ov = dialog(540, []);
		const box = ov.firstElementChild;

		function paint() {
			const pool = opPool(M.area);
			const sg = M.area ? sugOf(M.area) : null;
			const sugId = sg ? sg.id : null;
			const maxL = Math.max(8, ...pool.map(o => o.carga));
			const avg = M.area ? (pool.length ? (pool.reduce((s, o) => s + o.carga, 0) / pool.length).toFixed(1).replace('.', ',') : '—') : '—';
			const okBtn = h('button', { type: 'button', class: 'primary', text: 'Asignar', disabled: !M.pick, onclick: save });
			box.replaceChildren(
				h('div', { class: 'dlg-head' }, h('h2', { text: single ? 'Asignar ' + single.codigo : 'Asignar ' + rs.length + ' tickets' }),
					h('span', { text: single ? (single.operador ? 'Asignado a ' + single.operador.nombre + ' · elige otro operador para reasignar' : 'Sin asignar') : 'Asignación múltiple' })),
				h('div', { class: 'dlg-body' },
					h('div', { class: 'kvgrid' },
						h('span', { text: 'Ticket' }), h('span', { class: 'chips' }, rs.map(r => h('span', { class: 'codechip', text: r.codigo }))),
						h('span', { text: 'Asunto' }), h('span', { style: 'font-weight:500', text: single ? single.asunto : rs.slice(0, 2).map(r => r.asunto).join(' · ') + (rs.length > 2 ? ' …' : '') }),
						h('span', { text: 'Área' }), combo(
							() => ({ label: M.area ? AREA_NAME[M.area] : 'Sin cambio · varias áreas' }),
							() => (areas0.length > 1 ? [{ value: '', label: 'Sin cambio · varias áreas', sel: !M.area }] : [])
								.concat(D.areas.map(a => ({ value: a.codigo, label: a.nombre, sel: a.codigo === M.area, hint: areas0.length === 1 && a.codigo === areas0[0] ? 'Actual' : '' }))),
							v => { M.area = v; M.pick = null; paint(); }),
						h('span', { text: 'Prioridad' }), combo(
							() => {
								const k = M.p || (p0s.length === 1 ? p0s[0] : '');
								return k ? { label: PR[k][0] + (M.p ? '' : ' (actual)'), dot: PR_DOT[k] } : { label: 'Sin cambio', muted: true };
							},
							() => [{ value: '', label: 'Sin cambio', sel: !M.p }].concat(['P1', 'P2', 'P3'].map(k => ({ value: k, label: PR[k][0], hint: PR[k][1] + ' pts', dot: PR_DOT[k], sel: M.p === k }))),
							v => { M.p = v; })),
					h('div', { style: 'display:flex;align-items:baseline;justify-content:space-between;margin-top:4px' },
						h('span', { style: 'font-size:13px;font-weight:600', text: 'Operador' }),
						h('span', { class: 't2', style: 'font-size:12px', text: 'Tickets activos · promedio del área ' + avg })),
					M.area && !sugId ? h('div', { class: 'warnbox', text: 'Nadie disponible en el área. Si no lo asignas, queda en cola de espera y el Dashboard avisa al coordinador.' }) : null,
					pool.length ? h('div', { class: 'oplist', role: 'radiogroup', 'aria-label': 'Operador' }, pool.map(o => {
						const off = o.estado.grupo === 'fuera';
						return h('button', {
							type: 'button', class: 'opchoice', role: 'radio', 'aria-checked': String(M.pick === o.id), disabled: off,
							onclick: () => { M.pick = o.id; paint(); }
						},
						h('span', { class: 'avatar', text: o.iniciales }),
						h('span', { class: 'nm' },
							h('b', {}, o.nombre, o.id === sugId ? h('span', { class: 'tag green', text: 'Sugerido' }) : null, o.sobrecarga ? h('span', { class: 'tag red', text: 'Sobrecarga' }) : null),
							h('span', {}, h('i', { style: 'background:' + ST_COLOR[o.estado.grupo] }), (o.deGuardia ? o.elegible.motivo : o.estado.etiqueta) + (M.area ? '' : ' · ' + o.areaNombre))),
						h('span', { class: 'track' }, h('span', { class: 'bar-fill', style: 'width:' + Math.min(o.carga / maxL * 100, 100) + '%;background:' + (o.sobrecarga ? 'var(--c-red)' : 'var(--c-blue)') })),
						h('span', { class: 'load' + (o.sobrecarga ? ' over' : ''), text: o.carga }));
					})) : h('div', { class: 'empty', text: 'No hay operadores en esta área.' })),
				h('div', { class: 'dlg-foot' },
					rs.some(r => r.operador) ? h('button', { type: 'button', class: 'textbtn', text: 'Desasignar', onclick: () => doUnassign(rs.filter(r => r.operador).map(r => r.codigo)) }) : null,
					h('span', { class: 'grow' }), cancelBtn(ov), okBtn));
		}
		function save() {
			if (!M.pick) return;
			const extra = {};
			if (M.area && !(areas0.length === 1 && M.area === areas0[0])) extra.areaDesignada = M.area;
			if (M.p) extra.prioridad = M.p;
			doAssign(rs.map(r => r.codigo), M.pick, extra);
		}
		paint();
	}

	function doAssign(codes, operatorId, extra) {
		const nombre = OPS[operatorId] ? OPS[operatorId].nombre : 'el operador';
		const req = codes.length === 1
			? api('POST', '/api/tickets/assign', Object.assign({ ticketCode: codes[0], operatorId }, extra))
			: api('POST', '/api/tickets/batch-assign', Object.assign({ ticketCodes: codes, operatorId }, extra));
		req.then(() => done(codes.length === 1 ? 'Ticket asignado' : 'Tickets asignados', (codes.length === 1 ? codes[0] : plural(codes.length, 'ticket', 'tickets')) + ' → ' + nombre, 'green'))
			.catch(showError);
	}
	async function doUnassign(codes) {
		try {
			for (const c of codes) await api('POST', '/api/tickets/unassign', { ticketCode: c });
			done(codes.length === 1 ? 'Ticket desasignado' : 'Tickets desasignados', codes.join(', ') + ' vuelve a la cola sin asignar', 'blue');
		} catch (e) { showError(e); }
	}

	// ---------- Cerrar / Eliminar ----------
	function textDialog(opts) {
		const ov = dialog(480, []);
		const box = ov.firstElementChild;
		const area = h('textarea', { class: 'field', rows: 3, placeholder: opts.placeholder, maxlength: 300 });
		const counter = h('span', { class: 'counter' });
		const ok = h('button', { type: 'button', class: opts.danger ? 'dangerbtn' : 'primary', text: opts.okLabel });
		const sync = () => {
			const n = area.value.trim().length;
			counter.textContent = opts.min ? n + ' / mínimo ' + opts.min : n + ' / 300';
			counter.classList.toggle('ok', !!opts.min && n >= opts.min);
			ok.disabled = !!opts.min && n < opts.min;
		};
		area.addEventListener('input', sync);
		ok.addEventListener('click', () => { if (!ok.disabled) opts.onOk(area.value.trim(), ov); });
		box.append(
			h('div', { class: 'dlg-head', style: 'padding-bottom:4px' }, h('h2', { text: opts.title }), h('span', { text: opts.subject })),
			h('div', { class: 'dlg-body', style: 'gap:10px' },
				opts.warn ? h('div', { class: 'warnbox', text: opts.warn }) : null,
				opts.info ? h('span', { style: 'font-size:13px;line-height:19px', text: opts.info }) : null,
				h('span', { class: 'flabel', style: 'margin-top:4px', text: opts.label }),
				opts.templates ? h('div', { class: 'chips' }, opts.templates.map(p => h('button', { type: 'button', class: 'tpl', text: p, onclick: () => { area.value = p; sync(); area.focus(); } }))) : null,
				area, counter),
			h('div', { class: 'dlg-foot' }, h('span', { class: 'grow' }), cancelBtn(ov), ok));
		sync();
		setTimeout(() => area.focus(), 30);
	}
	function openClose(code) {
		const t = BY_CODE[code];
		if (!t) return;
		textDialog({
			title: 'Cerrar ' + code, subject: t.asunto,
			warn: t.estado !== 'RESUELTO' ? 'El operador aún no lo marcó como resuelto. Al cerrarlo se registra como resuelto ahora.' : null,
			label: 'Motivo de cierre (opcional)', templates: CLOSE_TPL, placeholder: 'Qué se hizo para cerrarlo', okLabel: 'Cerrar ticket',
			onOk: motivo => api('POST', '/api/tickets/' + encodeURIComponent(code) + '/close', motivo ? { motivo } : {})
				.then(() => done('Ticket cerrado', code + (motivo ? ' · ' + motivo : ''), 'green')).catch(showError)
		});
	}
	function openDelete(code) {
		const t = BY_CODE[code];
		if (!t) return;
		const terminado = ['RESUELTO', 'CERRADO'].includes(t.estado);
		textDialog({
			title: 'Eliminar ' + code, subject: t.asunto, danger: true, min: 3,
			warn: terminado ? 'Este ticket ya está ' + STATE_NAME[t.estado].toLowerCase() + '. Al eliminarlo deja de contar en las métricas.' : null,
			info: 'Pasa a la papelera y se puede restaurar. Queda registrado en Auditoría y el código no se reutiliza.',
			label: 'Motivo', placeholder: 'Por qué se elimina (mínimo 3 caracteres)', okLabel: 'Eliminar',
			onOk: motivo => api('DELETE', '/api/tickets/' + encodeURIComponent(code), { motivo, confirmar: terminado })
				.then(() => done('Ticket en la papelera', code + ' · se puede restaurar', 'red')).catch(showError)
		});
	}

	// ---------- Papelera ----------
	function openTrash() {
		const ov = dialog(640, []);
		const box = ov.firstElementChild;
		const list = h('div', { style: 'padding:0 24px 6px;display:flex;flex-direction:column' }, h('span', { class: 'empty', style: 'text-align:center', text: 'Cargando…' }));
		box.append(
			h('div', { class: 'dlg-head', style: 'padding-bottom:10px' }, h('h2', { text: 'Papelera' }), h('span', { 'data-trash-sub': '', text: plural(D.enPapelera, 'ticket eliminado', 'tickets eliminados') })),
			list,
			h('div', { class: 'dlg-foot' }, h('span', { class: 'note', text: 'Restaurar devuelve el ticket a su estado anterior' }), h('span', { class: 'grow' }),
				h('button', { type: 'button', class: 'pill pillbtn plain', text: 'Listo', onclick: () => ov.remove() })));
		api('GET', '/api/tickets/trash').then(res => {
			const items = res.tickets || [];
			if (!items.length) { list.replaceChildren(h('span', { style: 'padding:28px 0;text-align:center;font-size:13px', class: 't3', text: 'La papelera está vacía' })); return; }
			list.replaceChildren(...items.map(x => h('div', { class: 'trashrow' },
				h('span', { class: 'mono t2', style: 'font-size:12px', text: x.codigo_incidencia }),
				h('span', { class: 'txt' }, h('b', { text: x.asunto }), h('span', { text: 'Motivo: ' + (x.motivo_eliminacion || '—') }),
					h('small', { text: (AREA_NAME[x.area_designada] || x.area_designada) + ' · ' + STATE_NAME[x.estado_actual] + ' · eliminado ' + fecha(x.eliminado_en) })),
				h('button', {
					type: 'button', class: 'pill pillbtn accent', style: 'height:30px;padding:0 14px;font-size:12px', text: 'Restaurar',
					onclick: () => api('POST', '/api/tickets/' + encodeURIComponent(x.codigo_incidencia) + '/restore')
						.then(() => done('Ticket restaurado', x.codigo_incidencia + ' vuelve a la cola', 'green')).catch(showError)
				}))));
		}).catch(e => { list.replaceChildren(h('span', { class: 'empty', text: e.message })); });
	}

	// ---------- Traspasar a guardia ----------
	function openHandoff(codes) {
		const rows = (codes && codes.length ? codes.map(c => BY_CODE[c]) : D.tickets.filter(t => ACTIVE.includes(t.estado)))
			.filter(t => t && ACTIVE.includes(t.estado)).sort(order);
		const ov = dialog(620, []);
		const box = ov.firstElementChild;
		const area = h('textarea', { class: 'field', rows: 3, placeholder: 'Qué queda pendiente y qué debe vigilar la guardia' });
		const counter = h('span', { class: 'counter', style: 'margin-top:-6px' });
		const ok = h('button', { type: 'button', class: 'primary', text: 'Traspasar' });
		const sync = () => {
			const n = area.value.trim().length;
			counter.textContent = n + ' / mínimo 10';
			counter.classList.toggle('ok', n >= 10);
			ok.disabled = n < 10 || !rows.length;
		};
		area.addEventListener('input', sync);
		ok.addEventListener('click', () => {
			if (ok.disabled) return;
			api('POST', '/api/tickets/handoff', { ticketCodes: rows.map(t => t.codigo), nota: area.value.trim() })
				.then(() => { S.sel.clear(); done('Traspaso enviado', plural(rows.length, 'pendiente', 'pendientes') + ' y la nota quedan en la lista de la guardia', 'violet'); })
				.catch(showError);
		});
		const stat = (label, value, cls) => h('div', { class: 'stat' }, h('span', { text: label }), h('span', { class: 'kv ' + (cls || ''), text: value }));
		box.append(
			h('div', { class: 'dlg-head' }, h('h2', { text: 'Traspasar a guardia' }), h('span', { text: plural(rows.length, 'ticket pendiente', 'tickets pendientes') + ' para la guardia' })),
			h('div', { class: 'dlg-body', style: 'gap:14px' },
				h('div', { class: 'handbox' },
					h('span', { class: 'flabel', text: 'Resumen para quien recibe' }),
					h('div', { class: 'stats' },
						stat('Pendientes', rows.length), stat('P1 abiertos', rows.filter(t => t.prioridad === 'P1').length, 't-red'),
						stat('Sin asignar', rows.filter(t => !t.operador).length, 't-orange'), stat('En espera de terceros', rows.filter(t => t.estado === 'EN_ESPERA_TERCEROS').length)),
					rows.length ? h('div', { class: 'handlist' }, rows.map(t => h('div', {},
						h('span', { class: 'mono t-accent', style: 'font-weight:600', text: t.codigo }),
						h('span', { class: 'prio ' + t.prioridad, text: t.prioridad === 'SP' ? '—' : t.prioridad }),
						h('span', { class: 'ellipsis', text: t.asunto }),
						h('span', { class: 'ellipsis', style: 'color:' + (t.operador ? 'var(--t2)' : 'var(--orange-t)'), text: t.operador ? t.operador.nombre : (t.enCola ? 'En cola de espera' : 'Sin asignar') }),
						h('span', { style: 'text-align:right;font-weight:600;font-variant-numeric:tabular-nums' + (t.alerta ? ';color:var(--red-t)' : ''), text: fmt(t.edadMin) })))) : h('span', { class: 'empty', text: 'No hay tickets activos para traspasar.' })),
				h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
					h('div', { class: 'flabel row' }, 'De guardia esta semana', h('small', { text: '17:00–24:00 · reciben la lista y la nota' })),
					D.guardias.length
						? h('div', { class: 'guardlist' }, D.guardias.map(g => h('div', {}, h('span', { class: 'avatar', text: g.nombre.split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() }), h('b', { style: 'flex:1;font-weight:600', text: g.nombre }), h('span', { class: 't2', style: 'font-size:12px', text: g.area }))))
						: h('div', { class: 'warnbox', text: 'Nadie está marcado de guardia esta semana. Defínelo en Gestión de Turno; el traspaso queda guardado igual.' })),
				h('span', { class: 't2', style: 'font-size:12px;line-height:17px', text: 'Los tickets no cambian de operador. La guardia los ve en una lista aparte de pendientes y puede tomarlos o pedir que se reasignen.' }),
				h('span', { class: 'flabel', text: 'Nota de traspaso' }),
				h('div', { class: 'chips' }, HAND_TPL.map(p => h('button', { type: 'button', class: 'tpl', text: p, onclick: () => { area.value = area.value.trim() ? area.value.trim() + '. ' + p : p; sync(); area.focus(); } }))),
				area, counter),
			h('div', { class: 'dlg-foot' }, h('span', { class: 'grow' }), cancelBtn(ov), ok));
		sync();
	}

	// ---------- Nuevo ticket ----------
	function openNew() {
		const N = { asunto: '', desc: '', origen: 'COORDINADOR', area: '', subgrupo: '', remitente: '', p: 'SP', op: '', estadoVe: '' };
		const sgSlot = sgField('fld', () => N.area, () => N.subgrupo, v => { N.subgrupo = v; });
		const ov = dialog(940, []);
		const box = ov.firstElementChild;
		const missing = h('span', { class: 'note' });
		const ok = h('button', { type: 'button', class: 'primary', text: 'Crear ticket' });
		const senderSlot = h('div', { class: 'fld span2' });
		const opSlot = h('div', { class: 'fld span2' });
		const sync = () => {
			const falta = [];
			if (!N.asunto.trim()) falta.push('asunto');
			if (!N.area) falta.push('área');
			if (N.origen === 'CORREO' && !N.remitente.trim()) falta.push('remitente');
			missing.textContent = falta.length ? 'Falta: ' + falta.join(', ') : 'Listo para crear';
			ok.disabled = falta.length > 0;
		};
		const paintSender = () => {
			senderSlot.replaceChildren(h('span', { class: 'flabel', text: 'Remitente' }), N.origen === 'CORREO'
				? h('input', { class: 'field', value: N.remitente, maxlength: 180, placeholder: 'Nombre y correo del remitente', oninput: e => { N.remitente = e.target.value; sync(); } })
				: h('span', { class: 'field ro', text: 'No aplica: lo registra el coordinador' }));
		};
		const paintOp = () => {
			const sg = N.area ? sugOf(N.area) : null;
			const sugId = sg ? sg.id : null;
			const opts = [{ value: '', label: 'Sin asignar', sel: !N.op, hint: N.area && !sugId ? 'Entra en cola de espera' : '' }].concat(N.area ? opPool(N.area).map(o => {
				const b = o.id === sugId ? ['Sugerido', 'green'] : o.estado.grupo === 'fuera' ? ['Fuera de turno', 'gray'] : o.estado.grupo === 'guardia' ? ['De guardia', 'purple'] : o.sobrecarga ? ['Sobrecarga', 'red'] : null;
				return { value: o.id, label: o.nombre, dot: ST_COLOR[o.estado.grupo], dis: o.estado.grupo === 'fuera', sel: N.op === o.id, badge: b, hint: o.estado.grupo === 'fuera' ? '' : plural(o.carga, 'activo', 'activos') };
			}) : []);
			opSlot.replaceChildren(
				h('div', { class: 'flabel row' }, 'Asignar a', h('small', { text: 'Opcional' }), h('span', { style: 'flex:1' }),
					sugId && N.op !== sugId ? h('button', { type: 'button', class: 'linkbtn', style: 'display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600', onclick: () => { N.op = sugId; paintOp(); } },
						h('span', { class: 'tag green', text: 'Sugerido' }), OPS[sugId].nombre) : null),
				combo(() => (N.op ? { label: OPS[N.op].nombre, dot: ST_COLOR[OPS[N.op].estado.grupo] } : { label: 'Sin asignar', muted: true }), () => opts, v => { N.op = v; paintOp(); }),
				h('span', { class: 't3', style: 'font-size:12px', text: N.area ? (sugId ? 'Sugerido: ' + sg.motivo.toLowerCase() + '.' : 'Nadie disponible en el área: si no lo asignas, entra en cola de espera.') : 'Elige primero el área.' }));
		};
		box.append(
			h('div', { style: 'display:flex;align-items:center;gap:12px;padding:18px 18px 14px 24px;border-bottom:1px solid var(--sep)' },
				h('div', { class: 'dlg-head', style: 'padding:0;flex:1' }, h('h2', { text: 'Nuevo ticket' }), h('span', { text: 'Los mismos datos que trae un correo del buzón compartido' })),
				h('span', { style: 'display:flex;align-items:center;gap:8px' }, h('span', { class: 't3', style: 'font-size:11px', text: 'Código provisional' }), h('span', { class: 'codechip', text: D.siguienteCodigo })),
				h('button', { type: 'button', class: 'ico', 'aria-label': 'Cerrar', title: 'Cerrar', icon: 'x', onclick: () => ov.remove() })),
			h('div', { class: 'nt-grid' },
				h('div', { class: 'left' },
					h('label', {}, h('span', { class: 'flabel', text: 'Asunto' }), h('input', { class: 'field', maxlength: 300, placeholder: 'Resumen del incidente', oninput: e => { N.asunto = e.target.value; sync(); } })),
					h('label', { style: 'flex:1' }, h('span', { class: 'flabel', text: 'Descripción' }), h('textarea', { class: 'field', rows: 7, style: 'flex:1;min-height:150px', placeholder: 'Síntomas, impacto y contexto técnico', oninput: e => { N.desc = e.target.value; } })),
					h('div', { class: 'fld' }, h('span', { class: 'flabel', text: 'Adjuntos' }),
						h('span', { class: 'field ro', style: 'height:auto;padding:10px', text: 'Los adjuntos se agregan desde el correo del buzón compartido. Subirlos desde aquí queda pendiente.' }))),
				h('div', { class: 'right' },
					h('div', { class: 'fld' }, h('span', { class: 'flabel', text: 'Origen' }),
						combo(() => ({ label: ORIGINS.find(o => o[0] === N.origen)[1] }), () => ORIGINS.map(o => ({ value: o[0], label: o[1], sel: o[0] === N.origen })), v => { N.origen = v; paintSender(); sync(); })),
					h('div', { class: 'fld' }, h('span', { class: 'flabel', text: 'Área' }),
						combo(() => (N.area ? { label: AREA_NAME[N.area] } : { label: 'Elegir área', muted: true }), () => areaOpts(N.area), v => { N.area = v; N.op = ''; N.subgrupo = ''; sgSlot.repaint(); paintOp(); sync(); })),
					sgSlot,
					h('div', { class: 'fld' }, h('span', { class: 'flabel row' }, 'Estado', h('small', { text: 'Opcional' })),
						combo(() => estadoVeLabel(N.estadoVe), () => estadoVeOpts(N.estadoVe), v => { N.estadoVe = v; })),
					senderSlot,
					h('div', { class: 'fld' }, h('span', { class: 'flabel', text: 'Fecha de creación' }), h('span', { class: 'field ro', text: 'Al crear (ahora)' })),
					h('div', { class: 'fld' }, h('span', { class: 'flabel', text: 'Creado por' }),
						h('span', { class: 'field ro', style: 'color:var(--t1)' }, h('span', { class: 'avatar on-solid', style: 'width:20px;height:20px;font-size:10px;background:var(--solid)', text: (D.usuario.nombre[0] || 'C').toUpperCase() }), D.usuario.nombre)),
					h('div', { class: 'fld span2' }, h('span', { class: 'flabel', text: 'Prioridad y puntaje' }), prioSeg(() => N.p, k => { N.p = k; })),
					opSlot)),
			h('div', { class: 'dlg-foot', style: 'padding-bottom:18px' }, missing, h('span', { class: 'grow' }), cancelBtn(ov), ok));
		ok.addEventListener('click', async () => {
			if (ok.disabled) return;
			ok.disabled = true;
			try {
				const res = await api('POST', '/api/tickets', {
					asunto: N.asunto.trim(), descripcion: N.desc.trim(), areaDesignada: N.area, subgrupoId: N.subgrupo || undefined,
					origenIngesta: N.origen, remitente: N.remitente.trim(), prioridad: PR_API[N.p], estadoVe: N.estadoVe || null
				});
				const code = res.ticket.codigo_incidencia;
				if (N.op) {
					try { await api('POST', '/api/tickets/assign', { ticketCode: code, operatorId: N.op }); }
					catch (e) { done('Ticket creado sin asignar', code + ' · no se pudo asignar: ' + e.message, 'red'); return; }
				}
				done('Ticket creado', code + (N.op ? ' → ' + OPS[N.op].nombre : ' · sin asignar'), 'green');
			} catch (e) { ok.disabled = false; showError(e); }
		});
		paintSender();
		paintOp();
		sync();
	}

	// ---------- Arranque ----------
	document.addEventListener('DOMContentLoaded', () => {
		$('[data-search]').addEventListener('input', e => { S.q = e.target.value.trim().toLowerCase(); render(); });
		document.querySelectorAll('[data-clear-filters]').forEach(b => b.addEventListener('click', clearFilters));
		$('[data-select-all]').addEventListener('change', e => {
			const visibles = D.tickets.filter(t => match(t));
			if (e.target.checked) visibles.forEach(t => S.sel.add(t.codigo)); else visibles.forEach(t => S.sel.delete(t.codigo));
			render();
		});
		$('[data-open-trash]').addEventListener('click', openTrash);
		$('[data-open-handoff]').addEventListener('click', () => openHandoff(null));
		$('[data-new-ticket]').addEventListener('click', openNew);
		$('[data-batch-clear]').addEventListener('click', () => { S.sel.clear(); render(); });
		$('[data-batch-assign]').addEventListener('click', () => openAssign(Array.from(S.sel)));
		$('[data-batch-handoff]').addEventListener('click', () => openHandoff(Array.from(S.sel)));
		render();
		try {
			const t = JSON.parse(sessionStorage.getItem('kip.toast') || 'null');
			sessionStorage.removeItem('kip.toast');
			if (t) toast(t.title, t.msg, t.tone);
		} catch (e) { /* sin aviso */ }
		// Enlace directo a un ticket: /tickets#INC-012
		const hash = decodeURIComponent(window.location.hash.slice(1));
		if (BY_CODE[hash]) openPanel(hash);
	});
})();
