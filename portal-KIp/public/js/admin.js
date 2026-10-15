// Administración: secciones, plantillas, reglas de alerta (con vista previa) y avisos.
// Lleva un borrador de la configuración y la guarda con PUT /api/admin/config.
(function () {
	'use strict';

	let D;
	try { D = JSON.parse(document.getElementById('admin-data').textContent); } catch (e) { return; }
	const SAVED = JSON.stringify(D.config);
	const C = JSON.parse(SAVED); // borrador
	let leaving = false;

	const $ = s => document.querySelector(s);
	const $$ = s => Array.from(document.querySelectorAll(s));
	function h(tag, props) {
		const n = document.createElement(tag);
		const p = props || {};
		Object.keys(p).forEach(k => {
			const v = p[k];
			if (v === undefined || v === null || v === false) return;
			if (k === 'class') n.className = v;
			else if (k === 'text') n.textContent = v;
			else if (k === 'html') n.insertAdjacentHTML('afterbegin', v); // solo íconos constantes
			else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2).toLowerCase(), v);
			else if (v === true) n.setAttribute(k, '');
			else n.setAttribute(k, String(v));
		});
		for (let i = 2; i < arguments.length; i++) {
			const c = arguments[i];
			(Array.isArray(c) ? c : [c]).forEach(x => { if (x !== undefined && x !== null && x !== false) n.append(x.nodeType ? x : document.createTextNode(String(x))); });
		}
		return n;
	}
	const dec = n => String(Math.round(n * 10) / 10).replace('.', ',');
	const fmtMin = m => (m < 60 ? m + ' min' : dec(m / 60) + ' h');
	const ICON = {
		edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
		trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
		plus: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
	};

	function paintDirty() {
		const dirty = JSON.stringify(C) !== SAVED;
		$('[data-dirty]').hidden = !dirty;
		$('[data-discard]').hidden = !dirty;
		$('[data-save]').hidden = !dirty;
		const sub = $('[data-sec-sub="plantillas"]');
		if (sub) sub.textContent = (C.plantillas.traspaso.length + C.plantillas.cierre.length) + ' textos';
		return dirty;
	}

	function toast(title, msg, ok) {
		const old = document.querySelector('.toast');
		if (old) old.remove();
		const n = h('div', { class: 'notif toast', role: 'status' },
			h('span', { class: 'ti', style: 'background:' + (ok ? 'var(--c-green)' : 'var(--c-red)'), html: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (ok ? 'M5 12l5 5L19 7' : 'M12 8v5M12 16.5v.5') + '"/></svg>' }),
			h('div', { class: 'tx' }, h('b', { text: title }), h('span', { text: msg })));
		document.body.append(n);
		setTimeout(() => n.remove(), 4200);
	}

	// ---------- Controles ----------
	function sw(on, onToggle, label) {
		return h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(on), 'aria-label': label, onclick: onToggle }, h('span', { class: 'knob' }));
	}
	function stepper(value, label, onDn, onUp) {
		return h('span', { class: 'stepper' },
			h('button', { type: 'button', 'aria-label': 'Menos', text: '−', onclick: onDn }),
			h('span', { text: value, 'aria-label': label }),
			h('button', { type: 'button', 'aria-label': 'Más', text: '+', onclick: onUp }));
	}
	const AGE_STEPS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1440];
	const SOON_STEPS = [15, 30, 45, 60, 90, 120];
	function stepList(list, cur, d) {
		let i = list.indexOf(cur);
		if (i < 0) i = list.findIndex(x => x > cur) - (d > 0 ? 1 : 0);
		return list[Math.max(0, Math.min(list.length - 1, i + d))];
	}

	// ---------- Plantillas ----------
	function renderPlantillas() {
		const box = $('[data-panel="plantillas"]');
		box.replaceChildren(...[
			['traspaso', 'Notas de traspaso', 'Se ofrecen al traspasar pendientes a la guardia', 'Nueva nota de traspaso'],
			['cierre', 'Motivos de cierre', 'Se ofrecen al cerrar un ticket', 'Nuevo motivo de cierre']
		].map(([tipo, titulo, sub, ph]) => {
			const lista = C.plantillas[tipo];
			const draft = h('input', { class: 'field', placeholder: ph, 'aria-label': ph, maxlength: D.limites.texto, style: 'flex:1;padding:6px 10px;height:30px' });
			const add = h('button', { type: 'button', class: 'pill pillbtn accent', style: 'height:30px;padding:0 14px;font-size:12px', html: ICON.plus, disabled: true }, 'Agregar');
			const syncAdd = () => { add.disabled = draft.value.trim().length < 3 || lista.length >= D.limites.plantillas; };
			draft.addEventListener('input', syncAdd);
			const doAdd = () => {
				const t = draft.value.replace(/\s+/g, ' ').trim();
				if (t.length < 3 || lista.length >= D.limites.plantillas) return;
				if (lista.some(x => x.toLowerCase() === t.toLowerCase())) { toast('Ya existe', 'Esa plantilla ya está en la lista', false); return; }
				lista.push(t);
				renderPlantillas();
				paintDirty();
			};
			add.addEventListener('click', doAdd);
			draft.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
			return h('section', { class: 'glass', style: 'display:flex;flex-direction:column;overflow:hidden' },
				h('div', { class: 'card-head', style: 'padding:18px 24px 12px;align-items:baseline' }, h('h2', { text: titulo }), h('span', { class: 'hint', text: sub })),
				h('div', { class: 'tpl-list' }, lista.map((texto, i) => tplRow(tipo, i, texto))),
				h('div', { style: 'display:flex;align-items:center;gap:8px;padding:12px 16px 16px 24px' }, draft, add),
				lista.length >= D.limites.plantillas ? h('span', { class: 't3', style: 'padding:0 24px 14px;font-size:12px', text: 'Máximo ' + D.limites.plantillas + ' plantillas' }) : null);
		}));
	}
	function tplRow(tipo, i, texto) {
		const row = h('div', { class: 'row tpl-row' });
		const view = () => row.replaceChildren(
			h('span', { style: 'flex:1;font-size:13px', text: texto }),
			h('button', { type: 'button', class: 'ico', title: 'Editar', 'aria-label': 'Editar plantilla', html: ICON.edit, onclick: edit }),
			h('button', { type: 'button', class: 'ico danger', title: 'Eliminar', 'aria-label': 'Eliminar plantilla', html: ICON.trash, onclick: () => { C.plantillas[tipo].splice(i, 1); renderPlantillas(); paintDirty(); } }));
		const edit = () => {
			const input = h('input', { class: 'field', value: texto, maxlength: D.limites.texto, 'aria-label': 'Texto de la plantilla', style: 'flex:1;padding:6px 10px;height:30px' });
			const ok = () => { const t = input.value.replace(/\s+/g, ' ').trim(); if (t.length >= 3) { C.plantillas[tipo][i] = t; renderPlantillas(); paintDirty(); } };
			input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') view(); });
			row.replaceChildren(input,
				h('button', { type: 'button', class: 'pill pillbtn plain', style: 'height:28px;padding:0 12px;font-size:12px', text: 'Cancelar', onclick: view }),
				h('button', { type: 'button', class: 'primary', style: 'height:28px;padding:0 12px;font-size:12px', text: 'Listo', onclick: ok }));
			input.focus();
		};
		view();
		return row;
	}

	// ---------- Reglas de alerta ----------
	let preview = D.vistaPrevia;
	let previewTimer = null;
	function schedulePreview() {
		clearTimeout(previewTimer);
		previewTimer = setTimeout(() => {
			fetch('/api/admin/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reglas: C.reglas }) })
				.then(r => r.json()).then(j => { if (j.success) { preview = j; renderReglas(); } }).catch(() => { /* la vista previa es opcional */ });
		}, 300);
	}
	function changeRules(fn) { fn(C.reglas); renderReglas(); paintDirty(); schedulePreview(); }

	function renderReglas() {
		const r = C.reglas;
		const L = D.limites;
		const ov = r.sobrecarga, ag = r.antiguedad, sg = r.sugerencia, me = r.metas;
		const hitsOv = ov.activa ? preview.sobrecarga : [];
		const hitsAg = ag.activa ? preview.antiguedad : [];
		const box = $('[data-panel="reglas"]');
		box.replaceChildren(
			h('section', { class: 'glass card', 'aria-labelledby': 'h-ov' },
				h('div', { class: 'card-head' },
					h('div', { style: 'display:flex;flex-direction:column;flex:1' }, h('h2', { id: 'h-ov', text: 'Sobrecarga' }), h('span', { class: 'hint', text: 'Se muestra en Alertas del Dashboard y en la ventana de asignación' })),
					sw(ov.activa, () => changeRules(x => { x.sobrecarga.activa = !x.sobrecarga.activa; }), 'Activar alerta de sobrecarga')),
				h('div', { class: 'rule-line' + (ov.activa ? '' : ' off') },
					h('span', { text: 'Activos mayores a' }),
					stepper(dec(ov.multiplicador) + '×', 'Multiplicador',
						() => changeRules(x => { x.sobrecarga.multiplicador = Math.max(L.multiplicador[0], Math.round((x.sobrecarga.multiplicador - 0.1) * 10) / 10); }),
						() => changeRules(x => { x.sobrecarga.multiplicador = Math.min(L.multiplicador[1], Math.round((x.sobrecarga.multiplicador + 0.1) * 10) / 10); })),
					h('span', { text: 'el promedio del área, con un mínimo de' }),
					stepper(String(ov.minimo), 'Mínimo de activos',
						() => changeRules(x => { x.sobrecarga.minimo = Math.max(L.minimo[0], x.sobrecarga.minimo - 1); }),
						() => changeRules(x => { x.sobrecarga.minimo = Math.min(L.minimo[1], x.sobrecarga.minimo + 1); })),
					h('span', { text: 'activos' })),
				h('div', { class: 'preview' },
					h('b', { text: !ov.activa ? 'Alerta apagada' : hitsOv.length ? 'Con esta regla, hoy ' + (hitsOv.length === 1 ? 'aparece 1 operador' : 'aparecen ' + hitsOv.length + ' operadores') : 'Con esta regla, hoy nadie aparece en sobrecarga' }),
					hitsOv.map(o => h('span', {}, h('i', { class: 'pv-ini red', text: o.nombre.split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() }), h('strong', { text: o.nombre }),
						h('span', { class: 't2', text: o.carga + ' activos · promedio ' + dec(o.promedio) + ' en ' + o.area + ' · índice ' + dec(o.indice) }))))),
			h('section', { class: 'glass card', 'aria-labelledby': 'h-ca' },
				h('div', { class: 'card-head' },
					h('div', { style: 'display:flex;flex-direction:column;flex:1' }, h('h2', { id: 'h-ca', text: 'Saturación por área' }), h('span', { class: 'hint', text: 'Carga por área del Dashboard: puntos abiertos ÷ (personas en turno × esta capacidad). P1=8, P2=5, P3 y sin prioridad=1' }))),
				h('div', { class: 'rule-line' },
					h('span', { text: 'Cada persona en turno aguanta' }),
					stepper(String(r.capacidad.puntosPorPersona), 'Puntos por persona',
						() => changeRules(x => { x.capacidad.puntosPorPersona = Math.max(L.puntosPorPersona[0], x.capacidad.puntosPorPersona - 2); }),
						() => changeRules(x => { x.capacidad.puntosPorPersona = Math.min(L.puntosPorPersona[1], x.capacidad.puntosPorPersona + 2); })),
					h('span', { text: 'puntos abiertos (16 = dos P1)' }))),
			h('section', { class: 'glass card', 'aria-labelledby': 'h-ag' },
				h('div', { class: 'card-head' },
					h('div', { style: 'display:flex;flex-direction:column;flex:1' }, h('h2', { id: 'h-ag', text: 'Antigüedad' }), h('span', { class: 'hint', text: 'Aviso cuando un ticket pasa el tiempo de su prioridad sin asignar o sin movimiento' })),
					sw(ag.activa, () => changeRules(x => { x.antiguedad.activa = !x.antiguedad.activa; }), 'Activar alerta de antigüedad')),
				h('div', { class: 'rule-rows' + (ag.activa ? '' : ' off') }, [
					['P1', 'P1 Crítica', 'var(--c-red)', 'Sin asignar o sin movimiento'],
					['P2', 'P2 Media', 'var(--c-amber)', 'Sin asignar o sin movimiento'],
					['P3', 'P3 Baja', 'var(--c-slate)', 'Sin asignar o sin movimiento'],
					['SP', 'Sin prioridad', 'transparent', 'Llegó y nadie le fijó prioridad']
				].map(([k, label, dot, desc]) => h('div', { class: 'rule-row' },
					h('i', { class: 'pdot', style: 'background:' + dot + (dot === 'transparent' ? ';box-shadow:inset 0 0 0 1px var(--t3)' : '') }),
					h('span', { class: 'lbl' }, h('b', { text: label }), h('span', { text: desc })),
					h('span', { class: 't2', text: 'más de' }),
					stepper(fmtMin(ag[k]), 'Límite ' + label,
						() => changeRules(x => { x.antiguedad[k] = stepList(AGE_STEPS, x.antiguedad[k], -1); }),
						() => changeRules(x => { x.antiguedad[k] = stepList(AGE_STEPS, x.antiguedad[k], 1); }))))),
				h('div', { class: 'preview' },
					h('b', { text: !ag.activa ? 'Alerta apagada' : hitsAg.length ? 'Con estos valores, hoy ' + (hitsAg.length === 1 ? 'aparece 1 ticket' : 'aparecen ' + hitsAg.length + ' tickets') : 'Con estos valores, hoy ningún ticket supera el límite' }),
					hitsAg.slice(0, 8).map(t => h('span', {}, h('strong', { class: 'mono t-accent', text: t.codigo }), h('strong', { class: t.prioridad === 'P1' ? 't-red' : 't-orange', text: t.prioridad }), h('span', { class: 't2', text: t.detalle }))))),
			h('section', { class: 'glass card', 'aria-labelledby': 'h-sg', style: 'gap:12px' },
				h('div', { style: 'display:flex;flex-direction:column' }, h('h2', { id: 'h-sg', class: 'card-title', text: 'Asignación sugerida' }),
					h('span', { class: 'hint t2', style: 'font-size:12px', text: 'Propone un operador del área del ticket con menor carga activa y sin sobrecarga. El coordinador confirma con un clic; no se asigna solo.' })),
				h('div', { class: 'rule-rows' },
					h('div', { class: 'rule-row' }, h('span', { style: 'flex:1', text: 'Sugerir solo a quien está en turno' }), h('span', { class: 't-green', style: 'font-weight:600', text: '✓ Siempre' })),
					h('div', { class: 'rule-row' + (sg.incluirGuardia ? '' : ' off'), style: 'flex-wrap:wrap' },
						h('span', { style: 'flex:1;min-width:260px', text: 'Incluir a quien está de guardia si su guardia empieza en menos de' }),
						stepper(fmtMin(sg.guardiaAntesMin), 'Minutos antes de la guardia',
							() => changeRules(x => { x.sugerencia.guardiaAntesMin = stepList(SOON_STEPS, x.sugerencia.guardiaAntesMin, -1); }),
							() => changeRules(x => { x.sugerencia.guardiaAntesMin = stepList(SOON_STEPS, x.sugerencia.guardiaAntesMin, 1); })),
						sw(sg.incluirGuardia, () => changeRules(x => { x.sugerencia.incluirGuardia = !x.sugerencia.incluirGuardia; }), 'Incluir a quien está por entrar de guardia')),
					h('div', { class: 'rule-row' }, h('span', { style: 'flex:1', text: 'Si nadie del área está disponible o todos tienen sobrecarga' }), h('span', { class: 't2', text: 'Cola de espera y aviso al coordinador' })),
					h('div', { class: 'rule-row' },
						h('span', { class: 'lbl', style: 'flex:1' }, h('span', { style: 'color:var(--t1);font-size:13px', text: 'Permitir sugerir otra área' }), h('span', { text: 'Solo cuando el coordinador lo pide desde el ticket' })),
						sw(sg.permitirOtraArea, () => changeRules(x => { x.sugerencia.permitirOtraArea = !x.sugerencia.permitirOtraArea; }), 'Permitir sugerir otra área')))),
			h('section', { class: 'glass card', 'aria-labelledby': 'h-pp', style: 'gap:12px' },
				h('div', { style: 'display:flex;flex-direction:column' }, h('h2', { id: 'h-pp', class: 'card-title', text: 'Prioridad sugerida de los correos' }),
					h('span', { class: 'hint t2', style: 'font-size:12px', text: 'Si el asunto, el texto o el remitente de un correo contiene una de estas palabras, el ticket llega con esa prioridad sugerida. Quien lo toma la confirma o la cambia. Separa con comas; sirve un dominio como @cliente.com. Gana la más alta.' })),
				h('div', { class: 'rule-rows' }, [['P1', 'P1 Crítica', 'var(--c-red)'], ['P2', 'P2 Media', 'var(--c-amber)'], ['P3', 'P3 Baja', 'var(--c-slate)']].map(([k, label, dot]) => {
					const lista = (r.palabrasPrioridad && r.palabrasPrioridad[k]) || [];
					const inp = h('input', { class: 'field sm', type: 'text', style: 'flex:1;min-width:220px', value: lista.join(', '), 'aria-label': 'Palabras clave ' + label, maxlength: 1200, placeholder: 'Ninguna' });
					inp.addEventListener('change', () => changeRules(x => {
						x.palabrasPrioridad = x.palabrasPrioridad || {};
						x.palabrasPrioridad[k] = inp.value.split(',').map(w => w.trim()).filter(Boolean).slice(0, L.palabras || 40);
					}));
					return h('div', { class: 'rule-row', style: 'flex-wrap:wrap' },
						h('i', { class: 'pdot', style: 'background:' + dot }),
						h('span', { class: 'lbl', style: 'min-width:90px' }, h('b', { text: label })),
						inp);
				}))),
			h('section', { class: 'glass card', 'aria-labelledby': 'h-me', style: 'gap:12px' },
				h('div', { style: 'display:flex;flex-direction:column' }, h('h2', { id: 'h-me', class: 'card-title', text: 'Metas de Reportes' }),
					h('span', { class: 'hint t2', style: 'font-size:12px', text: 'En Reportes se marca en ámbar lo que no cumple la meta' })),
				h('div', { class: 'rule-rows' },
					h('div', { class: 'rule-row' },
						h('span', { class: 'lbl', style: 'flex:1' }, h('span', { style: 'color:var(--t1);font-size:13px', text: 'Casos resueltos' }), h('span', { text: 'Resueltos ÷ recibidos en el periodo' })),
						h('span', { class: 't2', text: 'al menos' }),
						stepper(me.resueltoPct + ' %', 'Meta de resueltos',
							() => changeRules(x => { x.metas.resueltoPct = Math.max(L.resueltoPct[0], x.metas.resueltoPct - 1); }),
							() => changeRules(x => { x.metas.resueltoPct = Math.min(L.resueltoPct[1], x.metas.resueltoPct + 1); }))),
					h('div', { class: 'rule-row' },
						h('span', { class: 'lbl', style: 'flex:1' }, h('span', { style: 'color:var(--t1);font-size:13px', text: 'Tiempo promedio de resolución' }), h('span', { text: 'Desde la llegada del ticket' })),
						h('span', { class: 't2', text: 'hasta' }),
						stepper(dec(me.promedioHoras) + ' h', 'Meta de promedio',
							() => changeRules(x => { x.metas.promedioHoras = Math.max(L.promedioHoras[0], Math.round((x.metas.promedioHoras - 0.5) * 10) / 10); }),
							() => changeRules(x => { x.metas.promedioHoras = Math.min(L.promedioHoras[1], Math.round((x.metas.promedioHoras + 0.5) * 10) / 10); }))))));
	}

	// ---------- Avisos ----------
	function renderAvisos() {
		const box = $('[data-panel="avisos"]');
		box.replaceChildren(
			h('div', { class: 'card-head', style: 'padding:18px 24px 14px' },
				h('div', { style: 'display:flex;flex-direction:column;flex:1' }, h('h2', { text: 'Avisos' }), h('span', { class: 'hint', text: 'Avisos dentro del portal: qué eventos avisan y a quién' }))),
			h('div', { class: 'scroll-x' }, h('table', { class: 'rank-table' },
				h('thead', {}, h('tr', {}, h('th', { style: 'padding-left:24px', text: 'Evento' }), D.destinatarios.map((d, i) => h('th', { style: 'text-align:center;width:' + (i === 1 ? 150 : 120) + 'px', text: d })))),
				h('tbody', {}, D.eventos.map(ev => h('tr', { class: 'row' },
					h('td', { style: 'padding:12px 8px 12px 24px' }, h('span', { style: 'display:flex;flex-direction:column' }, h('b', { style: 'font-size:13px', text: ev.nombre }), h('span', { class: 't2', text: ev.desc }))),
					C.avisos[ev.clave].map((v, i) => h('td', { style: 'text-align:center' }, v === null
						? h('span', { class: 't3', text: '—' })
						: sw(v, () => { C.avisos[ev.clave][i] = !C.avisos[ev.clave][i]; renderAvisos(); paintDirty(); }, ev.nombre + ' · ' + D.destinatarios[i])))))))),
			h('span', { class: 't3', style: 'padding:12px 24px 16px;font-size:12px', text: 'Esta configuración se guarda ya; la entrega de los avisos dentro del portal llega en una próxima fase. Mientras tanto, las alertas se ven en el Dashboard y en Tickets.' }));
	}

	// ---------- Usuarios: agregar y editar ----------
	// Solo el gerente da (o quita) los roles Jefe y Gerente
	const ROLES = [['OPERADOR', 'Operador'], ['COORDINADOR', 'Coordinador'], ['JEFE', 'Jefe de área'], ['GERENTE', 'Gerente']];
	const ROLES_ALTOS = ['JEFE', 'GERENTE'];
	const esGerente = D.daRolesAltos === true || D.miRol === 'GERENTE'; // sin gerente activo, el coordinador nombra al primero
	function genClave() {
		const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
		const n = new Uint32Array(10);
		(window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(n) : n.forEach((_, i) => { n[i] = Math.floor(Math.random() * 1e9); });
		return Array.from(n, x => abc[x % abc.length]).join('');
	}
	function openUser(id, areaInicial) {
		const u = id ? D.usuarios.find(x => x.id === id) : null;
		const esYo = !!u && u.id === D.miId;
		const M = {
			nombre: u ? u.nombre : '', email: u ? u.email : '',
			rol: u ? u.rol : (areaInicial === '__coord' ? 'COORDINADOR' : 'OPERADOR'),
			area: u ? u.area : (areaInicial && areaInicial !== '__coord' ? areaInicial : 'GENERAL'),
			clave: u ? '' : genClave(),
			activo: u ? u.activo !== false : true,
			atiende: u ? u.atiende === true : false,
			telefono: u ? u.telefono || '' : '',
			subgrupo: u ? u.subgrupo || '' : ''
		};
		const bloqueado = !!u && !esGerente && ROLES_ALTOS.includes(u.rol);
		const ov = h('div', { class: 'overlay', onclick: e => { if (e.target === ov) ov.remove(); } });
		const box = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', style: 'width:520px' });
		ov.append(box);
		const err = h('div', { class: 'warnbox', hidden: true });
		const ok = h('button', { type: 'button', class: 'primary', text: u ? 'Guardar' : 'Crear usuario' });
		if (bloqueado) ok.disabled = true;
		const input = (key, attrs) => h('input', Object.assign({ class: 'field', value: M[key], oninput: e => { M[key] = e.target.value; } }, attrs));
		const claveIn = input('clave', { type: 'text', autocomplete: 'off', placeholder: u ? 'Déjala vacía para no cambiarla' : '', 'aria-label': 'Clave temporal', style: 'flex:1' });
		const rolSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Rol' });
		// Subgrupo dentro del área (solo si el área tiene subgrupos)
		const sgSel = h('select', { class: 'field', 'aria-label': 'Subgrupo', onchange: e => { M.subgrupo = e.target.value; } });
		const sgRow = h('label', { class: 'dsec' }, h('b', { text: 'Subgrupo' }), sgSel);
		const paintSg = () => {
			const area = D.areas.find(x => x.codigo === M.area);
			const lista = ((area && area.subgrupos) || []).filter(g => g.activo || g.id === M.subgrupo);
			sgSel.replaceChildren(h('option', { value: '', selected: !M.subgrupo, text: 'Sin subgrupo (ve todo el área)' }),
				...lista.map(g => h('option', { value: g.id, selected: g.id === M.subgrupo, text: g.nombre + (g.activo ? '' : ' (desactivado)') })));
			sgRow.hidden = areaRow.hidden || !lista.length;
		};
		const areaSel = h('select', { class: 'field', 'aria-label': 'Área', onchange: e => { M.area = e.target.value; M.subgrupo = ''; paintSg(); } },
			D.areas.filter(a => a.activa || a.codigo === M.area).map(a => h('option', { value: a.codigo, selected: a.codigo === M.area, text: a.nombre + (a.activa ? '' : ' (desactivada)') })));
		const areaRow = h('label', { class: 'dsec' }, h('b', { text: 'Área' }), areaSel);
		// Coordinador que además toma y trabaja tickets: tiene Mi panel y entra en la carga
		const atiendeSw = sw(M.atiende, e => { M.atiende = !M.atiende; e.currentTarget.setAttribute('aria-checked', String(M.atiende)); paintRol(); }, 'También atiende tickets');
		const atiendeRow = h('div', { class: 'rule-row', style: 'min-height:40px;border:0' },
			h('span', { class: 'lbl', style: 'flex:1' }, h('b', { text: 'También atiende tickets' }), h('span', { text: 'Puede tomarlos y trabajarlos en Mi panel; cuenta en la carga, los turnos y los reportes como un operador' })), atiendeSw);
		const paintRol = () => {
			rolSeg.replaceChildren(...ROLES.filter(([v]) => esGerente || !ROLES_ALTOS.includes(v) || M.rol === v).map(([v, l]) => h('button', {
				type: 'button', role: 'radio', 'aria-checked': String(M.rol === v), disabled: (esYo || bloqueado) && M.rol !== v,
				onclick: () => { M.rol = v; paintRol(); }
			}, h('span', { text: l }))));
			atiendeRow.hidden = M.rol !== 'COORDINADOR' && M.rol !== 'JEFE';
			areaRow.hidden = M.rol === 'GERENTE' || (M.rol === 'COORDINADOR' && !M.atiende);
			paintSg();
		};
		paintRol();
		box.append(
			h('div', { class: 'dlg-head' }, h('h2', { text: u ? 'Editar ' + u.nombre : (M.rol === 'OPERADOR' ? 'Nuevo operador' : 'Nueva persona en coordinación') }),
				h('span', { text: u ? u.email : 'Podrá entrar al portal con su correo y la clave temporal' })),
			h('div', { class: 'dlg-body', style: 'gap:14px' },
				h('label', { class: 'dsec' }, h('b', { text: 'Nombre y apellido' }), input('nombre', { maxlength: 80, placeholder: 'Ej. Ana Pérez' })),
				h('label', { class: 'dsec' }, h('b', { text: 'Correo' }), input('email', { type: 'email', maxlength: 120, placeholder: 'nombre@inter.com' })),
				h('div', { class: 'dsec' }, h('b', { text: 'Rol' }), rolSeg, esYo ? h('span', { class: 't3', style: 'font-size:12px', text: 'No puedes cambiar tu propio rol' }) : null),
				atiendeRow,
				areaRow,
				sgRow,
				h('label', { class: 'dsec' }, h('b', { text: 'Teléfono o extensión (opcional)' }), input('telefono', { type: 'tel', maxlength: 40, placeholder: 'Ej. 0212-555 1234 ext 12' }),
					h('span', { class: 't3', style: 'font-size:12px', text: 'Sale en Contactos para que el equipo sepa cómo ubicarlo' })),
				bloqueado ? h('div', { class: 'warnbox', text: 'Solo el gerente puede editar a jefes y gerentes.' }) : null,
				u && !esYo ? h('div', { class: 'rule-row', style: 'min-height:40px;border:0' }, h('span', { class: 'lbl', style: 'flex:1' }, h('b', { text: 'Usuario activo' }), h('span', { text: 'Desactivado no entra al portal ni recibe tickets; sus tickets activos vuelven a la cola de su área y su historial se conserva' })), sw(M.activo, e => { M.activo = !M.activo; e.currentTarget.setAttribute('aria-checked', String(M.activo)); }, 'Usuario activo')) : null,
				h('div', { class: 'dsec' }, h('b', { text: u ? 'Nueva clave temporal (opcional)' : 'Clave temporal' }),
					h('div', { style: 'display:flex;gap:8px' }, claveIn,
						h('button', { type: 'button', class: 'pill pillbtn plain', style: 'height:34px;font-size:12px', text: 'Generar', onclick: () => { M.clave = genClave(); claveIn.value = M.clave; } }))),
				h('div', { class: 'warnbox', text: 'Comparte la clave en persona. Por ahora se guarda sin cifrar: usa una clave temporal, no una personal. Se cifrará al activar la seguridad del login.' }),
				err),
			h('div', { class: 'dlg-foot' }, h('span', { class: 'note', text: 'El cambio queda en Auditoría' }), h('span', { class: 'grow' }),
				h('button', { type: 'button', class: 'pill pillbtn plain', text: 'Cancelar', onclick: () => ov.remove() }), ok));
		ok.addEventListener('click', async () => {
			const sinArea = M.rol === 'GERENTE' || (M.rol === 'COORDINADOR' && !M.atiende);
			const puedeAtender = M.rol === 'COORDINADOR' || M.rol === 'JEFE';
			const body = { nombre: M.nombre, email: M.email, rol: M.rol, area: sinArea ? 'GENERAL' : M.area, atiende: puedeAtender && M.atiende, telefono: M.telefono.trim(), subgrupo: sgRow.hidden ? '' : M.subgrupo };
			if (M.clave) body.clave = M.clave;
			if (u) { body.activo = M.activo; Object.keys(body).forEach(k => { if (k !== 'clave' && body[k] === (k === 'activo' ? u.activo !== false : k === 'atiende' ? u.atiende === true : k === 'telefono' ? (u.telefono || '') : k === 'subgrupo' ? (u.subgrupo || '') : u[k])) delete body[k]; }); }
			if (u && !Object.keys(body).length) { ov.remove(); return; }
			ok.disabled = true;
			try {
				const res = await fetch(u ? '/api/admin/usuarios/' + encodeURIComponent(u.id) : '/api/admin/usuarios', {
					method: u ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
				});
				let j = {};
				try { j = await res.json(); } catch (e) { /* sin cuerpo */ }
				if (!res.ok || !j.success) throw new Error(j.error || 'Error ' + res.status);
				const dev = (j.devueltos || []).length;
				const msg = u ? (dev ? (dev === 1 ? '1 ticket activo volvió' : dev + ' tickets activos volvieron') + ' a la cola de su área. ' : '') + 'Los cambios quedaron en Auditoría' : (M.clave ? 'Clave temporal: ' + M.clave : '');
				try { sessionStorage.setItem('kip.toast', JSON.stringify({ title: u ? 'Usuario actualizado' : 'Usuario creado', msg })); } catch (e) { /* nada */ }
				leaving = true;
				window.location.reload();
			} catch (e) {
				ok.disabled = false;
				err.textContent = e.message;
				err.hidden = false;
			}
		});
		document.body.append(ov);
		setTimeout(() => box.querySelector('input').focus(), 30);
	}

	// ---------- Áreas: crear, renombrar y activar/desactivar ----------
	function openArea(codigo, { subgrupo = false } = {}) {
		const a = codigo ? D.areas.find(x => x.codigo === codigo) : null;
		const M = { nombre: a ? a.nombre : '', activa: a ? a.activa : true };
		const ov = h('div', { class: 'overlay', onclick: e => { if (e.target === ov) ov.remove(); } });
		const box = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', style: 'width:460px' });
		ov.append(box);
		const err = h('div', { class: 'warnbox', hidden: true });
		const ok = h('button', { type: 'button', class: 'primary', text: a ? 'Guardar' : 'Crear área' });
		const nombre = h('input', { class: 'field', value: M.nombre, maxlength: 60, placeholder: 'Ej. Centro de Datos', oninput: e => { M.nombre = e.target.value; } });
		// Subgrupos del área (p. ej. FTTx: Soporte y Cabecera): renombrar, activar/desactivar y agregar
		const SG = a ? (a.subgrupos || []).map(g => ({ id: g.id, nombre: g.nombre, activo: g.activo, antes: g })) : [];
		const nuevoSg = { nombre: '' };
		const nuevoIn = h('input', { class: 'field', maxlength: 60, placeholder: 'Nuevo subgrupo, ej. Soporte', 'aria-label': 'Nuevo subgrupo', oninput: e => { nuevoSg.nombre = e.target.value; } });
		const sgBox = a && a.codigo !== 'GENERAL' ? h('div', { class: 'dsec' }, h('b', { text: 'Subgrupos (opcional)' }),
			h('span', { class: 't3', style: 'font-size:12px', text: 'Equipos dentro del área. Cada persona y cada ticket puede tener uno; el operador ve los de su subgrupo y los del área sin subgrupo.' }),
			SG.map(g => h('div', { style: 'display:flex;align-items:center;gap:10px' },
				h('input', { class: 'field', value: g.nombre, maxlength: 60, 'aria-label': 'Nombre del subgrupo', style: 'flex:1', oninput: e => { g.nombre = e.target.value; } }),
				sw(g.activo, e => { g.activo = !g.activo; e.currentTarget.setAttribute('aria-checked', String(g.activo)); }, 'Subgrupo activo: ' + g.nombre))),
			nuevoIn) : null;
		const send = async (method, url, body) => {
			const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
			let j = {};
			try { j = await res.json(); } catch (e) { /* sin cuerpo */ }
			if (!res.ok || !j.success) throw new Error(j.error || 'Error ' + res.status);
			return j;
		};
		box.append(
			h('div', { class: 'dlg-head' }, h('h2', { text: a ? 'Editar área' : 'Nueva área' }), h('span', { text: a ? 'Código ' + a.codigo + ' · ' + a.operadores + ' operadores' : 'Aparecerá en tickets, turnos, reportes y en la ventana de asignar' })),
			h('div', { class: 'dlg-body', style: 'gap:14px' },
				h('label', { class: 'dsec' }, h('b', { text: 'Nombre' }), nombre),
				a && a.codigo !== 'GENERAL' ? h('div', { class: 'rule-row', style: 'min-height:40px;border:0' },
					h('span', { class: 'lbl', style: 'flex:1' }, h('b', { text: 'Área activa' }), h('span', { text: 'Desactivada no aparece para elegir; su historial se conserva. Debe quedar sin operadores ni tickets activos.' })),
					sw(M.activa, e => { M.activa = !M.activa; e.currentTarget.setAttribute('aria-checked', String(M.activa)); }, 'Área activa')) : null,
				sgBox,
				err),
			h('div', { class: 'dlg-foot' }, h('span', { class: 'note', text: 'El cambio queda en Auditoría' }), h('span', { class: 'grow' }),
				h('button', { type: 'button', class: 'pill pillbtn plain', text: 'Cancelar', onclick: () => ov.remove() }), ok));
		ok.addEventListener('click', async () => {
			const body = {};
			if (!a || M.nombre.trim() !== a.nombre) body.nombre = M.nombre;
			if (a && M.activa !== a.activa) body.activa = M.activa;
			const sgCambios = SG.map(g => {
				const c = {};
				if (g.nombre.trim() !== g.antes.nombre) c.nombre = g.nombre;
				if (g.activo !== g.antes.activo) c.activo = g.activo;
				return [g.id, c];
			}).filter(([, c]) => Object.keys(c).length);
			if (a && !Object.keys(body).length && !sgCambios.length && !nuevoSg.nombre.trim()) { ov.remove(); return; }
			ok.disabled = true;
			try {
				let j = {};
				if (!a || Object.keys(body).length) j = await send(a ? 'PATCH' : 'POST', a ? '/api/admin/areas/' + encodeURIComponent(a.codigo) : '/api/admin/areas', body);
				for (const [id, c] of sgCambios) await send('PATCH', '/api/admin/subgrupos/' + encodeURIComponent(id), c);
				if (a && nuevoSg.nombre.trim()) await send('POST', '/api/admin/areas/' + encodeURIComponent(a.codigo) + '/subgrupos', { nombre: nuevoSg.nombre });
				try { sessionStorage.setItem('kip.toast', JSON.stringify({ title: a ? 'Área actualizada' : 'Área creada', msg: (j.area && j.area.nombre) || (a && a.nombre) || '' })); } catch (e) { /* nada */ }
				leaving = true;
				window.location.reload();
			} catch (e) {
				ok.disabled = false;
				err.textContent = e.message;
				err.hidden = false;
			}
		});
		document.body.append(ov);
		setTimeout(() => (subgrupo && sgBox ? nuevoIn : nombre).focus(), 30);
	}

	// ---------- Secciones ----------
	function showSection(key) {
		$$('[data-sec]').forEach(b => b.setAttribute('aria-current', b.dataset.sec === key ? 'page' : 'false'));
		$$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== key; });
		try { history.replaceState(null, '', '#' + key); } catch (e) { /* nada */ }
	}

	async function save() {
		const btn = $('[data-save]');
		btn.disabled = true;
		try {
			const res = await fetch('/api/admin/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(C) });
			let j = {};
			try { j = await res.json(); } catch (e) { /* sin cuerpo */ }
			if (!res.ok || !j.success) throw new Error(j.error || 'Error ' + res.status);
			try { sessionStorage.setItem('kip.toast', JSON.stringify({ title: 'Cambios guardados', msg: 'La configuración se aplicó y quedó en Auditoría' })); } catch (e) { /* nada */ }
			leaving = true;
			window.location.reload();
		} catch (e) {
			btn.disabled = false;
			toast('No se pudo guardar', e.message, false);
		}
	}

	document.addEventListener('DOMContentLoaded', () => {
		$$('[data-sec]').forEach(b => b.addEventListener('click', () => showSection(b.dataset.sec)));
		$$('[data-area-pick]').forEach(b => b.addEventListener('click', () => {
			$$('[data-area-pick]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
			$$('[data-area-panel]').forEach(p => { p.hidden = p.dataset.areaPanel !== b.dataset.areaPick; });
		}));
		$('[data-discard]').addEventListener('click', () => { leaving = true; window.location.reload(); });
		$$('[data-user-new]').forEach(b => b.addEventListener('click', () => openUser(null, b.dataset.userNew)));
		$$('[data-user-edit]').forEach(b => b.addEventListener('click', () => openUser(b.dataset.userEdit)));
		$$('[data-area-edit]').forEach(b => b.addEventListener('click', () => openArea(b.dataset.areaEdit, { subgrupo: b.hasAttribute('data-focus-subgrupo') })));
		const nueva = $('[data-area-new]');
		if (nueva) nueva.addEventListener('click', () => openArea(null));
		document.addEventListener('keydown', e => { if (e.key === 'Escape') { const o = document.querySelector('.overlay'); if (o) o.remove(); } });
		$('[data-save]').addEventListener('click', save);
		window.addEventListener('beforeunload', e => { if (!leaving && paintDirty()) { e.preventDefault(); e.returnValue = ''; } });
		renderPlantillas();
		renderReglas();
		renderAvisos();
		const hash = window.location.hash.slice(1);
		if (['areas', 'plantillas', 'reglas', 'avisos'].includes(hash)) showSection(hash);
		paintDirty();
		try {
			const t = JSON.parse(sessionStorage.getItem('kip.toast') || 'null');
			sessionStorage.removeItem('kip.toast');
			if (t) toast(t.title, t.msg, true);
		} catch (e) { /* sin aviso */ }
	});
})();
