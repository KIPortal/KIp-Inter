// Barra lateral minimizable (localStorage 'kip.sidebar') y cambio de tema (localStorage 'kip.theme').
(function () {
	function guardar(clave, valor) {
		try { localStorage.setItem(clave, valor); } catch (e) { /* almacenamiento bloqueado: solo esta visita */ }
	}

	function sincronizarBoton(nav) {
		const boton = nav.querySelector('[data-sidebar-toggle]');
		if (!boton) return;
		const minimizada = nav.getAttribute('data-collapsed') === 'true';
		boton.setAttribute('aria-expanded', String(!minimizada));
		boton.title = minimizada ? 'Expandir barra lateral' : 'Minimizar barra lateral';
	}

	document.addEventListener('DOMContentLoaded', function () {
		const nav = document.getElementById('kip-sidebar');
		if (nav) {
			sincronizarBoton(nav);
			const boton = nav.querySelector('[data-sidebar-toggle]');
			if (boton) {
				boton.addEventListener('click', function () {
					const minimizada = nav.getAttribute('data-collapsed') !== 'true';
					nav.setAttribute('data-collapsed', String(minimizada));
					guardar('kip.sidebar', minimizada ? 'collapsed' : 'expanded');
					sincronizarBoton(nav);
				});
			}
		}

		document.querySelectorAll('[data-theme-toggle]').forEach(function (el) {
			el.addEventListener('click', function (event) {
				event.preventDefault();
				const raiz = document.documentElement;
				const tema = raiz.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
				raiz.setAttribute('data-theme', tema);
				guardar('kip.theme', tema);
			});
		});
	});
})();
