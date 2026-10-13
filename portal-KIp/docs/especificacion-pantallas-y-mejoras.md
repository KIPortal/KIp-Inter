# Especificación de pantallas y mejoras — Portal Operaciones IP

Documento para (1) **Claude Design**: diseñar las pantallas, y (2) **Claude Code (CLI)**: implementarlas. Complementa `rediseno-estructura.md`, `contrato-metricas.md` y `especificacion-metricas.md`.

## 1. Contexto y principios
- Herramienta **interna** del departamento Operaciones IP (Inter Telecomunicaciones). Sus usuarios son el coordinador de área y los operadores. **No hay portal para clientes externos.**
- Objetivo: medir y repartir de forma justa la carga de trabajo. Los tickets llegan por correo (buzón compartido), llamada, jefatura o creación directa.
- Estilo visual: macOS plano. Tarjetas blancas, borde 1 px `#E5E5EA`, azul `#007AFF`, texto 11–13 px, etiquetas pequeñas en mayúsculas, sin sombras grandes ni efectos de vidrio salvo en encabezado y menú lateral. Idioma: español. Zona horaria: Caracas (UTC-4).
- Roles: **Coordinador** (reparte, prioriza, cierra, gestiona turnos) y **Operador** (toma, pausa, resuelve). Cada rol tiene su propio dashboard.

## 2. Reglas de negocio que el diseño debe respetar
- Tiempo medido desde la llegada del ticket; se muestra **promedio**. Nunca usar "SLA" ni "DERS".
- Prioridad la fija el coordinador: P1 = 8 pts, P2 = 5, P3 = 1, sin prioridad = 0.
- Estados: Nuevo → En progreso → En pausa / En espera de terceros → **Resuelto** (lo marca el operador) → **Cerrado** (lo marca el coordinador).
- Sobrecarga: operador con tickets activos > 1.5× el promedio de su área (mínimo 3).
- Turno normal 8:00–17:00. Guardia semanal: 17:00–24:00 entre semana; 08:00–24:00 en fin de semana (desde casa). Quien está de guardia aparece "De guardia", no "Disponible", pero puede recibir tickets.
- Eliminar = enviar a la papelera con motivo (≥ 3 caracteres), con auditoría. Los códigos `INC-xxx` no se reutilizan.

## 3. Pantallas (coordinador)

### 3.1 Dashboard General — toda la estadística
- Tarjetas KPI: Tickets activos · Creados hoy · Resueltos/cerrados hoy · Promedio de atención · Críticos sin asignar · Operadores disponibles / de guardia.
- Alertas de sobrecarga (operador, activos, promedio del área, índice).
- Flujo por hora de hoy (creados, asignados, cerrados; 24 h).
- Carga activa por área y saturación por área (% aún abiertos).
- Promedio de tiempo de resolución por área (en horas).
- Ranking de operadores (puntos, P1/P2/P3, índice de carga, estado de turno).
- Mapa de Venezuela (se conserva; importante a futuro).
- Estado del turno: quién está en turno, de guardia o fuera de turno.

### 3.2 Tickets — cola de trabajo
- **Tarjetas fijas arriba** (total de la operación, no cambian con los filtros): Activos · Sin asignar · Críticos sin asignar · En pausa/espera · Resueltos pendientes de cierre · Creados hoy.
- Tabla "Resumen Operativo": **solo tickets activos por defecto; los cerrados no aparecen** (se ven con Estado = Cerrado). Orden fijo: Nuevos → En progreso → En pausa → En espera → Resueltos; dentro de cada grupo, P1 primero y luego los más antiguos.
- Filtros: área, fecha, prioridad, estado, operador (todos con opción inicial "Todos").
- Columnas: ticket, prioridad, estado, asunto, operador asignado, tiempo, acciones.
- Acciones por fila: asignar / desasignar, cerrar, editar, eliminar, historial. Acciones masivas: asignar varios, traspasar a guardia (con nota ≥ 10 caracteres).
- Botones: Nuevo ticket, Papelera (restaurar).
- Detalle del ticket (panel lateral): descripción, historial de eventos, adjuntos, sugerencia de operador (ver §5).

### 3.3 Reportes
Solo datos generales por periodo: selector (Jornada · Semana · Mes · Fecha específica) + filtro de área, resumen, tabla por operador, tabla de detalle y botón **Descargar Excel**. Sin gráficas pesadas.

### 3.4 Gestión de Turno
Guardia semanal (casilla por operador, navegación entre semanas), horario individual (días y horas) y estado de turno actual de cada operador.

### 3.5 Auditoría
Registro de acciones (cerrar, editar, eliminar, restaurar, traspaso, guardia, horarios) con fecha, usuario y detalle.

### 3.6 Administración (nueva)
Inspirada en el panel de administración de Faveo. Un solo lugar para: áreas/equipos y sus operadores, **plantillas** de texto (notas de traspaso, motivos de cierre), **reglas de alerta** (§5) y **notificaciones** (qué eventos avisan y a quién).

## 4. Pantallas (operador) — diseño aparte, mismo estilo
Dashboard propio: mis tickets (activos, en pausa, resueltos hoy), cola de mi área para tomar (reclamar), mi carga frente al promedio, mi estado de turno, botones pausar / reanudar / resolver. Debe ser cómodo en **teléfono** (el operador de guardia trabaja desde casa); el coordinador usa escritorio.

## 5. Mejoras funcionales (referencias: LiveAgent, Faveo, Attendo)
Prioridad alta, esfuerzo bajo; se apoyan en lo que ya medimos.

1. **Asignación sugerida.** Al crear o abrir un ticket sin asignar, el sistema propone un operador: del área del ticket, en turno o de guardia, con menor carga activa y sin sobrecarga. El coordinador confirma con un clic; no se asigna solo. *(Equivalente a la "máxima utilización / control de carga" de LiveAgent.)*
2. **Alertas por antigüedad.** Aviso visible cuando un ticket queda sin asignar o sin movimiento más de N horas. Valores propuestos (a confirmar): P1 = 1 h, resto = 4 h. *(Equivalente a las reglas por tiempo de LiveAgent.)*
3. **Vista de turno entrante.** Al traspasar a guardia, resumen automático de pendientes y notas para quien recibe.
4. **Plantillas de texto** para notas de traspaso y motivos de cierre.

Prioridad media: notificaciones por correo (P1 nuevo, sobrecarga, traspaso); relacionar tickets duplicados; exportar a PDF el informe semanal; sugerencia de área/prioridad por el asunto del correo (el coordinador confirma).

Fuera de alcance: chat en vivo, redes sociales, CRM, contratos, geolocalización, portal de clientes.

## 6. Datos disponibles hoy (endpoints)
Ver `contrato-metricas.md`: `/reportes/data` y `/reportes/excel` (periodo), `/api/tickets/*` (asignar, cerrar, editar, eliminar, restaurar, traspaso, historial, papelera), `/api/turnos/*` (guardia y horarios), dashboard del coordinador y del operador. Lo nuevo (§5) requerirá endpoints adicionales que implementa el backend.

## 7. Preguntas abiertas
- Umbral de alertas por antigüedad (propuesta: P1 1 h; resto 4 h).
- Sugerencia de operador: ¿considerar solo a quien está en turno o también a quien está de guardia?
- Si no hay nadie disponible en el área: ¿sugerir otra área o dejar sin asignar con aviso?
- Canal de notificaciones (correo, Teams, ambos).
