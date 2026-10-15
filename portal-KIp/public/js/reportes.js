// Reportes: secciones (Resumen / Por área / Por operador), filtro por área, orden y fecha específica.
(function () {
	'use strict';
	const $ = s => document.querySelector(s);
	const $$ = s => Array.from(document.querySelectorAll(s));
	const S = { tab: 'resumen', area: '', sort: 'puntos' };

	function showTab(tab) {
		S.tab = tab;
		$$('[data-tab]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
		$$('[data-section]').forEach(s => { s.hidden = s.dataset.section !== tab; });
		try { history.replaceState(null, '', location.pathname + location.search + '#' + tab + (S.area && tab === 'op' ? ':' + S.area : '')); } catch (e) { /* nada */ }
		if (tab === 'op') paintOps();
	}

	function paintOps() {
		const body = $('[data-op-rows]');
		if (!body) return;
		const rows = $$('[data-op]');
		const num = (r, k) => Number(r.dataset[k]) || 0;
		rows.sort((a, b) => (num(b, S.sort) - num(a, S.sort)) || (num(b, 'puntos') - num(a, 'puntos')));
		let pos = 0;
		rows.forEach(r => {
			const show = !S.area || r.dataset.area === S.area;
			r.hidden = !show;
			if (show) r.querySelector('[data-pos]').textContent = String(++pos);
			body.append(r);
		});
		const chip = $('[data-op-clear]');
		const nombre = S.area ? (($(`[data-area-open="${S.area}"] b`) || $(`[data-area-open="${S.area}"] td`) || {}).textContent || S.area) : '';
		chip.hidden = !S.area;
		$('[data-op-area]').textContent = nombre;
		$('[data-op-summary]').textContent = pos + (pos === 1 ? ' operador' : ' operadores') + (S.area ? ' de ' + nombre : '');
		$$('[data-sort]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.sort === S.sort)));
	}

	// Registro de jornadas: guarda la foto y el Excel del día (o de los días que faltan)
	async function cerrar(fecha, reemplazar) {
		const res = await fetch('/reportes/jornadas/cerrar', {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
			body: JSON.stringify({ fecha, reemplazar })
		});
		const data = await res.json().catch(() => ({}));
		if (res.status === 409 && data.existe) {
			if (!confirm(data.error)) return false;
			return cerrar(fecha, true);
		}
		if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar la jornada');
		return true;
	}

	function initRegistro() {
		const bar = $('[data-registro]');
		if (!bar) return;
		const msg = $('[data-registro-msg]');
		const run = async (btn, fechas, reemplazar) => {
			btn.disabled = true;
			msg.textContent = 'Guardando…';
			try {
				let hechos = 0;
				for (const f of fechas) { if (await cerrar(f, reemplazar)) hechos++; }
				msg.textContent = hechos ? 'Jornada guardada.' : '';
				if (hechos) location.reload();
			} catch (e) {
				msg.textContent = e.message;
			} finally {
				btn.disabled = false;
			}
		};
		const uno = $('[data-cerrar-jornada]');
		if (uno) uno.addEventListener('click', () => {
			const ya = bar.dataset.guardado === 'true';
			if (ya && !confirm('Se reemplazará el registro guardado de este día con los datos de ahora. ¿Continuar?')) return;
			run(uno, [bar.dataset.dia], ya);
		});
		const varios = $('[data-registrar-faltan]');
		if (varios) varios.addEventListener('click', () => {
			const fechas = bar.dataset.faltan.split(',').filter(Boolean);
			if (!confirm(`Se guardarán ${fechas.length} días con los datos de ahora (los tickets activos serán los actuales, no los de ese cierre). ¿Continuar?`)) return;
			run(varios, fechas, false);
		});
	}

	document.addEventListener('DOMContentLoaded', () => {
		initRegistro();
		$$('[data-tab]').forEach(t => t.addEventListener('click', () => { if (t.dataset.tab !== 'op') S.area = ''; showTab(t.dataset.tab); }));
		$$('[data-area-open]').forEach(el => {
			const go = () => { S.area = el.dataset.areaOpen; showTab('op'); };
			el.addEventListener('click', go);
			el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
		});
		$$('[data-sort]').forEach(t => t.addEventListener('click', () => { S.sort = t.dataset.sort; paintOps(); }));
		const clear = $('[data-op-clear]');
		if (clear) clear.addEventListener('click', () => { S.area = ''; showTab('op'); });
		const fecha = $('[data-fecha]');
		if (fecha) fecha.addEventListener('change', () => { if (fecha.value) fecha.form.submit(); });
		const [tab, area] = decodeURIComponent(location.hash.slice(1)).split(':');
		if (['resumen', 'area', 'op'].includes(tab)) { S.area = area || ''; showTab(tab); } else paintOps();
	});
})();
