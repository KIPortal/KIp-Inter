# Rediseño Portal Operaciones IP — Guía de implementación

Guía para pasar el diseño aprobado en el canvas a código usando **Claude Code (CLI)**, por fases y con indicaciones listas para pegar.

- **Diseño vivo (canvas):** https://claude.ai/artifact/UNNSboqEJsZZUT1gSJ79V2
- **Copia del prototipo en el repo:** `docs/rediseno/prototipo/*.dc.html`. Es la referencia visual y de comportamiento. No se sirve tal cual: usa una plantilla del canvas (`{{...}}`, `<sc-for>`, `<sc-if>`, `class Component extends DCLogic`). La lógica de cada pantalla está en el `<script type="text/x-dc">` al final de cada archivo.
- **Estilos extraídos:** `docs/rediseno/estilos-referencia.css`. Contiene los tokens claro/oscuro, los materiales (vidrio), los controles, los menús, las gráficas y las animaciones, listos para depurar a `public/css/portal.css`.
- **Especificación funcional:** `especificacion-pantallas-y-mejoras.md`, más las respuestas del coordinador (resumidas abajo en «Reglas»).

| Prototipo | Pantalla | Vista actual a reemplazar o crear |
|---|---|---|
| `Main.dc.html` | Dashboard General | `views/index.ejs` (parte dashboard), `dashboardController.renderDashboard` |
| `Tickets.dc.html` | Tickets (cola de trabajo) | `views/index.ejs` (parte tickets) → separar en `views/tickets.ejs` |
| `Turno.dc.html` | Gestión de Turno | ruta `/gestion-turno` (hoy redirige) → `views/turno.ejs` |
| `Reportes.dc.html` | Reportes | `views/reports.ejs` |
| `Auditoria.dc.html` | Auditoría | `views/audit.ejs` |
| `Administracion.dc.html` | Administración (nueva) | `views/admin.ejs` + rutas nuevas |

---

## 1. Fundamentos visuales

**Tipografía:** IBM Plex Sans (400/500/600/700) y IBM Plex Mono (500/600) para los códigos `INC-xxx`, ambas de Google Fonts. Escala: títulos de página 20 px/700, títulos de tarjeta 15 px/600, texto 13 px, etiquetas 12 px, mínimo 11 px. Cifras grandes 26–34 px/600.

**Tema:** `data-theme="light|dark"` en el contenedor raíz. Todo color sale de variables CSS; nunca se escribe un hex en línea para texto o superficies.

| Token | Claro | Oscuro (equilibrado) | Uso |
|---|---|---|---|
| `--t1` / `--t2` / `--t3` | `#1D1D1F` / `#556070` / `#7C7C82` | `rgba(255,255,255,.92)` / `rgba(235,235,245,.76)` / `rgba(235,235,245,.54)` | Texto principal, secundario y terciario |
| `--accent-t` | `#0369A1` | `#7FB2E5` | Enlaces, acentos |
| `--green-t` | `#15803D` | `#5DBB85` | En turno, resueltos |
| `--orange-t` | `#B45309` | `#E0A458` | P2, sin asignar, 40–59 % |
| `--red-t` | `#B91C1C` | `#E07A74` | P1, sobrecarga, cola de espera |
| `--purple-t` | `#6D28D9` | `#B59AE6` | De guardia |
| `--solid` | `#0284C7` | `#3A7FCC` | Botón principal, selección de menú |
| `--*-bg` / `--*-ring` | tintes suaves | tintes al 14–22 % | Fondos de etiquetas y anillos |
| `--sep` / `--sep2` | `#E2E8F0` / `#F1F5F9` | blanco al 10 % / 6 % | Líneas |
| `--well` / `--fill` / `--control` | | | Recuadros internos, controles |
| `--track` / `--grid` | | | Fondo de barras y cuadrícula de gráficas |
| `--dialog` / `--rim` | | | Ventanas y su borde |

En oscuro, los íconos y gráficas a color llevan `filter: saturate(.75) brightness(.95)` para que no se vean eléctricos.

**Fondo:** claro = gradiente "Ocean" (celestes suaves). Oscuro = Golden Gate (índigo y violeta, ver `bg` en cualquier prototipo).

**Materiales (macOS 27, Liquid Glass):**

| Material | Claro | Uso |
|---|---|---|
| `.glass` / `.bento` | blanco al 85 %, blur 24, radio 24 | Tarjetas y secciones |
| `.side` | blur 40, radio 18 | Barra lateral |
| `.pill` | blanco al 72 %, borde fino, radio completo | Grupos de botones y buscador |
| `.notif` | blur 30, radio 20 | Avisos y alertas |
| `--dialog` | | Ventanas, panel lateral y menús |

---

## 2. Componentes que se repiten

1. **Barra lateral** (`nav.side`):
   - **Fija:** `position: sticky; top: 10px; height: calc(100vh - 20px)` desde 900 px de ancho; su contenido se desplaza si no cabe.
   - **Orden:** logo y botón de minimizar, luego el usuario arriba y una línea, luego "Coordinación" (Dashboard, Tickets con conteo, Gestión de Turno con en turno/total) y "Control" (Reportes, Auditoría, Administración).
   - **Minimizable:** pasa a 64 px de ancho con solo íconos, cada opción en una caja de 40 px centrada y el nombre en `title`. La elección se guarda en `localStorage('kip.sidebar')`.
   - **Animación:** ancho, padding y gap en .38 s `cubic-bezier(.22,1,.36,1)`; los textos se desvanecen; el ícono del botón se voltea.
2. **Encabezado de página:** título de 20 px, subtítulo de 12 px y acciones a la derecha. El Dashboard no lleva buscador ni "Nuevo ticket"; esos solo van en Tickets.
3. **Tarjeta de cifras:** una tarjeta con varias cifras separadas por líneas finas (`.stat`). Las del Dashboard son `.bento` con ícono, cifra animada (cuenta desde 0) y una o dos líneas de detalle apiladas.
4. **Tabla agrupada:** grupos en recuadros redondeados. El encabezado lleva el fondo tenue del color del estado, el nombre y el conteo en una pastilla del color; las filas van dentro del recuadro con borde fino del mismo color. Colores por estado: Nuevo gris, En progreso celeste, En pausa ámbar, En espera violeta, Resuelto verde, Cerrado gris.
5. **Filtro desplegable** (`.popup`): "Etiqueta: **Valor**" con una sola flecha hacia abajo. Se marca en azul cuando no está en su valor inicial.
6. **Menú desplegable estilo macOS** (`.mmenu` / `.mitem`):
   - **Caja:** translúcida, radio 10, relleno 5.
   - **Opciones:** de 26 px; la elegida en azul con ✓ a la derecha. Al pasar el cursor, la fila se pone azul con texto blanco y la elegida pierde el resaltado.
   - **Extras por opción:** punto de color, etiqueta (Sugerido verde, Sobrecarga rojo, De guardia violeta, Fuera de turno gris) y un dato a la derecha (conteo, puntos, "4 activos").
   - **Cierre:** al hacer clic fuera, se cierra.
7. **Campo desplegable** (`.combo`): campo de 34 px con el valor y un botón de flecha. Abre el mismo menú.
8. **Botones:** principal (cápsula `--solid`), secundario (`.pill`), peligro (rojo), ícono de fila (`.ico` de 28 px) y enlace (`.linkbtn`).
9. **Ventanas:** fondo `--dialog`, radio 26, entrada `sheetIn`. El fondo oscurecido permite desplazar si la ventana no cabe (`overflow-y:auto`, `margin:auto`).
10. **Panel lateral de detalle:** 448 px a la derecha, entrada `drawerIn`.
11. **Avisos** (`.notif[role=status]`): arriba a la derecha, entran con rebote, el ícono aparece con giro, una barra de tiempo se vacía y salen a los 3,6 s. Para repetir la animación, se desmontan antes de mostrar el siguiente.
12. **Gráficas:**
    - **Marcas:** barras de 8 px, color sólido, extremos redondeados y fondo `--track`; líneas de 2 px; relleno de área al 10–20 %; cuadrícula de 1 px en `--grid`.
    - **Entrada:** las barras crecen (`growX`, escalonado 60–70 ms), las líneas se revelan de izquierda a derecha (`clip-path`) y el anillo del turno se dibuja.
    - **Interacción:** recuadro de detalle con línea guía que se desliza.
13. **Movimiento:** todo respeta `prefers-reduced-motion: reduce`.

---

## 3. Pantallas

### 3.1 Dashboard General (`Main.dc.html`)
- **Zona "Ahora":** 4 tarjetas.
  - Tickets activos, con "N sin asignar" y "N en cola de espera" debajo.
  - Creados hoy.
  - Resueltos hoy, con "N pendientes de cierre".
  - Críticos sin asignar.
- **Debajo, dos columnas:**
  - **Izquierda:** "Carga por área" (barra de % aún abiertos con marcas en 40 % y 60 %; colores < 40 azul, 40–59 ámbar, ≥ 60 rojo) y "Tiempo promedio de resolución por área" (con línea de promedio). Al pulsar un área se despliegan sus operadores, ordenables por "Más carga" y "Más resueltos".
  - **Derecha:** "Alertas", una tarjeta compacta (sobrecarga, cola de espera, antigüedad; "Todo en orden" si no hay) y "Estado del turno" (anillo de la jornada y personas en turno, de guardia y fuera).
- **Zona "Tendencia":** flujo por hora de 24 h (creados, cerrados, asignados) con mini gráficas.
- **Zona "Rendimiento":** ranking de operadores a todo el ancho (puntos con barra, P1/P2/P3, índice de carga) y mapa de Venezuela plegable.

### 3.2 Tickets (`Tickets.dc.html`)
- **Tarjetas fijas** (no cambian con los filtros): Activos, Sin asignar, Críticos sin asignar, En pausa o espera, Resueltos sin cerrar, Creados hoy.
- **Encabezado:** buscador, Papelera (con conteo), Traspasar a guardia y Nuevo ticket.
- **Tabla "Resumen operativo":** solo activos por defecto. Orden de grupos Nuevos → En progreso → En pausa → En espera → Resueltos; dentro de cada grupo, P1 primero y luego los más antiguos. Cerrados solo con Estado = Cerrado.
- **Columnas:** ticket, prioridad, estado, asunto (con el área en gris), operador ("Sin asignar" o "En cola de espera" en rojo), tiempo (⚠ rojo si supera la antigüedad) y acciones (asignar o desasignar, cerrar, editar, historial, eliminar).
- **Filtros:** Área, Fecha, Prioridad, Estado y Operador (incluye "Sin asignar" y "En cola de espera"), todos con "Todos" inicial y conteos.
- **Panel lateral:** sugerencia de operador (asignar con un clic). Si nadie está disponible: "En cola de espera, se avisó al coordinador", más "Sugerir de otra área". Debajo: datos (operador, llegada y canal, remitente, creado por, tiempo, último movimiento), descripción, adjuntos, historial y modo Editar (asunto, prioridad con puntos, área).
- **Ventanas:**
  - **Asignar:** área y prioridad editables y lista de operadores ordenada por carga, con "Sugerido" y "Sobrecarga".
  - **Cerrar:** motivo opcional con plantillas; avisa si el operador aún no lo resolvió.
  - **Eliminar:** motivo ≥ 3 caracteres; va a la papelera.
  - **Papelera:** restaurar.
  - **Traspasar a guardia:** resumen (4 cifras en una fila), lista de pendientes, quién está de guardia en lista vertical, y nota ≥ 10 caracteres con plantillas. No reasigna: deja una lista aparte para la guardia y muestra la tarjeta "Traspaso a guardia · N pendientes" con "Ver lista".
  - **Nuevo ticket:** dos columnas. A la izquierda asunto, descripción y adjuntos; a la derecha origen, área, remitente, fecha de creación, creado por, prioridad y puntaje, y asignar a (opcional, con sugerido). Código provisional `INC-xxx`.
- **Barra de selección múltiple:** asignar a… y traspasar a guardia.

### 3.3 Gestión de Turno (`Turno.dc.html`)
- **Tarjeta de estado:** Operadores, En turno, De guardia y Fuera de turno.
- **Guardia semanal:**
  - Navegación entre semanas.
  - Tira de 7 días: entre semana 17:00–24:00, fin de semana 08:00–24:00 desde casa.
  - Lista de quién está de guardia.
- **Operadores por área** en recuadros con encabezado de color (claro `#64B5FF`, oscuro azul translúcido). Por persona: estado actual calculado, horario (entrada y salida), días L–D como botones, y casilla de guardia de la semana elegida.
- **Cambios:** "N cambios sin guardar" con Descartar/Guardar; todo queda en Auditoría.

### 3.4 Administración (`Administracion.dc.html`)
Secciones con ícono a color al estilo de Ajustes de macOS:
- **Áreas y equipos:** lista de áreas y operadores del área elegida.
- **Plantillas:** notas de traspaso y motivos de cierre (agregar, editar, borrar).
- **Reglas de alerta:**
  - Sobrecarga: multiplicador 1,5× y mínimo 3, con vista previa.
  - Antigüedad: P1 1 h, P2 2 h, P3 4 h, Sin prioridad 30 min.
  - Asignación sugerida: solo en turno; los de guardia solo si su guardia empieza en < 30 min; si nadie está disponible, cola de espera y aviso; permitir sugerir otra área.
- **Avisos dentro del portal:** P1 nuevo, ticket en cola de espera, antigüedad superada, sobrecarga y traspaso; por destinatario (coordinador, operadores del área, de guardia).

### 3.5 Reportes y Auditoría
- **Reportes:** mismo estilo de barras y menús. Pendiente según la especificación: Jornada · Semana · Mes · Fecha específica, filtro de área y "Descargar Excel".
- **Auditoría:**
  - Registro agrupado por día.
  - Filtros Usuario, Acción y Fecha con el menú macOS.
  - Acciones: cerró, resolvió, asignó, reasignó, editó, eliminó, restauró, traspasó, guardia y horario.

---

## 4. Reglas de negocio confirmadas

- **Tiempo:** se mide desde la llegada del ticket y se muestra como promedio. Nunca usar "SLA" ni "DERS".
- **Puntos:** P1 = 8, P2 = 5, P3 = 1, sin prioridad = 0. La prioridad la fija el coordinador.
- **Estados:** Nuevo → En progreso → En pausa / En espera de terceros → Resuelto (operador) → Cerrado (coordinador).
- **Sobrecarga:** activos > 1,5 × el promedio del área, con un mínimo de 3.
- **Turno y guardia:** turno 08:00–17:00. Guardia semanal 17:00–24:00 entre semana y 08:00–24:00 el fin de semana. Quien está de guardia aparece "De guardia", no "Disponible", y puede recibir tickets.
- **Sugerencia de operador:** solo a quien está en turno. Los de guardia entran solo si su guardia está por empezar. Sin nadie disponible, el ticket queda en cola de espera, se avisa al coordinador y este puede pedir otra área. Nunca se asigna solo.
- **Antigüedad:** P1 1 h, P2 2 h, P3 4 h, sin prioridad 30 min (sin asignar o sin movimiento).
- **Eliminar:** va a la papelera con motivo ≥ 3, queda auditado y los códigos no se reutilizan. Todo lo creado se puede editar o eliminar.
- **Traspaso:** nota ≥ 10 caracteres, resumen para quien recibe. No cambia el operador.
- **Origen de los tickets:** correo del buzón compartido (Microsoft Graph) o creación por el coordinador. Los avisos son dentro del portal.

---

## 5. Plan por fases con indicaciones para Claude Code

Trabaja en una rama por fase. Al final de cada fase, abre la app y compara con el canvas en claro y en oscuro.

**Fase 0 — Preparación**
```
Lee docs/rediseno/IMPLEMENTACION.md y revisa views/, src/routes y src/controllers. Hazme un mapa de qué vista y qué controlador corresponde a cada pantalla del rediseño (tabla del inicio del documento), qué datos ya entrega cada controlador y qué falta para las pantallas nuevas. No cambies código todavía.
```

**Fase 1 — Base visual compartida**
```
Crea public/css/portal.css a partir de docs/rediseno/estilos-referencia.css: tokens claro/oscuro con la paleta oscura equilibrada, fondos, materiales (.glass, .bento, .pill, .side, .notif), controles (.popup, .combo, .mmenu/.mitem, .ico, .primary, .linkbtn, .field, .switch, .stepper), gráficas (.track, .bar-fill, .tick, .reveal) y animaciones con prefers-reduced-motion. Elimina reglas duplicadas. Carga IBM Plex Sans/Mono. Crea un partial views/partials/sidebar.ejs (sticky, minimizable con localStorage 'kip.sidebar', usuario arriba, secciones Coordinación y Control, título en cada enlace) y views/partials/head.ejs. Aplica data-theme según la preferencia guardada. No toques todavía el contenido de las pantallas.
```

**Fase 2 — Dashboard General**
```
Reescribe la vista del dashboard del coordinador siguiendo docs/rediseno/prototipo/Main.dc.html y la sección 3.1 de IMPLEMENTACION.md. Usa los datos reales de dashboardController (agrega lo que falte: carga y saturación por área, resolución promedio por área, flujo por hora de 24 h, ranking con puntos e índice de carga, estado del turno, alertas de sobrecarga, cola de espera y antigüedad). Respeta las reglas de la sección 4. Las interacciones (desplegar operadores de un área, tooltip del flujo, plegar el mapa) van en un JS pequeño sin frameworks.
```

**Fase 3 — Tickets**
```
Separa la cola de tickets en views/tickets.ejs siguiendo Tickets.dc.html y la sección 3.2. Implementa tabla agrupada en recuadros por estado, filtros con el menú macOS (un solo menú abierto, cierre al hacer clic fuera), panel lateral de detalle, ventanas Asignar/Cerrar/Eliminar/Papelera/Traspasar/Nuevo ticket y la barra de selección múltiple. Reutiliza los endpoints de src/routes/ticketRoutes.js; agrega los que falten (cerrar con motivo, eliminar a papelera, restaurar, editar, historial, traspaso con nota) con validación en el servidor (motivo ≥ 3, nota ≥ 10) y registro en Auditoría.
```

**Fase 4 — Asignación sugerida, cola de espera y antigüedad**
```
Implementa en un servicio src/services/assignmentService.js la sugerencia de operador (sección 4: en turno, guardia solo si está por empezar, menor carga, sin sobrecarga; si no hay nadie, cola de espera más aviso al coordinador; opción de otra área). Implementa el cálculo de antigüedad por prioridad (P1 1 h, P2 2 h, P3 4 h, sin prioridad 30 min). Lee los umbrales desde la configuración de Administración. Exponlo al dashboard, a Tickets y al formulario de Nuevo ticket.
```

**Fase 5 — Gestión de Turno**
```
Crea views/turno.ejs siguiendo Turno.dc.html y la sección 3.3 (guardia semanal con navegación, horario individual, días, casilla de guardia y estado actual calculado). Haz que /gestion-turno la renderice. Persiste horarios y guardias (agrega modelos Prisma si hacen falta; muéstrame la migración antes de aplicarla) y registra cada cambio en Auditoría.
```

**Fase 6 — Administración**
```
Crea views/admin.ejs siguiendo Administracion.dc.html y la sección 3.4: áreas y operadores, plantillas (traspaso y cierre), reglas de alerta (sobrecarga, antigüedad, sugerencia) y avisos por evento y destinatario. Guarda la configuración en base de datos (propón el modelo Prisma antes de migrar) y úsala desde los servicios de la fase 4. Solo para el rol COORDINADOR.
```

**Fase 7 — Reportes y Auditoría**
```
Actualiza views/reports.ejs y views/audit.ejs al estilo nuevo (Reportes.dc.html, Auditoria.dc.html): barras finas animadas, menús macOS en filtros y auditoría agrupada por día con filtros Usuario, Acción y Fecha. En Reportes agrega el selector Jornada/Semana/Mes/Fecha específica, el filtro de área y "Descargar Excel" usando /reportes/excel si existe.
```

**Fase 8 — Revisión final**
```
Revisa todas las vistas en claro y oscuro: contraste de textos, que ningún color esté fijo en línea fuera de los tokens, alineación de la barra minimizada, que las ventanas quepan en 1366×768, navegación por teclado en menús y ventanas, y prefers-reduced-motion. Lista lo que encuentres antes de corregir.
```

### Consejos para trabajar con Claude Code
- Pide una fase por sesión y, al empezar, que lea este documento y el prototipo correspondiente.
- Pide primero un plan corto ("muéstrame el plan antes de editar") en las fases que tocan Prisma o rutas.
- Cuando algo no se vea como el canvas, pega una captura y nombra el componente de la sección 2 ("el menú .mmenu se ve…").
- El operador (vista móvil) queda para después, con el mismo estilo.
