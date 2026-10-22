// Panel del operador (Fase 9, prototipo Operador.dc.html).
// El servidor dibuja encabezado, tarjetas y traspaso; aquí se dibujan la bandeja,
// los menús (avisos, disponibilidad), las hojas (pausar, resolver, fuera de puesto)
// y el detalle del ticket. Todo el texto se escribe con textContent.
(function () {
	'use strict';

	const raw = document.getElementById('opDatos');
	const DATOS = raw ? JSON.parse(raw.textContent) : { panel: { colas: [] }, usuario: {} };
	const P = DATOS.panel;
	const COLAS = P.colas || [];
	const BY_CODE = {};
	COLAS.forEach(q => q.tickets.forEach(t => { BY_CODE[t.code] = t; }));

	const STEP = 20;
	const PRIO = {
		P1: { label: 'P1 Crítica', short: 'P1', dot: '#EF4444', text: 'var(--red-t)', bg: 'var(--red-bg)' },
		P2: { label: 'P2 Media', short: 'P2', dot: '#F59E0B', text: 'var(--orange-t)', bg: 'var(--orange-bg)' },
		P3: { label: 'P3 Baja', short: 'P3', dot: '#94A3B8', text: 'var(--t2)', bg: 'var(--fill)' },
		SP: { label: 'Sin prioridad', short: 'S/P', dot: 'transparent', text: 'var(--t3)', bg: 'var(--fill)' }
	};
	const AVAIL_DOT = { Disponible: '#22C55E', Atendiendo: '#0EA5E9', 'Fuera de puesto': '#F59E0B', Ausente: '#94A3B8' };
	const MOTIVOS = ['Almuerzo', 'Reunión', 'En otra área del edificio', 'En sitio'];
	const GLYPH = {
		ok: 'M5 12l5 5L19 7', play: 'M8 5v14l11-7z', pause: 'M9 6v12M15 6v12', x: 'M6 6l12 12M18 6L6 18',
		clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2', warn: 'M12 3l10 18H2zM12 10v4M12 17.5v.5',
		user: 'M9 8a3 3 0 1 0 0-.01M3 19a6 6 0 0 1 12 0M18 8v6M15 11h6', bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
		down: 'M6 9l6 6 6-6', check: 'M5 13l4 4L19 7', moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
		out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
		phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
		me: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0'
	};

	// ---------- Utilidades ----------
	const $ = id => document.getElementById(id);
	function h(tag, props) {
		const n = document.createElement(tag);
		const p = props || {};
		Object.keys(p).forEach(k => {
			const v = p[k];
			if (v === undefined || v === null || v === false) return;
			if (k === 'class') n.className = v;
			else if (k === 'text') n.textContent = v;
			else if (k === 'style') n.setAttribute('style', v);
			else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2).toLowerCase(), v);
			else if (v === true) n.setAttribute(k, '');
			else n.setAttribute(k, String(v));
		});
		for (let i = 2; i < arguments.length; i++) add(n, arguments[i]);
		return n;
	}
	function add(n, c) {
		if (c === undefined || c === null || c === false) return;
		if (Array.isArray(c)) { c.forEach(x => add(n, x)); return; }
		n.append(c.nodeType ? c : document.createTextNode(String(c)));
	}
	function icon(d, size, color, width) {
		const ns = 'http://www.w3.org/2000/svg';
		const s = document.createElementNS(ns, 'svg');
		s.setAttribute('width', size || 14);
		s.setAttribute('height', size || 14);
		s.setAttribute('viewBox', '0 0 24 24');
		s.setAttribute('fill', 'none');
		s.setAttribute('stroke', color || 'currentColor');
		s.setAttribute('stroke-width', width || 2.2);
		s.setAttribute('stroke-linecap', 'round');
		s.setAttribute('stroke-linejoin', 'round');
		s.setAttribute('aria-hidden', 'true');
		const path = document.createElementNS(ns, 'path');
		path.setAttribute('d', d);
		s.append(path);
		return s;
	}
	const store = {
		get(k, ses) { try { return (ses ? sessionStorage : localStorage).getItem(k); } catch (e) { return null; } },
		set(k, v, ses) { try { (ses ? sessionStorage : localStorage).setItem(k, v); } catch (e) { /* solo se pierde la preferencia */ } },
		del(k, ses) { try { (ses ? sessionStorage : localStorage).removeItem(k); } catch (e) { /* nada */ } }
	};
	const pad = n => String(n).padStart(2, '0');
	const fmtMin = m => (m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + pad(m % 60));
	const minutesSince = iso => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
	// Hora y minutos de Caracas (UTC-4), sin depender de la zona del equipo
	const caracasNow = () => { const d = new Date(Date.now() - 4 * 3600 * 1000); return { sec: d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds(), dia: d.toISOString().slice(0, 10) }; };

	function toast(title, msg, tone) {
		const old = document.querySelector('.toast');
		if (old) old.remove();
		const T = { blue: ['#0A84FF', GLYPH.play], green: ['#34C759', GLYPH.ok], orange: ['#FF9F0A', GLYPH.pause], violet: ['#8B5CF6', GLYPH.clock], gray: ['#8E8E93', GLYPH.x], red: ['#FF3B30', GLYPH.warn] }[tone] || ['#0A84FF', GLYPH.ok];
		const n = h('div', { class: 'notif toast', role: 'status', 'aria-live': 'polite' },
			h('span', { class: 'ti', style: 'background:' + T[0] }, icon(T[1], 17, '#FFFFFF', 2.8)),
			h('div', { class: 'tx' }, h('b', { text: title }), h('span', { text: msg })),
			h('span', { class: 't3', style: 'font-size:11px', text: 'Ahora' }));
		document.body.append(n);
		setTimeout(() => n.remove(), 4200);
	}
	function done(title, msg, tone) {
		store.set('kip.toast', JSON.stringify({ title, msg, tone }), true);
		window.location.reload();
	}
	async function api(url, method, body) {
		const opts = { method, headers: {} };
		if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
		const res = await fetch(url, opts);
		let j = {};
		try { j = await res.json(); } catch (e) { j = {}; }
		if (!res.ok || j.success === false) throw new Error(j.error || j.message || 'No se pudo completar la acción');
		return j;
	}

	// ---------- Estado de la bandeja ----------
	const S = { q: P.colaInicial || 'atencion', pf: 'all', qs: '', lim: STEP, busy: false };
	const savedQ = store.get('kip.op.q', true);
	if (savedQ && COLAS.some(q => q.k === savedQ)) S.q = savedQ;
	const curQueue = () => COLAS.find(q => q.k === S.q) || COLAS[0];

	function timeText(t) {
		if (t.cola === 'resueltos') return '+' + t.pts;
		const m = minutesSince(t.desde);
		return m < 1 && t.cola !== 'entrantes' ? 'Ahora' : fmtMin(m);
	}

	function actionsFor(t) {
		if (t.cola === 'entrantes') return [['Detalles', 'btn-s', 'open'], ['Tomar', 'btn-p', 'claim']];
		if (t.cola === 'asignados') return [['Empezar', 'btn-p', 'claim']];
		if (t.cola === 'atencion') return [['Pausar', 'btn-s', 'pause'], ['Resolver', 'btn-g', 'resolve']];
		if (t.cola === 'espera') return [['Reanudar', 'btn-p', 'resume'], ['Resolver', 'btn-g', 'resolve']];
		return [];
	}

	function renderNav() {
		const nav = $('opQnav');
		nav.textContent = '';
		nav.append(h('span', { class: 'qnav-h', text: 'Mis colas' }));
		COLAS.forEach(q => {
			const on = q.k === S.q;
			const hot = q.k === 'entrantes' && q.hayP1;
			const n = h('span', { class: 'qn' + (hot ? ' hot' : ''), text: q.tickets.length });
			if (on && !hot) n.setAttribute('style', 'background:' + q.color + ';color:#FFFFFF');
			nav.append(h('button', {
				type: 'button', class: 'qitem', 'aria-current': on ? 'true' : 'false',
				'aria-label': q.label + ', ' + q.tickets.length + (hot ? ', con P1' : ''),
				onclick: () => { S.q = q.k; S.pf = 'all'; S.qs = ''; S.lim = STEP; $('opSearch').value = ''; store.set('kip.op.q', q.k, true); render(); }
			},
			h('span', { class: 'qic', style: 'background:' + q.color }, icon(q.glyph, 14, '#FFFFFF')),
			h('span', { class: 'ql' }, h('span', { class: 'qt', text: q.label }), h('span', { class: 'qs', text: q.hint })),
			n));
		});
	}

	function filtered(q) {
		const qs = S.qs.trim().toLowerCase();
		return q.tickets
			.filter(t => S.pf === 'all' || t.p === S.pf)
			.filter(t => !qs || (t.code + ' ' + t.subject).toLowerCase().includes(qs));
	}

	function renderFilter(q) {
		const box = $('opPf');
		box.textContent = '';
		[['all', 'Todas'], ['P1', 'P1'], ['P2', 'P2'], ['P3', 'P3'], ['SP', 'Sin prioridad']].forEach(([k, label]) => {
			const n = k === 'all' ? q.tickets.length : q.tickets.filter(t => t.p === k).length;
			const dot = k === 'all' ? null : h('i', { style: 'background:' + (PRIO[k].dot === 'transparent' ? 'var(--sep)' : PRIO[k].dot) });
			box.append(h('button', {
				type: 'button', role: 'tab', 'aria-selected': S.pf === k ? 'true' : 'false',
				onclick: () => { S.pf = k; S.lim = STEP; render(); }
			}, dot, label, h('small', { text: n })));
		});
	}

	function renderRow(t, i) {
		const pr = PRIO[t.p] || PRIO.SP;
		const cls = 'trow' + (t.cola === 'entrantes' && t.p === 'P1' ? ' p1' : '') + (t.cola === 'asignados' ? ' nuevo' : '');
		const tags = [];
		if (t.tag) tags.push(h('span', { class: 'tag sm ' + t.tagTono, text: t.tag }));
		if (t.cola === 'entrantes' && t.otraArea) tags.push(h('span', { class: 'tag sm gray', text: t.areaNombre }));
		const err = h('span', { class: 'err', role: 'alert', hidden: true });
		const acts = actionsFor(t).map(([label, c, act]) => h('button', { type: 'button', class: c, 'data-act': act, 'data-code': t.code, text: label }));
		return h('div', { class: cls, style: 'animation-delay:' + Math.min(i, 12) * 30 + 'ms', 'data-row': t.code },
			h('span', { class: 'ppill ' + t.p, title: t.sugerida ? 'Sin prioridad · sugerida ' + t.sugerida + ' por palabras clave; la eliges al tomarlo' : pr.label, text: t.sugerida ? 'S/P · ' + t.sugerida + '?' : pr.short }),
			h('div', { class: 'tmain' },
				h('span', null, h('span', { class: 'tcode', text: t.code }), h('button', { type: 'button', class: 'tlink', 'data-open': t.code, title: 'Ver detalles de ' + t.code, text: t.subject })),
				h('span', null, tags, h('span', { class: 'tmeta' + (t.alerta ? ' alert' : ''), text: t.meta }))),
			h('span', { class: 'ttime' + (t.alerta ? ' alert' : '') + (t.cola === 'resueltos' ? ' pts' : ''), 'data-desde': t.cola === 'resueltos' ? null : t.desde, 'data-code': t.code, text: timeText(t) }),
			h('div', { class: 'tacts' }, acts, err));
	}

	function render() {
		const q = curQueue();
		if (!q) return;
		renderNav();
		$('h-cola').textContent = q.title;
		$('opQdesc').textContent = q.desc || '';
		renderFilter(q);
		const list = $('opList');
		list.textContent = '';
		const rows = filtered(q);
		const shown = rows.slice(0, S.lim);
		if (shown.length) {
			list.append(h('div', { class: 'qhead', 'aria-hidden': 'true' },
				h('span', { style: 'width:34px', text: 'Prio.' }), h('span', { style: 'flex:1', text: 'Ticket' }),
				h('span', { style: 'width:84px;text-align:right', text: q.timeH }), h('span', { style: 'width:158px' })));
			shown.forEach((t, i) => list.append(renderRow(t, i)));
			if (rows.length > shown.length) {
				const step = Math.min(STEP, rows.length - shown.length);
				list.append(h('div', { class: 'qmore' },
					h('span', { text: 'Mostrando ' + shown.length + ' de ' + rows.length }),
					h('button', { type: 'button', class: 'btn-s', text: 'Mostrar ' + step + ' más', onclick: () => { S.lim += STEP; render(); } })));
			}
		} else {
			const hay = q.tickets.length > 0;
			list.append(h('div', { class: 'qempty' },
				h('span', { class: 'qic', style: 'background:' + q.color }, icon(q.glyph, 14, '#FFFFFF')),
				h('b', { text: hay ? (S.qs.trim() ? 'Nada coincide con “' + S.qs.trim() + '”' : 'Sin tickets con esa prioridad') : q.emptyT }),
				h('span', { text: hay ? 'Cambia la búsqueda o el filtro para ver el resto' : q.emptyS })));
		}
	}

	// Los tiempos avanzan sin recargar
	function tickTimes() {
		document.querySelectorAll('.ttime[data-desde]').forEach(el => {
			const t = BY_CODE[el.dataset.code];
			if (t) el.textContent = timeText(t);
		});
	}

	// ---------- Menús (avisos, disponibilidad, menú del teléfono) ----------
	let menu = null;
	function closeMenu() {
		if (!menu) return;
		menu.el.remove();
		menu.btn.setAttribute('aria-expanded', 'false');
		menu = null;
	}
	function openMenu(btn, el) {
		const same = menu && menu.btn === btn;
		closeMenu();
		if (same) return;
		btn.parentElement.append(el);
		// En el teléfono los menús van a lo ancho, justo debajo del botón
		if (window.matchMedia('(max-width: 640px)').matches && !el.classList.contains('me')) el.style.top = Math.round(btn.getBoundingClientRect().bottom + 6) + 'px';
		btn.setAttribute('aria-expanded', 'true');
		menu = { btn, el };
		const first = el.querySelector('.mitem:not([disabled])');
		if (first) first.focus();
	}
	document.addEventListener('click', e => {
		if (menu && !menu.el.contains(e.target) && !menu.btn.contains(e.target)) closeMenu();
	});

	// Avisos: los que se deducen de las colas (P1 nuevos, antigüedad, asignados)
	function renderBell() {
		const wrap = $('opBell');
		if (!wrap) return;
		const avisos = P.avisos || [];
		const btn = h('button', { type: 'button', class: 'popup h32 bellb', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'Avisos, ' + avisos.length + ' activos' },
			icon(GLYPH.bell, 15, 'currentColor', 2.2), avisos.length ? h('span', { class: 'bn', text: avisos.length > 9 ? '9+' : avisos.length }) : null);
		btn.addEventListener('click', e => {
			e.stopPropagation();
			const COL = { p1: ['#EF4444', GLYPH.warn], antiguedad: ['#F59E0B', GLYPH.clock], asignado: ['#0A84FF', GLYPH.user] };
			const el = h('div', { class: 'mmenu notes', role: 'dialog', 'aria-label': 'Avisos' },
				h('div', { class: 'notes-hd' }, h('b', { text: 'Avisos' }), h('span', { text: 'Dentro del portal' })),
				avisos.length ? avisos.map(a => h('div', { class: 'alert-row' },
					h('span', { class: 'ai', style: 'background:' + COL[a.tipo][0] }, icon(COL[a.tipo][1], 13, '#FFFFFF', 2.4)),
					h('div', { class: 'at' }, h('div', null, h('b', { text: a.titulo }), h('small', { text: a.hace })), h('span', { text: a.detalle }))))
					: h('div', { class: 'notes-empty', text: 'Sin avisos por ahora' }));
			openMenu(btn, el);
		});
		wrap.textContent = '';
		wrap.append(btn);
	}

	// Disponibilidad: Disponible y Atendiendo son automáticos; Fuera de puesto y Ausente los marca el operador
	const fuera = () => { try { return JSON.parse(store.get('kip.op.fuera') || 'null'); } catch (e) { return null; } };
	function availName() {
		const e = P.disponibilidad.estadoOperativo;
		if (e === 'AUSENTE') return 'Ausente';
		if (e === 'EN_TERRENO') return 'Fuera de puesto';
		return P.disponibilidad.auto;
	}
	async function setAvail(estado, title, msg, tone) {
		closeMenu();
		try {
			await api('/api/operators/' + encodeURIComponent(DATOS.usuario.id) + '/status', 'PATCH', { estadoOperativo: estado });
			if (estado !== 'EN_TERRENO') store.del('kip.op.fuera');
			done(title, msg, tone);
		} catch (err) {
			toast('No se pudo cambiar tu estado', err.message, 'red');
		}
	}
	function renderAvail() {
		const wrap = $('opAvail');
		if (!wrap) return;
		const name = availName();
		const f = fuera();
		const value = name + (name === 'Fuera de puesto' && f && f.hasta ? ' · vuelve ' + f.hasta : '');
		const btn = h('button', { type: 'button', class: 'popup h32', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': 'Mi disponibilidad: ' + value },
			h('span', { class: 'avdot', style: 'background:' + AVAIL_DOT[name] }), h('span', { style: 'font-weight:600', text: value }), icon(GLYPH.down, 10, 'currentColor', 2.8));
		btn.addEventListener('click', e => {
			e.stopPropagation();
			const manual = name === 'Fuera de puesto' || name === 'Ausente';
			const activos = P.mezcla.total;
			const opt = (label, hint, sel, dis, pick) => h('button', {
				type: 'button', role: 'option', class: 'mitem', 'aria-selected': sel ? 'true' : 'false', 'data-sel': sel ? 'true' : 'false', disabled: dis,
				onclick: ev => { ev.stopPropagation(); if (!dis) pick(); }
			}, h('span', { class: 'mdot', style: 'background:' + AVAIL_DOT[label] }), h('span', { class: 'ml', text: label }), h('span', { class: 'mh', text: hint }),
			h('span', { class: 'mk' }, sel ? icon(GLYPH.check, 11, 'currentColor', 3) : null));
			const el = h('div', { class: 'mmenu avail', role: 'listbox', 'aria-label': 'Disponibilidad' },
				opt('Disponible', 'Automático', !manual && name === 'Disponible', P.disponibilidad.atendiendo && !manual,
					() => setAvail('DISPONIBLE', 'Disponible', 'Vuelves a recibir tickets', 'green')),
				opt('Atendiendo', 'Automático con un P1', !manual && name === 'Atendiendo', true, () => {}),
				opt('Fuera de puesto', name === 'Fuera de puesto' && f ? f.motivo : 'Motivo y hora de regreso', name === 'Fuera de puesto', false, () => { closeMenu(); awaySheet(); }),
				opt('Ausente', 'Se avisa al coordinador', name === 'Ausente', false,
					() => setAvail('AUSENTE', 'Ausente', activos ? 'El coordinador lo ve en su panel: tienes ' + activos + (activos === 1 ? ' ticket activo' : ' tickets activos') : 'No recibirás tickets', 'gray')));
			openMenu(btn, el);
		});
		wrap.textContent = '';
		wrap.append(btn);
	}

	// Menú del avatar (teléfono): sin barra lateral, aquí van Mi perfil, Contactos, Tema y Cerrar sesión
	function bindMe() {
		const btn = document.querySelector('[data-menu-me]');
		if (!btn) return;
		btn.addEventListener('click', e => {
			e.stopPropagation();
			const el = h('div', { class: 'mmenu me', role: 'menu' },
				h('a', { class: 'mitem', role: 'menuitem', href: '/perfil' }, icon(GLYPH.me, 14), h('span', { class: 'ml', text: 'Mi perfil' })),
				h('a', { class: 'mitem', role: 'menuitem', href: '/contactos' }, icon(GLYPH.phone, 14), h('span', { class: 'ml', text: 'Contactos' })),
				h('button', { type: 'button', class: 'mitem', role: 'menuitem', onclick: () => {
					const root = document.documentElement;
					const tema = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
					root.setAttribute('data-theme', tema);
					store.set('kip.theme', tema);
					closeMenu();
				} }, icon(GLYPH.moon, 14), h('span', { class: 'ml', text: 'Cambiar tema' })),
				h('a', { class: 'mitem', role: 'menuitem', href: '/auth/logout' }, icon(GLYPH.out, 14), h('span', { class: 'ml', text: 'Cerrar sesión' })));
			openMenu(btn, el);
		});
	}

	// ---------- Hojas ----------
	let sheet = null;
	function closeSheet() { if (sheet) { sheet.remove(); sheet = null; } }
	function openSheet(title, subtitle, body, okLabel, onOk) {
		closeSheet();
		const err = h('span', { class: 'sherr', role: 'alert', hidden: true });
		const ok = h('button', { type: 'button', class: 'primary', text: okLabel });
		const ov = h('div', { class: 'overlay op-sheet', onclick: e => { if (e.target === ov) closeSheet(); } },
			h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'opShTitle' },
				h('div', { class: 'dlg-head' }, h('h2', { id: 'opShTitle', text: title }), h('span', { text: subtitle })),
				h('div', { class: 'dlg-body' }, body, err),
				h('div', { class: 'dlg-foot' }, h('span', { class: 'grow' }),
					h('button', { type: 'button', class: 'pill pillbtn plain', text: 'Cancelar', onclick: closeSheet }), ok)));
		ok.addEventListener('click', async () => {
			ok.disabled = true;
			err.hidden = true;
			try { await onOk(); } catch (e) {
				ok.disabled = false;
				err.textContent = e.message || 'No se pudo completar la acción';
				err.hidden = false;
			}
		});
		document.body.append(ov);
		sheet = ov;
		const first = ov.querySelector('[aria-checked=true], textarea, input, .primary');
		if (first) setTimeout(() => first.focus(), 30);
	}
	function seg(options, initial, onPick) {
		const box = h('div', { class: 'seg', role: 'radiogroup' });
		let val = initial;
		const draw = () => {
			box.textContent = '';
			options.forEach(([k, label]) => box.append(h('button', {
				type: 'button', role: 'radio', 'aria-checked': val === k ? 'true' : 'false',
				onclick: () => { val = k; onPick(k); draw(); }
			}, h('span', { text: label }))));
		};
		draw();
		return box;
	}

	function statusSheet(kind, t) {
		const isPause = kind === 'pause';
		let destino = 'EN_PAUSA';
		const txt = h('textarea', { class: 'field', rows: 3, maxlength: 500, placeholder: isPause ? 'Por ejemplo: esperando ventana del cliente' : 'Por ejemplo: se reemplazó el splitter' });
		const body = [
			isPause ? seg([['EN_PAUSA', 'En pausa'], ['EN_ESPERA_TERCEROS', 'En espera de terceros']], destino, k => { destino = k; }) : null,
			h('label', { class: 'flabel', text: isPause ? 'Motivo (opcional)' : 'Qué se hizo (opcional)' }),
			txt
		];
		openSheet((isPause ? 'Pausar ' : 'Resolver ') + t.code, t.subject, body, isPause ? 'Pausar' : 'Marcar como resuelto', async () => {
			const nota = txt.value.trim();
			await api('/api/tickets/' + encodeURIComponent(t.code) + '/status', 'PATCH', { status: isPause ? destino : 'RESUELTO', nota });
			if (!isPause) done('Marcado como resuelto', t.code + ' queda pendiente de cierre del coordinador', 'green');
			else done(destino === 'EN_PAUSA' ? 'Ticket en pausa' : 'En espera de terceros', t.code + (nota ? ' · ' + nota : ''), 'orange');
		});
	}

	// Tipos de caso del área (Administración): el nivel da los puntos (N1=2, N2=4, N3=8, N4=10)
	const NIVEL_PTS = { 1: 2, 2: 4, 3: 8, 4: 10 };
	const TIPOS = DATOS.tiposCaso || [];

	// Al tomar: sin prioridad (p. ej. llegó por correo) se elige partiendo de la sugerida;
	// sin tipo de caso se elige del catálogo del área, o "Otro" con su nivel
	function prioritySheet(t, btn) {
		const pideP = t.p === 'SP';
		const pideTipo = !t.nivel;
		let elegida = pideP ? (t.sugerida || '') : t.p;
		const delArea = TIPOS.filter(x => x.area === t.area);
		const tipoSel = pideTipo ? h('select', { class: 'field', 'aria-label': 'Tipo de caso' },
			h('option', { value: '', text: 'Elige el tipo de caso…' }),
			delArea.length ? h('optgroup', { label: 'Casos comunes de tu área' },
				delArea.map(x => h('option', { value: 'id:' + x.id, text: x.nombre + ' · N' + x.nivel + ' (' + x.puntos + ' pts)' }))) : null,
			h('optgroup', { label: 'Otro (no está en la lista)' },
				[1, 2, 3, 4].map(n => h('option', { value: 'n:' + n, text: 'Otro · nivel ' + n + ' (' + NIVEL_PTS[n] + ' pts)' })))) : null;
		const body = [
			pideP ? h('span', { class: 'flabel', text: t.sugerida ? 'Prioridad sugerida por palabras clave: ' + t.sugerida + '. Confírmala o cámbiala' : 'Elige la prioridad según la urgencia del caso' }) : null,
			pideP ? seg([['P1', 'P1 Crítica'], ['P2', 'P2 Media'], ['P3', 'P3 Baja']], elegida, k => { elegida = k; }) : null,
			pideTipo ? h('span', { class: 'flabel', text: 'Tipo de caso' }) : null,
			tipoSel,
			h('span', { class: 't2', style: 'font-size:12px', text: pideTipo ? 'El nivel de dificultad da los puntos que suma a tu carga al resolverlo (N1 = 2, N2 = 4, N3 = 8, N4 = 10). El coordinador puede corregirlo.' : 'El coordinador puede corregirla.' })
		];
		openSheet((t.cola === 'asignados' ? 'Empezar ' : 'Tomar ') + t.code, t.subject, body, t.cola === 'asignados' ? 'Empezar' : 'Tomar', async () => {
			if (!elegida) throw new Error('Elige una prioridad');
			const v = tipoSel ? tipoSel.value : '';
			if (pideTipo && !v) throw new Error('Elige el tipo de caso');
			const tipo = v.slice(0, 3) === 'id:' ? { tipoCasoId: v.slice(3) } : v ? { nivel: Number(v.slice(2)) } : null;
			closeSheet();
			await act('claim', t.code, btn, pideP ? elegida : null, tipo);
		});
	}

	function awaySheet() {
		const prev = fuera() || {};
		let motivo = prev.motivo || MOTIVOS[0];
		const chips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Motivo' });
		const draw = () => {
			chips.textContent = '';
			MOTIVOS.forEach(m => chips.append(h('button', { type: 'button', role: 'radio', 'aria-checked': m === motivo ? 'true' : 'false', text: m, onclick: () => { motivo = m; draw(); } })));
		};
		draw();
		const now = caracasNow();
		const sug = Math.min(23 * 60 + 59, Math.floor(now.sec / 60) + 60);
		const until = h('input', { class: 'field', type: 'time', value: prev.hasta || pad(Math.floor(sug / 60)) + ':' + pad(sug % 60) });
		openSheet('Fuera de puesto', 'Mientras tanto no se te asignan tickets. Vuelves a Disponible a la hora indicada.',
			[h('span', { class: 'flabel', text: 'Motivo' }), chips, h('label', { class: 'until' }, h('span', { class: 'flabel', text: 'Vuelvo a las' }), until)],
			'Marcar fuera de puesto', async () => {
				const hasta = until.value;
				if (!/^\d{2}:\d{2}$/.test(hasta)) throw new Error('Indica la hora de regreso');
				await api('/api/operators/' + encodeURIComponent(DATOS.usuario.id) + '/status', 'PATCH', { estadoOperativo: 'EN_TERRENO' });
				store.set('kip.op.fuera', JSON.stringify({ motivo, hasta, dia: caracasNow().dia }));
				done('Fuera de puesto', motivo + ' · vuelves a las ' + hasta, 'orange');
			});
	}

	// Al llegar la hora de regreso, vuelve a Disponible solo
	async function checkReturn() {
		if (P.disponibilidad.estadoOperativo !== 'EN_TERRENO') return;
		const f = fuera();
		if (!f || !f.hasta) return;
		const now = caracasNow();
		const [hh, mm] = f.hasta.split(':').map(Number);
		if (f.dia < now.dia || now.sec >= hh * 3600 + mm * 60) {
			try {
				await api('/api/operators/' + encodeURIComponent(DATOS.usuario.id) + '/status', 'PATCH', { estadoOperativo: 'DISPONIBLE' });
				store.del('kip.op.fuera');
				done('Disponible', 'Pasó tu hora de regreso (' + f.hasta + ')', 'green');
			} catch (e) { /* se reintenta en el siguiente minuto */ }
		}
	}

	// ---------- Acciones sobre tickets ----------
	async function act(action, code, btn, prioridad, tipo) {
		const t = BY_CODE[code] || { code, subject: '' };
		if (action === 'open') return openTicketDetails(code);
		if (action === 'pause' || action === 'resolve') { closeTicketDetailsModal(); return statusSheet(action, t); }
		if (action === 'claim' && ((t.p === 'SP' && !prioridad) || (!t.nivel && !tipo))) { closeTicketDetailsModal(); return prioritySheet(t, btn); }
		if (S.busy) return;
		S.busy = true;
		const all = Array.from(document.querySelectorAll('button[data-act]'));
		all.forEach(b => { b.disabled = true; });
		if (btn) btn.textContent = action === 'claim' ? (t.cola === 'asignados' ? 'Empezando…' : 'Tomando…') : 'Actualizando…';
		try {
			if (action === 'claim') {
				const cuerpo = Object.assign({}, prioridad ? { prioridad } : {}, tipo || {});
				await api('/api/tickets/' + encodeURIComponent(code) + '/claim', 'POST', Object.keys(cuerpo).length ? cuerpo : undefined);
				done(t.cola === 'asignados' ? 'Ticket en atención' : 'Ticket tomado', code + ' pasó a En atención', t.cola === 'asignados' ? 'blue' : 'green');
			} else if (action === 'resume') {
				await api('/api/tickets/' + encodeURIComponent(code) + '/status', 'PATCH', { status: 'EN_PROGRESO' });
				done('Ticket reanudado', code + ' vuelve a En atención', 'blue');
			}
		} catch (err) {
			S.busy = false;
			render();
			const fb = document.getElementById('modalDetailFeedback');
			const overlay = document.getElementById('ticketDetailsOverlay');
			if (overlay && !overlay.classList.contains('hidden') && fb) {
				fb.textContent = err.message;
				fb.classList.remove('hidden');
				document.querySelectorAll('#modalDetailActionContainer button').forEach(b => { b.disabled = false; });
			} else {
				toast('No se pudo completar', err.message, 'red');
			}
			all.forEach(b => { if (b.isConnected) b.disabled = false; });
		}
	}

	document.addEventListener('click', e => {
		const open = e.target.closest('[data-open]');
		if (open) { openTicketDetails(open.dataset.open); return; }
		const b = e.target.closest('button[data-act]');
		if (b && !b.disabled) act(b.dataset.act, b.dataset.code, b);
	});

	// ---------- Detalle del ticket (pestañas Detalle y Conversación) ----------
	const STATUS = {
		NUEVO: ['Sin asignar', 'var(--fill)', 'var(--t2)'],
		ASIGNADO: ['Asignado a ti · sin empezar', 'var(--purple-bg)', 'var(--purple-t)'],
		EN_PROGRESO: ['En atención', 'var(--accent-bg)', 'var(--accent-t)'],
		EN_PAUSA: ['En pausa', 'var(--orange-bg)', 'var(--orange-t)'],
		EN_ESPERA_TERCEROS: ['Espera de terceros', 'var(--purple-bg)', 'var(--purple-t)'],
		RESUELTO: ['Pendiente de cierre', 'var(--orange-bg)', 'var(--orange-t)'],
		CERRADO: ['Cerrado', 'var(--green-bg)', 'var(--green-t)']
	};
	function handoffTicket(code) {
		const f = P.traspaso && P.traspaso.filas.find(x => x.code === code);
		if (!f) return null;
		return { code, subject: f.subject, p: f.p, pts: f.pts || 0, nivel: f.nivel || null, tipoCaso: f.tipoCaso || '', area: f.area, estado: f.puedeTomar ? 'NUEVO' : '', cola: f.puedeTomar ? 'entrantes' : 'traspaso', areaNombre: '—', remitente: '', origen: '—', recibido: '', asignado: f.op, desc: '' };
	}
	function openTicketDetails(code) {
		const t = BY_CODE[code] || handoffTicket(code);
		if (!t) return;
		closeMenu();
		const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
		set('modalDetailCode', t.code);
		set('modalDetailSubject', t.subject || 'Sin asunto');
		set('modalDetailDescription', t.desc || 'Sin descripción registrada.');
		set('modalDetailArea', t.areaNombre || '—');
		set('modalDetailAssigned', t.asignado || '—');
		set('modalDetailSender', t.remitente || '—');
		set('modalDetailOrigin', t.origen || '—');
		set('modalDetailCreated', t.recibido || '—');
		set('modalDetailPts', t.nivel ? (t.tipoCaso || 'Otro') + ' · N' + t.nivel + ' · ' + (t.pts || 0) + ' pts' : 'Sin tipo de caso (lo eliges al tomarlo)');

		const pr = PRIO[t.p] || PRIO.SP;
		const pb = $('modalDetailPriorityBadge');
		pb.textContent = '';
		pb.style.background = pr.bg;
		pb.style.color = pr.text;
		const dot = h('span', { class: 'dot', style: 'background:' + pr.dot + (pr.dot === 'transparent' ? ';box-shadow:inset 0 0 0 1px var(--t3)' : '') });
		pb.append(dot, pr.label);

		const st = STATUS[t.cola === 'asignados' ? 'ASIGNADO' : t.estado] || [t.estado || '—', 'var(--fill)', 'var(--t2)'];
		const sb = $('modalDetailStatusBadge');
		sb.textContent = st[0];
		sb.style.background = st[1];
		sb.style.color = st[2];

		const box = $('modalDetailActionContainer');
		box.textContent = '';
		const fb = $('modalDetailFeedback');
		fb.textContent = '';
		fb.classList.add('hidden');
		const CLS = { 'btn-p': 'p', 'btn-s': 's', 'btn-g': 'g' };
		actionsFor(t).filter(a => a[2] !== 'open').forEach(([label, c, a]) => {
			box.append(h('button', { type: 'button', class: 'td-btn ' + CLS[c], 'data-act': a, 'data-code': t.code, text: label }));
		});

		const overlay = $('ticketDetailsOverlay');
		overlay.classList.remove('hidden');
		if (window.TicketConversacion) window.TicketConversacion.abrir(t.code);
		const x = overlay.querySelector('.tdlg-x');
		if (x) x.focus();
	}
	function closeTicketDetailsModal() {
		const overlay = $('ticketDetailsOverlay');
		if (overlay && !overlay.classList.contains('hidden')) {
			overlay.classList.add('hidden');
			if (window.TicketConversacion) window.TicketConversacion.cerrar();
		}
	}
	window.openTicketDetails = openTicketDetails;
	window.closeTicketDetailsModal = closeTicketDetailsModal;
	window.handleTicketDetailsBackdrop = e => { if (e.target === $('ticketDetailsOverlay')) closeTicketDetailsModal(); };

	document.addEventListener('keydown', e => {
		if (e.key !== 'Escape') return;
		if (menu) { closeMenu(); return; }
		if (sheet) { closeSheet(); return; }
		// Escape no descarta un mensaje a medio escribir
		if (!(e.target && e.target.id === 'tdText' && e.target.value.trim())) closeTicketDetailsModal();
	});

	// ---------- Reloj del turno ----------
	function startClock() {
		const svg = $('opClock');
		if (!svg) return;
		const hands = { h: svg.querySelector('[data-hand=h]'), m: svg.querySelector('[data-hand=m]'), s: svg.querySelector('[data-hand=s]') };
		const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reduce) hands.s.remove();
		const inicio = Number(svg.dataset.inicio), fin = Number(svg.dataset.fin);
		const CIRC = 2 * Math.PI * 30;
		const doneArc = svg.querySelector('[data-clk-done]');
		// Ángulos acumulados: la aguja nunca gira hacia atrás al pasar por las 12
		const t0 = caracasNow().sec, start = Date.now();
		let lastMin = -1;
		const draw = () => {
			const rel = Math.floor((Date.now() - start) / 1000);
			const sec = t0 + rel;
			hands.h.style.transform = 'rotate(' + (((t0 % 43200) + rel) / 120).toFixed(2) + 'deg)';
			hands.m.style.transform = 'rotate(' + (((t0 % 3600) + rel) / 10).toFixed(1) + 'deg)';
			if (!reduce) hands.s.style.transform = 'rotate(' + ((t0 % 60) + rel) * 6 + 'deg)';
			const min = Math.floor((sec % 86400) / 60);
			if (min !== lastMin) {
				lastMin = min;
				const done = Math.min(fin - inicio, 720, Math.max(0, min - inicio));
				doneArc.setAttribute('stroke-dasharray', (done / 720 * CIRC).toFixed(1) + ' ' + CIRC.toFixed(1));
				svg.setAttribute('aria-label', 'Son las ' + pad(Math.floor(min / 60)) + ':' + pad(min % 60) + ', turno de ' + pad(Math.floor(inicio / 60)) + ':' + pad(inicio % 60) + ' a ' + (fin >= 1440 ? '24:00' : pad(Math.floor(fin / 60)) + ':' + pad(fin % 60)));
				if (rel > 0) { tickTimes(); checkReturn(); }
			}
		};
		draw();
		setInterval(draw, reduce ? 60000 : 1000);
	}

	// ---------- Actualización automática ----------
	// Cada 30 s compara la página nueva con la actual; si cambió algún ticket, recarga
	// (no interrumpe si hay un detalle, una hoja, un menú o una búsqueda abiertos).
	const fingerprint = colas => colas.map(q => q.k + ':' + q.tickets.map(t => t.code + '/' + t.estado).join(',')).join('|');
	const current = fingerprint(COLAS);
	async function poll() {
		if (document.hidden || S.busy || menu || sheet || S.qs.trim()) return;
		const overlay = $('ticketDetailsOverlay');
		if (overlay && !overlay.classList.contains('hidden')) return;
		try {
			const res = await fetch(window.location.pathname, { cache: 'no-store', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
			if (!res.ok) return;
			const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
			const node = doc.getElementById('opDatos');
			if (!node) return;
			const next = JSON.parse(node.textContent);
			if (fingerprint(next.panel.colas || []) !== current) window.location.reload();
		} catch (e) { /* se reintenta en la siguiente vuelta */ }
	}

	// ---------- Inicio ----------
	document.addEventListener('DOMContentLoaded', () => {
		$('opSearch').addEventListener('input', e => { S.qs = e.target.value; S.lim = STEP; render(); });
		render();
		renderBell();
		renderAvail();
		bindMe();
		startClock();
		checkReturn();
		setInterval(poll, 30000);
		document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
		try {
			const t = JSON.parse(store.get('kip.toast', true) || 'null');
			store.del('kip.toast', true);
			if (t) toast(t.title, t.msg, t.tone);
		} catch (e) { /* sin aviso */ }
	});
})();
