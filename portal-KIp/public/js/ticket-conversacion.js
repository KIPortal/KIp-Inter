// Detalle del ticket del operador: pestañas Detalle y Conversación.
// Los datos vienen de GET /api/tickets/:codigo/conversacion (conversationService.js);
// escribir usa POST /api/tickets/:codigo/mensajes. Todo el texto se pinta con
// textContent: nada del correo se interpreta como HTML.
(function () {
	'use strict';
	const $ = id => document.getElementById(id);
	const CLIP = 'M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7';

	const S = { code: null, conv: null, mode: 'out', files: [], tab: 'info', sending: false, req: 0, reload: false };

	function h(tag, attrs, kids) {
		const el = document.createElement(tag);
		Object.entries(attrs || {}).forEach(([k, v]) => {
			if (v == null || v === false) return;
			if (k === 'text') el.textContent = v;
			else if (k === 'on') Object.entries(v).forEach(([ev, fn]) => el.addEventListener(ev, fn));
			else el.setAttribute(k, v === true ? '' : v);
		});
		(kids || []).forEach(k => k != null && el.append(k));
		return el;
	}
	function clip(size) {
		const ns = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(ns, 'svg');
		[['width', size], ['height', size], ['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '2.2'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true']]
			.forEach(([k, v]) => svg.setAttribute(k, v));
		const p = document.createElementNS(ns, 'path');
		p.setAttribute('d', CLIP);
		svg.appendChild(p);
		return svg;
	}
	const peso = b => !b ? '' : b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
	function fileChip(a, small) {
		const kids = [clip(small ? 11 : 12), h('span', { text: a.nombre })];
		// Solo enlaces a /uploads/ (el servidor ya filtra; esto es una segunda barrera)
		return a.url && a.url.indexOf('/uploads/') === 0
			? h('a', { class: 'dfile', href: a.url, target: '_blank', rel: 'noopener', title: a.nombre + (a.peso ? ' · ' + peso(a.peso) : '') }, kids)
			: h('span', { class: 'dfile', title: a.nombre }, kids);
	}

	function feedback(text, tone) {
		const fb = $('modalDetailFeedback');
		if (!fb) return;
		fb.textContent = text || '';
		fb.setAttribute('data-tone', tone || 'error');
		fb.classList.toggle('hidden', !text);
	}

	// ---------- Pestañas ----------
	function setTab(tab, focus) {
		S.tab = tab;
		const info = tab === 'info';
		[['tdTabInfo', info], ['tdTabThread', !info]].forEach(([id, on]) => {
			const b = $(id);
			b.setAttribute('aria-selected', on ? 'true' : 'false');
			b.tabIndex = on ? 0 : -1;
			if (on && focus) b.focus();
		});
		$('tdPanelInfo').hidden = !info;
		$('tdPanelThread').hidden = info;
		syncFooter();
		if (!info) scrollEnd();
	}
	function syncFooter() {
		const write = S.tab === 'thread' && S.conv && S.conv.puedeEscribir;
		$('tdSendGroup').hidden = !write;
		$('modalDetailActionContainer').hidden = !!write;
		syncButtons();
	}

	// ---------- Escribir ----------
	function setMode(mode) {
		S.mode = mode;
		const c = S.conv || {};
		const out = mode === 'out';
		$('tdComposer').setAttribute('data-mode', mode);
		document.querySelectorAll('#tdComposer [data-cmode]').forEach(b => {
			const on = b.getAttribute('data-cmode') === mode;
			b.setAttribute('aria-checked', on ? 'true' : 'false');
			b.setAttribute('aria-selected', on ? 'true' : 'false');
		});
		$('tdText').placeholder = out ? 'Escribe la respuesta al cliente…' : 'Escribe una nota para el equipo…';
		$('tdTo').textContent = out
			? (c.para ? 'Para: ' + c.para + ' · ' + (c.asunto || '') : 'El ticket no tiene correo de cliente: solo puedes dejar notas')
			: 'Solo la ve el equipo, no se envía al cliente';
		$('tdTo').title = $('tdTo').textContent;
		$('tdTpls').style.display = out ? 'contents' : 'none';
		// Responder desde el programa de correo: cliente, asunto con el código y el buzón del NOC en copia
		const ext = $('tdMailExt');
		if (ext) {
			ext.hidden = !(out && c.correoExterno && c.correoExterno.href);
			if (!ext.hidden) {
				ext.href = c.correoExterno.href;
				ext.title = c.correoExterno.buzon
					? 'Abre tu correo con el cliente, el asunto con ' + c.codigo + ' y ' + c.correoExterno.buzon + ' en copia. No quites el código ni la copia: así tu respuesta y la del cliente quedan en este historial.'
					: 'Abre tu correo con el cliente y el asunto con ' + c.codigo + '. Falta configurar el buzón del NOC: tu respuesta no quedará en este historial.';
			}
		}
		$('tdSend').textContent = out ? 'Enviar' : 'Guardar nota';
		$('tdSendWait').hidden = !out;
		syncButtons();
	}
	function syncButtons() {
		const c = S.conv || {};
		const empty = !$('tdText').value.trim();
		const noMail = S.mode === 'out' && !c.para;
		$('tdSend').disabled = S.sending || empty || noMail;
		$('tdSendWait').disabled = S.sending || empty || noMail || !c.puedeEsperar;
		$('tdSendWait').title = c.puedeEsperar
			? 'Envía el correo y pasa el ticket a Espera de terceros'
			: 'Empieza el ticket para poder dejarlo en espera de respuesta';
	}
	function renderFiles() {
		const box = $('tdFiles');
		box.textContent = '';
		box.hidden = S.files.length === 0;
		S.files.forEach((f, i) => {
			box.appendChild(h('span', { class: 'dfile', title: f.name + ' · ' + peso(f.size) }, [
				clip(12), h('span', { text: f.name }),
				h('button', { type: 'button', 'aria-label': 'Quitar ' + f.name, on: { click: () => { S.files.splice(i, 1); renderFiles(); } } }, ['×'])
			]));
		});
	}

	async function send(wait) {
		const texto = $('tdText').value.trim();
		if (!texto || S.sending || !S.code) return;
		const max = (S.conv && S.conv.limites && S.conv.limites.adjuntos) || 5;
		if (S.files.length > max) return feedback('Máximo ' + max + ' adjuntos por mensaje');
		S.sending = true;
		feedback('');
		syncButtons();
		const label = $('tdSend').textContent;
		(wait ? $('tdSendWait') : $('tdSend')).textContent = S.mode === 'note' ? 'Guardando…' : 'Enviando…';
		const code = S.code;
		const fd = new FormData();
		fd.append('tipo', S.mode);
		fd.append('texto', texto);
		fd.append('esperar', wait ? 'true' : 'false');
		S.files.forEach(f => fd.append('adjuntos', f, f.name));
		try {
			const res = await fetch('/api/tickets/' + encodeURIComponent(code) + '/mensajes', { method: 'POST', body: fd });
			let data = {};
			try { data = await res.json(); } catch (e) { data = {}; }
			if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo enviar el mensaje');
			if (S.code !== code) return;
			$('tdText').value = '';
			S.files = [];
			renderFiles();
			S.conv = data.conversacion;
			if (wait) S.reload = true;
			render();
			if (data.aviso) feedback(data.aviso, 'info');
			if (wait && data.estado === 'EN_ESPERA_TERCEROS') {
				const sb = $('modalDetailStatusBadge');
				sb.textContent = 'Espera de terceros';
				sb.style.background = 'var(--purple-bg)';
				sb.style.color = 'var(--purple-t)';
			}
		} catch (err) {
			feedback(err.message || 'No se pudo enviar el mensaje');
		} finally {
			S.sending = false;
			$('tdSend').textContent = label;
			$('tdSendWait').textContent = 'Enviar y esperar respuesta';
			syncButtons();
		}
	}

	// ---------- Pintar ----------
	function scrollEnd() {
		const list = $('tdMsgs');
		requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
	}
	function renderMsgs(items) {
		const list = $('tdMsgs');
		list.textContent = '';
		if (!items.length) { list.appendChild(h('div', { class: 'mempty', text: 'Sin mensajes' })); return; }
		items.forEach(m => {
			if (m.k === 'sys') { list.appendChild(h('div', { class: 'msys', text: m.texto + (m.hora ? ' · ' + m.hora : '') })); return; }
			const sent = m.k === 'out' ? (/no enviado/i.test(m.meta) ? 'false' : 'true') : null;
			const files = (m.adjuntos || []).length ? h('div', { class: 'dfiles' }, m.adjuntos.map(a => fileChip(a, true))) : null;
			list.appendChild(h('div', { class: 'mrow', 'data-k': m.k, 'data-sent': sent }, [
				h('div', { class: 'mbub' }, [
					h('div', { class: 'mhd' }, [
						h('strong', { text: m.quien }),
						h('span', { class: 'mmeta', text: m.meta }),
						h('span', { class: 'mtime', text: m.hora })
					]),
					h('div', { class: 'mtxt', text: m.texto }),
					files
				])
			]));
		});
		scrollEnd();
	}
	function render() {
		const c = S.conv;
		$('tdMsgCount').textContent = String(c.total);
		$('tdMsgCount').setAttribute('aria-label', c.total + (c.total === 1 ? ' mensaje' : ' mensajes'));
		// Adjuntos del correo inicial en la pestaña Detalle
		const first = c.items[0] || {};
		const box = $('modalDetailFiles');
		box.textContent = '';
		if ((first.adjuntos || []).length) first.adjuntos.forEach(a => box.appendChild(fileChip(a)));
		else box.appendChild(h('span', { class: 'dmuted', text: 'Sin adjuntos' }));

		$('tdWait').hidden = !c.esperando;
		$('tdWaitText').textContent = c.esperaTexto || '';
		renderMsgs(c.items);

		$('tdComposer').hidden = !c.puedeEscribir;
		$('tdNoWrite').hidden = c.puedeEscribir;
		$('tdNoWrite').textContent = c.motivoNoEscribir || '';
		const tpls = $('tdTpls');
		tpls.textContent = '';
		if (c.plantillas && c.plantillas.length) {
			tpls.appendChild(h('span', { class: 'lbl', text: 'Plantillas' }));
			c.plantillas.forEach(p => tpls.appendChild(h('button', { type: 'button', class: 'tpl', text: p.etiqueta, on: { click: () => { $('tdText').value = p.texto; $('tdText').focus(); syncButtons(); } } })));
		}
		// Sin correo de cliente: se abre en Nota interna
		setMode(S.mode === 'out' && !c.para ? 'note' : S.mode);
		syncFooter();
	}

	async function load(code) {
		const req = ++S.req;
		try {
			const res = await fetch('/api/tickets/' + encodeURIComponent(code) + '/conversacion', { cache: 'no-store' });
			const data = await res.json().catch(() => ({}));
			if (req !== S.req) return;
			if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar la conversación');
			S.conv = data.conversacion;
			render();
		} catch (err) {
			if (req !== S.req) return;
			$('tdMsgCount').textContent = '!';
			$('modalDetailFiles').textContent = '';
			$('modalDetailFiles').appendChild(h('span', { class: 'dmuted', text: 'No disponible' }));
			$('tdMsgs').textContent = '';
			$('tdMsgs').appendChild(h('div', { class: 'mempty', text: err.message || 'No se pudo cargar la conversación' }));
		}
	}

	// ---------- API para la vista ----------
	window.TicketConversacion = {
		abrir(code) {
			S.code = code;
			S.conv = null;
			S.mode = 'out';
			S.files = [];
			S.sending = false;
			$('tdText').value = '';
			renderFiles();
			$('tdMsgCount').textContent = '…';
			$('tdMsgs').textContent = '';
			$('tdMsgs').appendChild(h('div', { class: 'mempty', text: 'Cargando conversación…' }));
			$('modalDetailFiles').textContent = '';
			$('modalDetailFiles').appendChild(h('span', { class: 'dmuted', text: 'Cargando…' }));
			$('tdWait').hidden = true;
			$('tdComposer').hidden = true;
			$('tdNoWrite').hidden = true;
			setTab('info');
			load(code);
		},
		cerrar() {
			S.req++;
			S.code = null;
			// Un cambio de estado (enviar y esperar) deja la lista desactualizada
			if (S.reload) { S.reload = false; window.location.reload(); }
		}
	};

	function init() {
		if (!$('ticketDetailsCard')) return;
		$('tdTabInfo').addEventListener('click', () => setTab('info'));
		$('tdTabThread').addEventListener('click', () => setTab('thread'));
		$('tdTabInfo').parentElement.addEventListener('keydown', e => {
			if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setTab(S.tab === 'info' ? 'thread' : 'info', true); }
		});
		document.querySelectorAll('#tdComposer [data-cmode]').forEach(b => b.addEventListener('click', () => setMode(b.getAttribute('data-cmode'))));
		$('tdText').addEventListener('input', syncButtons);
		$('tdText').addEventListener('keydown', e => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(false); }
		});
		$('tdAttach').addEventListener('click', () => $('tdFileInput').click());
		$('tdFileInput').addEventListener('change', e => {
			S.files = S.files.concat(Array.from(e.target.files || []));
			e.target.value = '';
			renderFiles();
		});
		$('tdSend').addEventListener('click', () => send(false));
		$('tdSendWait').addEventListener('click', () => send(true));
	}
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
	else init();
})();
