// Dashboard General: desplegar áreas, ordenar operadores y gráfica de flujo por hora.
(function () {
	const NS = 'http://www.w3.org/2000/svg';
	const J0 = 8;
	const J1 = 17;
	const pad = n => String(n).padStart(2, '0');

	function el(tag, attrs, parent) {
		const node = document.createElementNS(NS, tag);
		Object.keys(attrs || {}).forEach(k => {
			const v = String(attrs[k]);
			// Los tokens CSS (var(--…)) solo funcionan como estilo, no como atributo SVG
			if (v.startsWith('var(')) node.style.setProperty(k, v);
			else node.setAttribute(k, v);
		});
		if (parent) parent.appendChild(node);
		return node;
	}

	function html(tag, className, parent, text) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		if (parent) parent.appendChild(node);
		return node;
	}

	// Curva suave (Catmull-Rom → Bézier), igual que el prototipo
	function smooth(pts) {
		if (!pts.length) return '';
		let d = 'M' + pts[0][0] + ' ' + pts[0][1];
		for (let i = 0; i < pts.length - 1; i++) {
			const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
			const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
			const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
			d += ' C' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ' ' + p2[0] + ' ' + p2[1];
		}
		return d;
	}

	// ----- Áreas: un clic despliega sus operadores (sincroniza ambas tarjetas)
	function initAreas() {
		const toggles = document.querySelectorAll('[data-area]');
		toggles.forEach(btn => {
			btn.addEventListener('click', () => {
				const area = btn.getAttribute('data-area');
				const abrir = btn.getAttribute('aria-pressed') !== 'true';
				toggles.forEach(b => b.setAttribute('aria-pressed', String(abrir && b.getAttribute('data-area') === area)));
				document.querySelectorAll('[data-ops]').forEach(p => { p.hidden = !(abrir && p.getAttribute('data-ops') === area); });
				const panel = document.getElementById('ops-' + area);
				if (abrir && panel && btn.classList.contains('res-row')) {
					panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
				}
			});
		});

		document.querySelectorAll('[data-ops]').forEach(panel => {
			const tabs = panel.querySelectorAll('[data-sort]');
			tabs.forEach(tab => {
				tab.addEventListener('click', () => {
					const by = tab.getAttribute('data-sort');
					tabs.forEach(t => t.setAttribute('aria-selected', String(t === tab)));
					const list = panel.querySelector('[data-op-list]');
					if (!list) return;
					const rows = Array.from(list.querySelectorAll('.op-row'));
					const num = (r, k) => Number(r.getAttribute('data-' + k)) || 0;
					rows.sort((a, b) => by === 'carga'
						? (num(b, 'carga') - num(a, 'carga')) || (num(b, 'resueltos') - num(a, 'resueltos'))
						: (num(b, 'resueltos') - num(a, 'resueltos')) || (num(b, 'carga') - num(a, 'carga')));
					rows.forEach((r, i) => {
						const pos = r.querySelector('[data-pos]');
						if (pos) pos.textContent = String(i + 1);
						list.appendChild(r);
					});
				});
			});
		});
	}

	// ----- Flujo por hora de hoy
	function initFlow() {
		const dataNode = document.getElementById('panel-flujo');
		const plot = document.querySelector('[data-flow-plot]');
		if (!dataNode || !plot) return;
		let flujo;
		try { flujo = JSON.parse(dataNode.textContent); } catch (e) { return; }

		const now = Math.max(0, Math.min(23, flujo.horaActual || 0));
		const H = 24;
		const created = flujo.creados.slice(0, now + 1);
		const solved = flujo.cerrados.slice(0, now + 1);
		const assigned = flujo.asignados.slice(0, now + 1);
		const max = Math.max(0, ...created, ...solved, ...assigned);
		const scale = Math.max(3, Math.ceil(max / 3) * 3);
		const X = i => +((i + 0.5) * (1000 / H)).toFixed(1);
		const Y = v => +(240 - v / scale * 226).toFixed(1);
		const series = arr => arr.map((v, i) => [X(i), Y(v)]);
		const closeArea = pts => smooth(pts) + ' L' + pts[pts.length - 1][0] + ' 240 L' + pts[0][0] + ' 240 Z';
		const pct = i => ((i + 0.5) / H * 100) + '%';

		// Eje Y
		const yAxis = document.querySelector('[data-flow-y]');
		if (yAxis) [scale, scale * 2 / 3, scale / 3, 0].forEach(v => html('span', '', yAxis, String(Math.round(v))));

		// Fondo: jornada, guardia y horas por transcurrir
		const band = html('div', 'band', plot);
		band.style.left = (J0 / H * 100) + '%';
		band.style.width = ((J1 - J0) / H * 100) + '%';
		const lj = html('span', 'lbl j', plot, 'Jornada 08–17');
		lj.style.top = '6px';
		lj.style.left = 'calc(' + (J0 / H * 100) + '% + 8px)';
		const lg = html('span', 'lbl', plot, 'Guardia nocturna');
		lg.style.top = '6px';
		lg.style.left = '8px';
		if (now < H - 1) {
			const rest = html('div', 'rest', plot);
			rest.style.left = ((now + 1) / H * 100) + '%';
			const lr = html('span', 'lbl', plot, 'Por transcurrir');
			lr.style.bottom = '8px';
			lr.style.right = '10px';
		}

		// Líneas
		const svg = el('svg', { class: 'reveal', viewBox: '0 0 1000 240', preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Tickets creados, cerrados y asignados por hora hoy' }, plot);
		const defs = el('defs', {}, svg);
		[['gCre', 'var(--c-blue)', 0.20], ['gRes', 'var(--c-green)', 0.12]].forEach(([id, color, op]) => {
			const g = el('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
			el('stop', { offset: 0, 'stop-color': color, 'stop-opacity': op }, g);
			el('stop', { offset: 1, 'stop-color': color, 'stop-opacity': 0 }, g);
		});
		const line = { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' };
		el('path', { d: closeArea(series(created)), fill: 'url(#gCre)' }, svg);
		el('path', { d: closeArea(series(solved)), fill: 'url(#gRes)' }, svg);
		el('path', Object.assign({ d: smooth(series(assigned)), stroke: 'var(--c-violet)', 'stroke-width': 2, 'stroke-dasharray': '5 5' }, line), svg);
		el('path', Object.assign({ d: smooth(series(solved)), stroke: 'var(--c-green)', 'stroke-width': 2 }, line), svg);
		el('path', Object.assign({ d: smooth(series(created)), stroke: 'var(--c-blue)', 'stroke-width': 2.25 }, line), svg);

		// Línea guía, puntos y recuadro de detalle
		const guide = html('div', 'guide', plot);
		const ptC = html('span', 'pt bg-blue', plot);
		const ptR = html('span', 'pt bg-green', plot);
		const tip = html('div', 'tip', plot);
		const tipTitle = html('b', '', tip);
		const fila = (color, label) => {
			const row = html('div', '', tip);
			html('i', '', row).style.background = color;
			row.appendChild(document.createTextNode(label));
			return html('strong', '', row);
		};
		const tC = fila('var(--tip-blue)', 'Creados');
		const tR = fila('var(--tip-green)', 'Cerrados');
		const tA = fila('var(--tip-violet)', 'Asignados');

		const xAxis = document.querySelector('[data-flow-x]');
		const labels = [];
		for (let i = 0; i < H; i++) {
			const cls = i <= now ? ('past' + (i >= J0 && i < J1 ? ' j' : '')) : '';
			labels.push(html('span', cls, xAxis, pad(i)));
		}

		function select(h) {
			guide.style.left = pct(h);
			ptC.style.left = pct(h);
			ptR.style.left = pct(h);
			ptC.style.top = (Y(created[h]) / 240 * 100) + '%';
			ptR.style.top = (Y(solved[h]) / 240 * 100) + '%';
			tip.style.left = pct(h);
			tip.style.transform = h >= 16 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)';
			tipTitle.textContent = pad(h) + ':00 – ' + pad(h + 1) + ':00' + (h === now ? ' · en curso' : (h < J0 || h >= J1 ? ' · guardia' : ''));
			tC.textContent = created[h];
			tR.textContent = solved[h];
			tA.textContent = assigned[h];
			labels.forEach((l, i) => l.classList.toggle('sel', i === h));
		}

		const hits = html('div', 'hits', plot);
		for (let i = 0; i < H; i++) {
			const cell = html('span', '', hits);
			if (i <= now) {
				cell.style.cursor = 'crosshair';
				cell.addEventListener('mouseenter', () => select(i));
			}
		}
		select(now);

		// Mini gráficas
		const sparks = document.querySelector('[data-sparks]');
		if (!sparks) return;
		const total = arr => arr.reduce((a, b) => a + b, 0);
		const peak = arr => {
			let h = 0;
			arr.forEach((v, i) => { if (v > arr[h]) h = i; });
			return arr[h] > 0 ? 'Pico ' + pad(h) + ':00 · ' + arr[h] : 'Sin movimiento';
		};
		const totalCre = total(created);
		const items = [
			{ label: 'Creados', arr: created, color: 'var(--c-blue)', fill: 'rgba(14,165,233,0.12)', chip: peak(created), cls: 'accent', dash: null },
			{ label: 'Cerrados', arr: solved, color: 'var(--c-green)', fill: 'rgba(34,197,94,0.12)', chip: peak(solved), cls: 'green', dash: null },
			{ label: 'Asignados', arr: assigned, color: 'var(--c-violet)', fill: 'rgba(139,92,246,0.10)', chip: totalCre ? Math.round(total(assigned) / totalCre * 100) + '% de lo creado' : 'Sin creados', cls: 'green', dash: '4 4' }
		];
		items.forEach((s, idx) => {
			const card = html('div', 'spark', sparks);
			const sv = html('div', 'sv', card);
			html('span', 'kt', sv, s.label).style.fontSize = '11px';
			html('strong', '', sv, String(total(s.arr)));
			html('span', 'badge ' + s.cls, sv, s.chip);
			const arr = s.arr.length > 1 ? s.arr : [0].concat(s.arr);
			const mn = Math.min(...arr), mx = Math.max(...arr), rg = (mx - mn) || 1;
			const pts = arr.map((v, i) => [+(i / (arr.length - 1) * 100).toFixed(1), +(33 - (v - mn) / rg * 28).toFixed(1)]);
			const mini = el('svg', { class: 'reveal', viewBox: '0 0 100 36', preserveAspectRatio: 'none', 'aria-hidden': 'true' }, card);
			mini.style.animationDelay = (idx * 120 + 200) + 'ms';
			el('path', { d: smooth(pts) + ' L100 36 L0 36 Z', fill: s.fill, stroke: 'none' }, mini);
			const attrs = { d: smooth(pts), fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' };
			if (s.dash) attrs['stroke-dasharray'] = s.dash;
			el('path', attrs, mini);
		});
	}

	// Mapa de Venezuela: plegable; el estado bajo el cursor (o su fila del ranking) llena la tarjeta.
	function initMapa() {
		const root = document.querySelector('[data-mapa]');
		if (!root) return;
		const body = root.querySelector('#mapa-cuerpo');
		const toggle = root.querySelector('[data-mapa-toggle]');
		const paths = Array.from(root.querySelectorAll('[data-estado]'));
		const rows = Array.from(root.querySelectorAll('[data-estado-btn]'));
		const set = (sel, v) => { const n = root.querySelector(sel); if (n) n.textContent = v; };
		const fallback = rows.length ? rows[0].getAttribute('data-estado-btn') : null;
		function show(code) {
			const path = paths.find(p => p.getAttribute('data-estado') === code);
			paths.forEach(p => p.classList.toggle('on', p === path));
			rows.forEach(r => r.classList.toggle('on', r.getAttribute('data-estado-btn') === code));
			if (!path) return;
			const activos = Number(path.getAttribute('data-activos'));
			set('[data-tip-nombre]', path.getAttribute('data-nombre'));
			set('[data-tip-activos]', activos);
			set('[data-tip-pct]', path.getAttribute('data-pct'));
		}
		const leave = () => { paths.forEach(p => p.classList.remove('on')); rows.forEach(r => r.classList.remove('on')); if (fallback) show(null); };
		paths.forEach(p => {
			p.addEventListener('mouseenter', () => show(p.getAttribute('data-estado')));
			p.addEventListener('mouseleave', leave);
		});
		rows.forEach(r => {
			r.addEventListener('mouseenter', () => show(r.getAttribute('data-estado-btn')));
			r.addEventListener('mouseleave', leave);
		});
		if (toggle && body) toggle.addEventListener('click', () => {
			const open = body.hidden;
			body.hidden = !open;
			toggle.setAttribute('aria-expanded', String(open));
			toggle.textContent = open ? 'Ocultar mapa' : 'Ver mapa';
		});
	}

	document.addEventListener('DOMContentLoaded', () => {
		initAreas();
		initMapa();
		initFlow();
		const refresh = document.querySelector('[data-refresh]');
		if (refresh) refresh.addEventListener('click', () => window.location.reload());
	});
})();

// Filtro por área: cada botón es un enlace (?area=) y el servidor recalcula el Dashboard.
// "Solo saturadas" (con todas las áreas) oculta en la página las áreas por debajo de 60 %.
(function () {
	'use strict';
	document.addEventListener('DOMContentLoaded', () => {
		const sat = document.querySelector('[data-qf-sat]');
		if (!sat) return;
		const saturadas = new Set(Array.from(document.querySelectorAll('.area-row[data-f-area]'))
			.filter(r => parseInt(r.querySelector('.pct').textContent, 10) >= 60).map(r => r.getAttribute('data-f-area')));
		let solo = false;
		sat.addEventListener('click', () => {
			solo = !solo;
			sat.setAttribute('aria-pressed', String(solo));
			document.querySelectorAll('[data-f-area]').forEach(el => {
				if (!solo || saturadas.has(el.getAttribute('data-f-area'))) el.removeAttribute('data-f-hide'); else el.setAttribute('data-f-hide', '');
			});
		});
	});
})();

// Alertas: "Ver N más" / Estado del turno: "Ver personas"
document.addEventListener('DOMContentLoaded', () => {
	const al = document.querySelector('[data-al-toggle]');
	if (al) { const txt = al.textContent; al.addEventListener('click', () => {
		const abrir = al.getAttribute('aria-expanded') !== 'true';
		document.querySelectorAll('[data-al-mas]').forEach(r => { r.hidden = !abrir; });
		al.setAttribute('aria-expanded', String(abrir)); al.textContent = abrir ? 'Ver menos' : txt;
	}); }
	const tu = document.querySelector('[data-tu-toggle]');
	if (tu) tu.addEventListener('click', () => {
		const box = document.getElementById(tu.getAttribute('aria-controls'));
		const abrir = box.hidden; box.hidden = !abrir;
		tu.setAttribute('aria-expanded', String(abrir)); tu.textContent = abrir ? 'Ocultar personas' : 'Ver personas';
	});
});
