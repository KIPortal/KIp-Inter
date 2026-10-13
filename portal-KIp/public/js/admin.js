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
		const ov = r.sobrecarga, ag = r.antiguedad, sg = r.sugerencia;
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
						sw(sg.permitirOtraArea, () => changeRules(x => { x.sugerencia.permitirOtraArea = !x.sugerencia.permitirOtraArea; }), 'Permitir sugerir otra área')))));
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
	const ROLES = [['OPERADOR', 'Operador'], ['COORDINADOR', 'Coordinador']];
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
			clave: u ? '' : genClave()
		};
		const ov = h('div', { class: 'overlay', onclick: e => { if (e.target === ov) ov.remove(); } });
		const box = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', style: 'width:520px' });
		ov.append(box);
		const err = h('div', { class: 'warnbox', hidden: true });
		const ok = h('button', { type: 'button', class: 'primary', text: u ? 'Guardar' : 'Crear usuario' });
		const input = (key, attrs) => h('input', Object.assign({ class: 'field', value: M[key], oninput: e => { M[key] = e.target.value; } }, attrs));
		const claveIn = input('clave', { type: 'text', autocomplete: 'off', placeholder: u ? 'Déjala vacía para no cambiarla' : '', 'aria-label': 'Clave temporal', style: 'flex:1' });
		const rolSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Rol' });
		const areaSel = h('select', { class: 'field', 'aria-label': 'Área', onchange: e => { M.area = e.target.value; } },
			D.areas.map(a => h('option', { value: a.codigo, selected: a.codigo === M.area, text: a.nombre })));
		const areaRow = h('label', { class: 'dsec' }, h('b', { text: 'Área' }), areaSel);
		const paintRol = () => {
			rolSeg.replaceChildren(...ROLES.map(([v, l]) => h('button', {
				type: 'button', role: 'radio', 'aria-checked': String(M.rol === v), disabled: esYo && M.rol !== v,
				onclick: () => { M.rol = v; paintRol(); }
			}, h('span', { text: l }))));
			areaRow.hidden = M.rol === 'COORDINADOR';
		};
		paintRol();
		box.append(
			h('div', { class: 'dlg-head' }, h('h2', { text: u ? 'Editar ' + u.nombre : (M.rol === 'COORDINADOR' ? 'Nuevo coordinador' : 'Nuevo operador') }),
				h('span', { text: u ? u.email : 'Podrá entrar al portal con su correo y la clave temporal' })),
			h('div', { class: 'dlg-body', style: 'gap:14px' },
				h('label', { class: 'dsec' }, h('b', { text: 'Nombre y apellido' }), input('nombre', { maxlength: 80, placeholder: 'Ej. Ana Pérez' })),
				h('label', { class: 'dsec' }, h('b', { text: 'Correo' }), input('email', { type: 'email', maxlength: 120, placeholder: 'nombre@inter.com' })),
				h('div', { class: 'dsec' }, h('b', { text: 'Rol' }), rolSeg, esYo ? h('span', { class: 't3', style: 'font-size:12px', text: 'No puedes cambiar tu propio rol' }) : null),
				areaRow,
				h('div', { class: 'dsec' }, h('b', { text: u ? 'Nueva clave temporal (opcional)' : 'Clave temporal' }),
					h('div', { style: 'display:flex;gap:8px' }, claveIn,
						h('button', { type: 'button', class: 'pill pillbtn plain', style: 'height:34px;font-size:12px', text: 'Generar', onclick: () => { M.clave = genClave(); claveIn.value = M.clave; } }))),
				h('div', { class: 'warnbox', text: 'Comparte la clave en persona. Por ahora se guarda sin cifrar: usa una clave temporal, no una personal. Se cifrará al activar la seguridad del login.' }),
				err),
			h('div', { class: 'dlg-foot' }, h('span', { class: 'note', text: 'El cambio queda en Auditoría' }), h('span', { class: 'grow' }),
				h('button', { type: 'button', class: 'pill pillbtn plain', text: 'Cancelar', onclick: () => ov.remove() }), ok));
		ok.addEventListener('click', async () => {
			const body = { nombre: M.nombre, email: M.email, rol: M.rol, area: M.rol === 'COORDINADOR' ? 'GENERAL' : M.area };
			if (M.clave) body.clave = M.clave;
			if (u) Object.keys(body).forEach(k => { if (k !== 'clave' && body[k] === u[k]) delete body[k]; });
			if (u && !Object.keys(body).length) { ov.remove(); return; }
			ok.disabled = true;
			try {
				const res = await fetch(u ? '/api/admin/usuarios/' + encodeURIComponent(u.id) : '/api/admin/usuarios', {
					method: u ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
				});
				let j = {};
				try { j = await res.json(); } catch (e) { /* sin cuerpo */ }
				if (!res.ok || !j.success) throw new Error(j.error || 'Error ' + res.status);
				const msg = u ? 'Los cambios quedaron en Auditoría' : (M.clave ? 'Clave temporal: ' + M.clave : '');
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
