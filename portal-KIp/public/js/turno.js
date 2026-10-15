// Gestión de Turno: cambios sin guardar (horario, días y guardia por día), filtro por estado y guardado.
(function () {
	'use strict';

	let D;
	try { D = JSON.parse(document.getElementById('turno-data').textContent); } catch (e) { return; }
	const ORIG = {};
	D.operadores.forEach(o => { ORIG[o.id] = o; });

	const $ = s => document.querySelector(s);
	const $$ = s => Array.from(document.querySelectorAll(s));
	let leaving = false; // ya se confirmó salir: no volver a preguntar
	const sameDays = (a, b) => a.length === b.length && a.every((d, i) => d === b[i]);

	// Estado actual de una fila (lo que se ve en pantalla)
	function rowState(row) {
		return {
			inicio: row.querySelector('[data-from]').value,
			fin: row.querySelector('[data-to]').value,
			dias: Array.from(row.querySelectorAll('[data-day][aria-pressed=true]')).map(b => Number(b.dataset.day)).sort((a, b) => a - b),
			guardia: Array.from(row.querySelectorAll('[data-gdate][aria-pressed=true]')).map(b => b.dataset.gdate).sort()
		};
	}

	function changes() {
		const horarios = [];
		let guardia = false;
		$$('[data-op]').forEach(row => {
			const o = ORIG[row.dataset.op];
			const s = rowState(row);
			const h = o.horario;
			if (s.inicio !== h.inicio || s.fin !== h.fin || !sameDays(s.dias, [...h.dias].sort((a, b) => a - b))) {
				horarios.push({ id: o.id, nombre: o.nombre, dias: s.dias, inicio: s.inicio, fin: s.fin });
			}
			const otraGuardia = !sameDays(s.guardia, [...o.guardiaDias].sort());
			if (otraGuardia) guardia = true;
			row.classList.toggle('changed', horarios.some(x => x.id === o.id) || otraGuardia);
		});
		return { horarios, guardia };
	}

	// Actualización en vivo (vivo.js): no recargar con cambios sin guardar
	window.kipOcupado = () => paintDirty() > 0;
	function paintDirty() {
		const c = changes();
		const n = c.horarios.length + (c.guardia ? 1 : 0);
		$('[data-dirty]').hidden = n === 0;
		$('[data-discard]').hidden = n === 0;
		$('[data-save]').hidden = n === 0;
		$('[data-dirty-label]').textContent = n + (n === 1 ? ' cambio sin guardar' : ' cambios sin guardar');
		return n;
	}

	function toast(title, msg, ok) {
		const old = document.querySelector('.toast');
		if (old) old.remove();
		const n = document.createElement('div');
		n.className = 'notif toast';
		n.setAttribute('role', 'status');
		const ic = document.createElement('span');
		ic.className = 'ti';
		ic.style.background = ok ? 'var(--c-green)' : 'var(--c-red)';
		ic.insertAdjacentHTML('afterbegin', '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (ok ? 'M5 12l5 5L19 7' : 'M12 8v5M12 16.5v.5') + '"/></svg>');
		const tx = document.createElement('div');
		tx.className = 'tx';
		const b = document.createElement('b'); b.textContent = title;
		const s = document.createElement('span'); s.textContent = msg;
		tx.append(b, s);
		n.append(ic, tx);
		document.body.append(n);
		setTimeout(() => n.remove(), 4200);
	}

	async function put(url, body) {
		const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
		let json = {};
		try { json = await res.json(); } catch (e) { /* sin cuerpo */ }
		if (!res.ok) throw new Error(json.error || 'Error ' + res.status);
		return json;
	}

	async function save() {
		const c = changes();
		const btn = $('[data-save]');
		// Validación local: al menos un día y entrada antes que salida
		const malo = c.horarios.find(h => !h.dias.length || !h.inicio || !h.fin || h.inicio >= h.fin);
		if (malo) { toast('Revisa el horario', malo.nombre + ': elige al menos un día y una entrada anterior a la salida', false); return; }
		btn.disabled = true;
		try {
			for (const h of c.horarios) {
				await put('/api/turnos/horario/' + encodeURIComponent(h.id), { dias: h.dias, inicio: h.inicio, fin: h.fin });
			}
			if (c.guardia) {
				await put('/api/turnos/guardia', { semana: D.semana, dias: guardPlan() });
			}
			try {
				const n = c.horarios.length + (c.guardia ? 1 : 0);
				sessionStorage.setItem('kip.toast', JSON.stringify({ title: 'Cambios guardados', msg: n + (n === 1 ? ' cambio queda' : ' cambios quedan') + ' en Auditoría' }));
			} catch (e) { /* solo se pierde el aviso */ }
			window.location.reload();
		} catch (e) {
			btn.disabled = false;
			toast('No se pudo guardar', e.message, false);
		}
	}

	function setView(view) {
		$$('[data-view]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.view === view)));
		let visibles = 0;
		$$('[data-area-box]').forEach(box => {
			let n = 0;
			box.querySelectorAll('[data-op]').forEach(row => {
				const show = view === 'todos' || row.dataset.state === view;
				row.hidden = !show;
				if (show) n++;
			});
			box.hidden = n === 0;
			visibles += n;
		});
		const empty = $('[data-empty-view]');
		if (empty) empty.hidden = visibles > 0;
	}

	// { 'AAAA-MM-DD': [ids] } según los botones de guardia marcados
	function guardPlan() {
		const plan = {};
		D.fechas.forEach(f => { plan[f] = []; });
		$$('[data-op]').forEach(row => rowState(row).guardia.forEach(f => { if (plan[f]) plan[f].push(row.dataset.op); }));
		return plan;
	}

	// Tira de la semana: quién queda de guardia cada día (con lo que se ve en pantalla)
	function syncGuardStrip() {
		const plan = guardPlan();
		let sin = 0;
		D.fechas.forEach(f => {
			const box = document.querySelector('[data-wday-guards="' + f + '"]');
			if (!box) return;
			box.replaceChildren();
			plan[f].forEach(id => {
				const o = ORIG[id];
				const i = document.createElement('i');
				i.title = o.nombre;
				i.textContent = o.iniciales;
				box.append(i);
			});
			if (!plan[f].length) {
				sin++;
				const em = document.createElement('em');
				em.textContent = 'Sin guardia';
				box.append(em);
			}
		});
		const sum = $('[data-guard-summary]');
		if (sum) sum.textContent = sin ? sin + (sin === 1 ? ' día' : ' días') + ' sin guardia' : 'Todos los días tienen guardia';
	}

	document.addEventListener('DOMContentLoaded', () => {
		$$('[data-op]').forEach(row => {
			row.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => {
				b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
				paintDirty();
			}));
			row.querySelectorAll('input[type=time]').forEach(i => i.addEventListener('input', paintDirty));
			row.querySelectorAll('[data-gdate]').forEach(b => b.addEventListener('click', () => {
				b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
				syncGuardStrip();
				paintDirty();
			}));
		});
		$$('[data-view]').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));
		$('[data-discard]').addEventListener('click', () => { leaving = true; window.location.reload(); });
		$('[data-save]').addEventListener('click', save);
		// Cambiar de semana con cambios sin guardar pide confirmación
		$$('[data-week-link]').forEach(a => a.addEventListener('click', e => {
			if (paintDirty() > 0 && !window.confirm('Tienes cambios sin guardar. ¿Descartarlos y cambiar de semana?')) e.preventDefault();
			else leaving = true;
		}));
		window.addEventListener('beforeunload', e => { if (!leaving && paintDirty() > 0 && !$('[data-save]').disabled) { e.preventDefault(); e.returnValue = ''; } });
		paintDirty();
		try {
			const t = JSON.parse(sessionStorage.getItem('kip.toast') || 'null');
			sessionStorage.removeItem('kip.toast');
			if (t) toast(t.title, t.msg, true);
		} catch (e) { /* sin aviso */ }
	});
})();
